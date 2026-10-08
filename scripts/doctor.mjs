// `npm run doctor`: read-only health report for the local environment.
// Changes nothing. Exits 1 if any check FAILs (warnings do not fail).
//   --pre   only the checks that matter before the first `npm run dev:stack`

import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { canLogin } from "./lib/auth.mjs";
import {
  DB_VOLUME,
  DEFAULT_BASE,
  ROOT,
  appliedMigrations,
  dbVolumeExists,
  dockerBin,
  dockerVersion,
  exec,
  identifyAlpacaAccount,
  latestBackup,
  loadDataCredentials,
  loadState,
  nodeStatus,
  pickBase,
  portsFor,
  readCounts,
  repoMigrationCount,
  runningStack,
  supabaseCli,
} from "./lib/stack.mjs";

const preOnly = process.argv.includes("--pre");
const results = [];
const icon = { pass: "PASS", warn: "WARN", fail: "FAIL" };

function report(status, name, detail = "", fix = "") {
  results.push(status);
  console.log(`  [${icon[status]}] ${name}${detail ? ` - ${detail}` : ""}`);
  if (fix && status !== "pass") console.log(`         fix: ${fix}`);
}

function tcpOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1", timeout: 1500 });
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => (socket.destroy(), resolve(false)));
  });
}

async function httpStatus(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(5000) })).status;
  } catch {
    return null;
  }
}

console.log("\nEnvironment");
const node = nodeStatus();
if (!node.ok) report("fail", "Node.js", `${node.version} (need 22+)`, "install Node 22 LTS from https://nodejs.org");
else if (!node.isLts) report("warn", "Node.js", `${node.version} is not an LTS release`, "Node 22 LTS is the tested choice");
else report("pass", "Node.js", node.version);

report(
  existsSync(supabaseCli) ? "pass" : "fail",
  "Root dependencies (Supabase CLI)",
  "",
  "run `npm install` in the repo root",
);
for (const dir of ["backend", "frontend"]) {
  report(
    existsSync(path.join(ROOT, dir, "node_modules")) ? "pass" : "warn",
    `${dir}/node_modules`,
    existsSync(path.join(ROOT, dir, "node_modules")) ? "" : "only needed for your editor and running tests outside Docker",
    "run `npm run setup`",
  );
}
report(
  existsSync(path.join(ROOT, "backend", ".env")) ? "pass" : "warn",
  "backend/.env",
  existsSync(path.join(ROOT, "backend", ".env")) ? "" : "only needed outside Docker (e.g. `npm run data:pull`)",
  "run `npm run setup` (copies backend/.env.example)",
);

const creds = loadDataCredentials();
if (!creds.source) {
  report("warn", "Alpaca market-data keys", "none: backtests use the local bar cache only", "add your OWN free Alpaca keys as ALPACA_DATA_KEY/ALPACA_DATA_SECRET in backend/.env, or run `npm run data:pull`");
} else {
  const who = await identifyAlpacaAccount(creds.key, creds.secret);
  if (who.isClub) {
    report("warn", "Alpaca market-data keys", `${creds.source} holds the CLUB account's keys (${who.account}); dev:stack withholds them`, "put your own free Alpaca keys in ALPACA_DATA_KEY/ALPACA_DATA_SECRET (these take priority), or run `npm run data:pull`");
  } else {
    report("pass", "Alpaca market-data keys", `from ${creds.source}${who.account ? `, account ${who.account}` : " (could not verify the account)"}`);
  }
}

const docker = dockerVersion();
report(docker ? "pass" : "fail", "Docker engine", docker ? `v${docker}` : "not reachable", "start Docker Desktop and wait for \"Engine running\", then check `docker info`");

const state = loadState();
const running = docker ? runningStack() : null;
if (docker) {
  if (running) {
    report(
      "pass",
      "Supabase ports",
      `running on API ${running.apiPort} / DB ${running.dbPort}${running.base === DEFAULT_BASE ? "" : " (remapped; default ports unavailable)"}`,
    );
  } else {
    const picked = await pickBase(state?.base);
    if (picked.base) {
      const note = picked.base === DEFAULT_BASE ? "default ports are free" : `default ports blocked, will use ${picked.base + 1}...`;
      report("pass", "Supabase ports", note);
    } else {
      report(
        "fail",
        "Supabase ports",
        picked.rejected.map((r) => `${r.base}: ${r.blocker}`).join("; "),
        "free the ports, or on Windows `net stop winnat` then `net start winnat` (admin shell)",
      );
    }
  }
}

if (!preOnly && docker) {
  console.log("\nLocal database");
  if (!dbVolumeExists()) {
    report(
      state?.counts?.app_users > 0 ? "fail" : "warn",
      "Database volume",
      state?.counts?.app_users > 0 ? `"${DB_VOLUME}" is missing but previously held ${state.counts.app_users} user(s)` : "none yet (created on first `npm run dev:stack`)",
      state?.counts?.app_users > 0 ? `a safety copy may exist: ${latestBackup() ?? "none"}` : "",
    );
  } else {
    report("pass", "Database volume", DB_VOLUME);
  }

  if (!running) {
    report("warn", "Supabase containers", "not running", "run `npm run dev:stack`");
  } else {
    const apiUrl = `http://127.0.0.1:${running.apiPort}`;
    const applied = appliedMigrations();
    const expected = repoMigrationCount();
    if (applied === null) report("fail", "Migrations", "could not read migration history", "run `npm run dev:reset`");
    else if (applied < expected) report("fail", "Migrations", `${applied}/${expected} applied`, "run `npm run dev:stack` (applies pending ones)");
    else report("pass", "Migrations", `${applied}/${expected} applied`);

    const counts = readCounts();
    if (!counts) report("fail", "Schema", "app_users/strategies missing", "run `npm run dev:reset`");
    else report("pass", "Data", `${counts.app_users} user(s), ${counts.strategies} strateg(ies)`);

    const health = await httpStatus(`${apiUrl}/auth/v1/health`);
    report(health ? "pass" : "fail", "Supabase auth API", health ? apiUrl : `no response at ${apiUrl}`, "run `npm run dev:down` then `npm run dev:stack`");

    // The anon key lives in `supabase status`; reuse the one written to state-free output.
    const status = exec(process.execPath, [supabaseCli, ...(state?.remapped ? ["--workdir", path.join(ROOT, ".local", "supabase-workdir")] : []), "status", "-o", "env"], { capture: true, allowFail: true });
    const anon = status && /^(?:ANON_KEY|PUBLISHABLE_KEY)="?([^"\r\n]+)"?/m.exec(status)?.[1];
    if (anon) {
      report((await canLogin(apiUrl, anon)) ? "pass" : "fail", "Local login", "lead@local.test", "run `npm run dev:stack` (re-creates the account)");
    } else {
      report("warn", "Local login", "could not read the local API key");
    }
  }

  console.log("\nApplication");
  for (const [name, port] of [["Frontend", 3000], ["API", 8082], ["Paper runner", 8080]]) {
    report((await tcpOpen(port)) ? "pass" : "warn", name, `localhost:${port}`, "run `npm run dev:stack`");
  }
  const login = await httpStatus("http://localhost:3000/login");
  if (login !== null) report(login < 500 ? "pass" : "fail", "Frontend /login", `HTTP ${login}`, "see `docker logs shpe-trading-dev-frontend-1`");
}

const fails = results.filter((r) => r === "fail").length;
const warns = results.filter((r) => r === "warn").length;
console.log(`\n${fails ? "Problems found" : "Looks good"}: ${fails} failed, ${warns} warning(s).\n`);
process.exit(fails ? 1 : 0);
