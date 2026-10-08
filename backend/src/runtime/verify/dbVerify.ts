/**
 * runtime/verify/dbVerify.ts
 *
 * Read-only check that the database in DATABASE_URL has everything the
 * backend relies on after `npm run db:migrate`, and that it is locked down:
 *
 *   - every table, view, function, and index the runtime code calls exists
 *   - every public table has row level security (a table without it is
 *     readable AND writable by anyone holding the anon key the frontend ships)
 *   - views run with the caller's privileges, not their owner's
 *   - the queue / lease functions are callable by the backend only
 *
 * Usage (from backend/): npm run db:verify   — exits 1 on any failure.
 */

import "dotenv/config";
import fs from "fs";
import { Client } from "pg";

interface Check {
  name: string;
  sql: string;
  /** Rows returned are the failures; none means pass. */
  describe: (row: Record<string, unknown>) => string;
}

const REQUIRED_RELATIONS = [
  "app_users", "strategies", "strategy_runs", "strategy_versions", "strategy_proposals",
  "proposal_comments", "backtest_results", "backtest_orders", "backtest_fills", "backtest_jobs",
  "backtest_job_artifacts", "bars", "bar_coverage", "risk_rejections", "orders", "fills",
  "portfolio_snapshots", "pending_approvals", "proposal_timeline", "proposal_summaries",
  "member_contention_daily", "broker_accounts", "broker_fees", "broker_sync_state", "broker_drift",
  "signals", "ledger_run_positions", "run_snapshots", "strategy_run_stats", "run_events",
];

const BACKEND_FUNCTIONS = [
  "claim_backtest_job(text, integer, integer, integer, text)",
  "touch_backtest_job(uuid, text, integer, jsonb)",
  "complete_backtest_job(uuid, text, integer)",
  "fail_backtest_job(uuid, text, text)",
  "release_backtest_job(uuid, text)",
  "sweep_backtest_jobs(integer)",
  "get_bars(text, text, timestamptz, timestamptz)",
  "acquire_run_lease(uuid, text, integer)",
  "claim_orphaned_runs(text, text, text, integer, text)",
  "heartbeat_run_leases(text, uuid[], integer)",
  "release_run_lease(uuid, text)",
  "save_strategy_version(uuid, text, jsonb, text, uuid)",
];

const REQUIRED_INDEXES = [
  "backtest_jobs_active_key",
  "strategy_runs_single_live",
  "strategy_proposals_one_open",
  "strategy_runs_sandbox_expiry",
  "strategy_runs_broker_account",
];

const quoted = (xs: string[]) => xs.map((x) => `'${x}'`).join(", ");

const CHECKS: Check[] = [
  {
    name: "Tables and views exist",
    sql: `select r as missing from unnest(array[${quoted(REQUIRED_RELATIONS)}]) r
          where to_regclass('public.' || r) is null`,
    describe: (row) => `missing relation: ${row.missing}`,
  },
  {
    name: "Backend functions exist",
    sql: `select f as missing from unnest(array[${quoted(BACKEND_FUNCTIONS)}]) f
          where to_regprocedure('public.' || f) is null`,
    describe: (row) => `missing function: ${row.missing}`,
  },
  {
    name: "Concurrency indexes exist",
    sql: `select i as missing from unnest(array[${quoted(REQUIRED_INDEXES)}]) i
          where to_regclass('public.' || i) is null`,
    describe: (row) => `missing index: ${row.missing}`,
  },
  {
    // 0012 defines the index on (strategy_id, execution_mode, runtime_origin).
    // Match each column rather than one exact column list, so the check accepts
    // that definition and still rejects the original strategy_id-only index.
    name: "Live-run uniqueness is scoped by broker account (legacy rows by mode and origin)",
    sql: `select indexdef from pg_indexes
          where schemaname = 'public' and indexname = 'strategy_runs_single_live'
            and (indexdef not ilike '%broker_account%' or indexdef not ilike '%execution_mode%'
                 or indexdef not ilike '%runtime_origin%')`,
    describe: () => "strategy_runs_single_live must key on broker_account, falling back to execution_mode and runtime_origin",
  },
  {
    name: "Every public table has row level security",
    sql: `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    describe: (row) => `RLS disabled on ${row.relname} — anyone with the anon key can read and write it`,
  },
  {
    name: "Browser roles have no direct write policies",
    sql: `select schemaname, tablename, policyname, cmd from pg_policies
          where schemaname = 'public' and cmd <> 'SELECT'`,
    describe: (row) => `write policy remains on ${row.tablename}: ${row.policyname} (${row.cmd})`,
  },
  {
    name: "Views respect the caller's RLS (security_invoker)",
    sql: `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'v'
            and not coalesce('security_invoker=true' = any(c.reloptions), false)`,
    describe: (row) => `view ${row.relname} runs as its owner and bypasses RLS`,
  },
  {
    name: "Queue and lease functions are backend-only",
    sql: `select f from unnest(array[${quoted(BACKEND_FUNCTIONS)}]) f
          where to_regprocedure('public.' || f) is not null
            and (has_function_privilege('anon', to_regprocedure('public.' || f), 'execute')
              or has_function_privilege('authenticated', to_regprocedure('public.' || f), 'execute'))`,
    describe: (row) => `${row.f} is callable with the anon/user key`,
  },
  {
    name: "Auth sign-ups get a club profile (0008 trigger)",
    sql: `select 'on_auth_user_created' as missing
          where not exists (select 1 from pg_trigger where tgname = 'on_auth_user_created')`,
    describe: () => "trigger on_auth_user_created is missing — new sign-ups get no app_users row",
  },
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url || url.includes("your-project")) {
    throw new Error("DATABASE_URL is not set to a real database (see src/runtime/migrate.ts).");
  }
  const caPath = process.env.DATABASE_CA_CERT;
  // The local Supabase stack's Postgres does not offer TLS.
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const client = new Client({
    connectionString: url,
    ssl: local ? false : caPath ? { ca: fs.readFileSync(caPath, "utf8") } : { rejectUnauthorized: false },
  });
  await client.connect();

  let failures = 0;
  try {
    for (const check of CHECKS) {
      const { rows } = await client.query(check.sql);
      if (rows.length === 0) {
        console.log(`PASS  ${check.name}`);
      } else {
        failures += rows.length;
        console.log(`FAIL  ${check.name}`);
        for (const row of rows) console.log(`        - ${check.describe(row)}`);
      }
    }
  } finally {
    await client.end();
  }

  if (failures > 0) {
    console.log(`\n${failures} problem(s). Run npm run db:status / db:migrate, then re-verify.`);
    process.exit(1);
  }
  console.log("\nDatabase schema and access controls look right.");
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
