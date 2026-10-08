import { spawnSync } from "node:child_process";
import { canLogin, ensureLocalLead } from "./lib/auth.mjs";
import {
  DB_VOLUME,
  DEFAULT_BASE,
  PROJECT_ID,
  backupDatabase,
  dbVolumeExists,
  describeSize,
  dockerBin,
  exec,
  fatal,
  latestBackup,
  loadState,
  pickBase,
  portsFor,
  prepareWorkdir,
  readCounts,
  requireDocker,
  requireNode,
  runSupabase,
  runningStack,
  saveState,
} from "./lib/stack.mjs";

const action = process.argv[2] ?? "up";
const extraArgs = process.argv.slice(3);
const fresh = extraArgs.includes("--fresh");
const composeArgs = extraArgs.filter((arg) => arg !== "--fresh");
const COMPOSE_FILE = "docker/docker-compose.dev.yml";

function parseEnv(output) {
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function gitValue(args, fallback) {
  try {
    return exec(process.platform === "win32" ? "git.exe" : "git", args, { capture: true }).trim() || fallback;
  } catch {
    return fallback;
  }
}

if (!["up", "down", "reset"].includes(action)) {
  throw new Error(`Unknown action "${action}". Use up, down, or reset.`);
}

requireNode();
requireDocker();

const state = loadState();

if (action === "down") {
  spawnSync(dockerBin, ["compose", "-f", COMPOSE_FILE, "down"], {
    stdio: "inherit",
    env: {
      ...process.env,
      LOCAL_SUPABASE_ANON_KEY: "unused-while-stopping",
      LOCAL_SUPABASE_SERVICE_ROLE_KEY: "unused-while-stopping",
      LOCAL_DATABASE_URL: "postgresql://unused:unused@localhost/unused",
    },
  });
  runSupabase(Boolean(state?.remapped), ["stop"]);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 1. Decide which ports Supabase uses
// ---------------------------------------------------------------------------

const running = runningStack();
let base;
if (running) {
  if (!running.layoutOk) {
    fatal("Supabase is already running with a port layout this script cannot reuse", [
      `API on ${running.apiPort}, database on ${running.dbPort}.`,
      "Stop it and start again (your data is kept):",
      "  npm run dev:down && npm run dev:stack",
    ]);
  }
  base = running.base; // never move a live database: reuse exactly what is running
} else {
  const picked = await pickBase(state?.base);
  if (!picked.base) {
    fatal("No free port block for the local Supabase", [
      "Tried these port blocks and each had a blocked port:",
      ...picked.rejected.map((r) => `  ${r.base}-${r.base + 4}: ${r.blocker}`),
      "",
      "On Windows, see reserved ranges with:",
      "  netsh interface ipv4 show excludedportrange protocol=tcp",
      "Free the ports (or run `net stop winnat` then `net start winnat` in an admin shell) and retry.",
    ]);
  }
  base = picked.base;
}
const remapped = base !== DEFAULT_BASE;
const ports = portsFor(base);
if (remapped) prepareWorkdir(base);

if (remapped && !running) {
  console.log(`Default Supabase ports (${DEFAULT_BASE + 1}...) are unavailable here; using ${base + 1}...`);
}

// ---------------------------------------------------------------------------
// 2. Data safety before anything starts
// ---------------------------------------------------------------------------

const hadVolume = dbVolumeExists();
if (!hadVolume && !running && state?.counts?.app_users > 0 && !fresh) {
  const backup = latestBackup();
  fatal("The local database is gone", [
    `The last run had ${state.counts.app_users} user(s) and ${state.counts.strategies} strateg(ies), but the Docker volume`,
    `"${DB_VOLUME}" no longer exists (Docker Desktop reset, \`docker volume prune\`, or a different Docker context).`,
    "",
    backup ? `Latest safety copy: ${backup} (${describeSize(backup)})` : "No safety copy exists.",
    backup ? "Restore after a fresh start with:  docker exec -i " + `supabase_db_${PROJECT_ID} psql -U postgres -d postgres < "${backup}"` : "",
    "",
    "To start from an empty database anyway:  npm run dev:stack -- --fresh",
  ]);
}
if (!hadVolume) {
  console.log("No existing local database found: creating a fresh one (migrations + seed).");
} else if (state && state.base !== undefined && state.base !== base) {
  console.log(`Supabase ports changed (${state.base + 1} -> ${base + 1}). Your data lives in the Docker volume "${DB_VOLUME}", which is port-independent, so it is reused as-is.`);
}

// ---------------------------------------------------------------------------
// 3. Start Supabase, bring the schema current, verify nothing was lost
// ---------------------------------------------------------------------------

try {
  runSupabase(remapped, ["start"]);
} catch {
  fatal("`supabase start` failed", [
    "Read the Supabase output above. Common causes:",
    "  - a port in this block is now taken:   npm run doctor",
    "  - containers from an old run are stuck: npm run dev:down, then retry",
  ]);
}

if (action === "reset") {
  if (hadVolume && backupDatabase("pre-reset")) console.log("Saved a pre-reset safety copy under .local/backups/.");
  runSupabase(remapped, ["db", "reset"]);
} else {
  try {
    runSupabase(remapped, ["migration", "up"]);
  } catch {
    fatal("Applying pending migrations failed", [
      "The database is running but a migration in supabase/migrations/ did not apply.",
      "Fix the migration, or if this is a throwaway local DB:  npm run dev:reset",
    ]);
  }
}

const counts = readCounts();
if (!counts) {
  fatal("The database schema is missing", [
    "Supabase is running but public.app_users / public.strategies do not exist, so migrations did not apply.",
    "Rebuild the local database from migrations:  npm run dev:reset",
  ]);
}
if (action === "up" && !fresh && state?.counts && (counts.app_users < state.counts.app_users || counts.strategies < state.counts.strategies)) {
  const backup = latestBackup();
  fatal("Local data went missing", [
    `Last run: ${state.counts.app_users} user(s), ${state.counts.strategies} strateg(ies). Now: ${counts.app_users} user(s), ${counts.strategies} strateg(ies).`,
    "Nothing has been started. Do not run dev:reset until you have checked the volume.",
    backup ? `Safety copy: ${backup} (${describeSize(backup)})` : "No safety copy exists.",
    "If the smaller dataset is expected, accept it with:  npm run dev:stack -- --fresh",
  ]);
}

// ---------------------------------------------------------------------------
// 4. Local account, login check, safety copy, state
// ---------------------------------------------------------------------------

const local = parseEnv(runSupabase(remapped, ["status", "-o", "env"], true));
const apiUrl = local.API_URL ?? `http://127.0.0.1:${ports.api}`;
const anonKey = local.ANON_KEY ?? local.PUBLISHABLE_KEY;
const serviceKey = local.SERVICE_ROLE_KEY ?? local.SECRET_KEY;
const dbUrl = local.DB_URL ?? `postgresql://postgres:postgres@127.0.0.1:${ports.db}/postgres`;
if (!anonKey || !serviceKey) fatal("Supabase status did not return local API keys", ["Run `npm run dev:down` and retry."]);

try {
  await ensureLocalLead(apiUrl, serviceKey);
} catch (error) {
  fatal("Could not provision the local lead account", [error.message]);
}
if (!(await canLogin(apiUrl, anonKey))) {
  fatal("The local lead exists but cannot sign in", [
    "lead@local.test / local-development-only was rejected by the local auth service.",
    "Reset the account's password in Supabase Studio or run `npm run dev:reset`.",
  ]);
}

const finalCounts = readCounts() ?? counts;
const backupFile = backupDatabase(action);
if (backupFile) console.log(`Safety copy of the local database: ${backupFile} (${describeSize(backupFile)})`);
saveState({ base, remapped, apiPort: ports.api, counts: finalCounts });

// ---------------------------------------------------------------------------
// 5. App containers
// ---------------------------------------------------------------------------

const composeEnv = {
  LOCAL_SUPABASE_API_PORT: String(new URL(apiUrl).port || ports.api),
  LOCAL_SUPABASE_ANON_KEY: anonKey,
  LOCAL_SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  LOCAL_DATABASE_URL: dbUrl.replace("127.0.0.1", "host.docker.internal").replace("localhost", "host.docker.internal"),
  LOCAL_BUILD_SHA: gitValue(["rev-parse", "--short=12", "HEAD"], "local"),
  LOCAL_BUILD_DIRTY: gitValue(["status", "--porcelain"], "") ? "true" : "false",
};

console.log(`
Local account: lead@local.test / local-development-only
App: http://localhost:3000   Supabase API: ${apiUrl}
Supabase Studio: http://127.0.0.1:${ports.studio}   Mailpit: http://127.0.0.1:${ports.mailpit}
Health check any time with: npm run doctor
`);

const compose = spawnSync(dockerBin, ["compose", "-f", COMPOSE_FILE, "up", "--build", ...composeArgs], {
  stdio: "inherit",
  env: { ...process.env, ...composeEnv },
});
process.exit(compose.status ?? 1);
