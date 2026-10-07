/**
 * runtime/migrate.ts
 *
 * Applies supabase/migrations/*.sql to the database in DATABASE_URL, in order,
 * each in its own transaction, and records what ran.
 *
 * Tracking uses supabase_migrations.schema_migrations — the table the Supabase
 * CLI uses — so this and `supabase db push` / `supabase migration list` agree
 * on what has been applied and can be used interchangeably.
 *
 * Usage (from backend/):
 *   npm run db:status               what is recorded, and which unrecorded
 *                                   migrations already look applied
 *   npm run db:migrate              apply every pending migration
 *   npm run db:baseline -- 0009     record 0001..0009 as applied WITHOUT running
 *                                   them — for migrations already run by hand in
 *                                   the Supabase SQL editor
 *
 * DATABASE_URL: Supabase dashboard → Connect → "Session pooler" (or the direct
 * connection if your network has IPv6). Needs the postgres role's password.
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { Client } from "pg";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");

interface MigrationFile {
  version: string;
  name: string;
  file: string;
}

/**
 * One cheap catalog query per migration: true when its signature object
 * exists. Lets `status` tell "never ran" apart from "ran by hand, unrecorded".
 */
const SIGNATURES: Record<string, string> = {
  "0000": "select to_regclass('public.strategy_runs') is not null and to_regclass('public.strategies') is not null",
  "0001": "select to_regclass('public.backtest_jobs') is not null",
  "0002": "select to_regclass('public.bar_coverage') is not null",
  "0003": "select to_regclass('public.app_users') is not null",
  "0004": "select exists (select 1 from information_schema.columns where table_name = 'strategy_runs' and column_name = 'lease_owner')",
  "0005": "select to_regclass('public.risk_rejections') is not null",
  "0006": "select to_regclass('public.strategy_versions') is not null",
  "0007": "select to_regclass('public.strategy_proposals') is not null",
  "0008": "select exists (select 1 from pg_trigger where tgname = 'on_auth_user_created')",
  "0009": "select exists (select 1 from information_schema.columns where table_name = 'backtest_results' and column_name = 'saved_at')",
  "0010": "select to_regclass('public.proposal_summaries') is not null",
  // 0012 deliberately replaces claim_backtest_job with a five-argument
  // signature, so probe a 0011 function that remains stable afterward.
  "0011": "select to_regprocedure('public.touch_backtest_job(uuid, text, integer, jsonb)') is not null",
  "0012": "select exists (select 1 from information_schema.columns where table_name = 'strategy_runs' and column_name = 'runtime_origin')",
  "0013": "select exists (select 1 from information_schema.columns where table_name = 'app_users' and column_name = 'membership_status')",
  "0014": "select to_regprocedure('public.save_strategy_version(uuid, text, jsonb, text, uuid)') is not null",
};

function listMigrations(): MigrationFile[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .map((file) => /^(\d+)_(.+)\.sql$/.exec(file))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ version: m[1], name: m[2], file: m[0] }))
    .sort((a, b) => a.version.localeCompare(b.version));
}

async function connect(): Promise<Client> {
  const url = process.env.DATABASE_URL;
  if (!url || url.includes("your-project")) {
    throw new Error(
      "DATABASE_URL is not set to a real database. Copy it from the Supabase dashboard " +
        "(Connect → Session pooler) into backend/.env.",
    );
  }
  // Supabase's server certificates chain to Supabase's own root CA, not a public
  // one. Point DATABASE_CA_CERT at that root (dashboard → Database → SSL
  // Configuration → Download certificate) to verify the server; without it the
  // connection is still encrypted but the server's identity goes unchecked.
  const caPath = process.env.DATABASE_CA_CERT;
  const ssl = caPath ? { ca: fs.readFileSync(caPath, "utf8") } : { rejectUnauthorized: false };
  if (!caPath) console.warn("DATABASE_CA_CERT not set — TLS is on, but the server certificate is not verified.");
  const client = new Client({ connectionString: url, ssl });
  await client.connect();
  await client.query(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version    text primary key,
      statements text[],
      name       text
    );
  `);
  return client;
}

async function recordedVersions(client: Client): Promise<Set<string>> {
  const { rows } = await client.query<{ version: string }>("select version from supabase_migrations.schema_migrations");
  return new Set(rows.map((r) => r.version));
}

async function looksApplied(client: Client, version: string): Promise<boolean | null> {
  const probe = SIGNATURES[version];
  if (!probe) return null;
  const { rows } = await client.query(probe);
  return Object.values(rows[0])[0] === true;
}

async function status(client: Client): Promise<void> {
  const recorded = await recordedVersions(client);
  let suggestBaseline: string | null = null;
  for (const m of listMigrations()) {
    const applied = recorded.has(m.version);
    const detected = applied ? null : await looksApplied(client, m.version);
    const label = applied
      ? "applied"
      : detected
        ? "PENDING — but its objects already exist (ran by hand?)"
        : "pending";
    if (!applied && detected) suggestBaseline = m.version;
    console.log(`${m.version}  ${m.name.padEnd(28)} ${label}`);
  }
  if (suggestBaseline) {
    console.log(
      `\nSome migrations look applied but are not recorded. If they were run by hand, record ` +
        `them without re-running:\n  npm run db:baseline -- ${suggestBaseline}\nthen run npm run db:migrate for the rest.`,
    );
  }
}

async function migrate(client: Client): Promise<void> {
  const recorded = await recordedVersions(client);
  const pending = listMigrations().filter((m) => !recorded.has(m.version));
  if (pending.length === 0) {
    console.log("Nothing to apply — every migration is recorded.");
    return;
  }

  // Refuse to run a migration over objects it would find already present: that
  // is a hand-applied migration that needs baselining, and re-running it would
  // fail partway through a `create table` or silently re-run a backfill.
  for (const m of pending) {
    if (await looksApplied(client, m.version)) {
      throw new Error(
        `${m.file} looks already applied but is not recorded. Run \`npm run db:status\`, then ` +
          "`npm run db:baseline -- <last hand-applied version>` before migrating.",
      );
    }
  }

  for (const m of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, m.file), "utf8");
    process.stdout.write(`Applying ${m.file} ... `);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        "insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)",
        [m.version, [sql], m.name],
      );
      await client.query("commit");
      console.log("done");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      console.log("FAILED");
      throw new Error(`${m.file} failed and was rolled back: ${(err as Error).message}`);
    }
  }
}

async function baseline(client: Client, upTo: string | undefined): Promise<void> {
  if (!upTo || !/^\d+$/.test(upTo)) throw new Error("Usage: npm run db:baseline -- <version>, e.g. 0009");
  const recorded = await recordedVersions(client);
  const targets = listMigrations().filter((m) => m.version <= upTo && !recorded.has(m.version));
  for (const m of targets) {
    await client.query(
      "insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)",
      [m.version, [], m.name],
    );
    console.log(`Recorded ${m.file} as applied (not run)`);
  }
  if (targets.length === 0) console.log(`Nothing to record — everything up to ${upTo} is already recorded.`);
}

async function main(): Promise<void> {
  const [command = "status", arg] = process.argv.slice(2);
  const client = await connect();
  try {
    if (command === "status") await status(client);
    else if (command === "migrate") await migrate(client);
    else if (command === "baseline") await baseline(client, arg);
    else throw new Error(`Unknown command "${command}" — use status, migrate, or baseline`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
