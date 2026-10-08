// Shared helpers for the local-stack, doctor, and setup scripts.
//
// The local database lives in a Docker volume keyed by the Supabase
// `project_id`, never by port. So when the stack has to start on different
// ports (Windows reserves port ranges, other projects squat on 54321, ...) the
// data is carried over by construction as long as `project_id` is unchanged.
// Everything here exists to keep that invariant and to fail loudly if it breaks.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const isWindows = process.platform === "win32";
export const dockerBin = isWindows ? "docker.exe" : "docker";
export const supabaseCli = path.join(ROOT, "node_modules", "supabase", "dist", "supabase.js");

export const LOCAL_DIR = path.join(ROOT, ".local");
export const WORKDIR = path.join(LOCAL_DIR, "supabase-workdir");
export const BACKUP_DIR = path.join(LOCAL_DIR, "backups");
const STATE_FILE = path.join(LOCAL_DIR, "stack.json");

/** Port layout is `base + offset`; 54320 reproduces the repo's config.toml. */
export const DEFAULT_BASE = 54320;
const OFFSETS = { shadow: 0, api: 1, db: 2, studio: 3, mailpit: 4, analytics: 7, pooler: 9 };
const CANDIDATE_BASES = [DEFAULT_BASE, 44320, 34320, 24320];

export const PROJECT_ID = /^project_id\s*=\s*"([^"]+)"/m.exec(
  readFileSync(path.join(ROOT, "supabase", "config.toml"), "utf8"),
)[1];
export const DB_CONTAINER = `supabase_db_${PROJECT_ID}`;
export const DB_VOLUME = `supabase_db_${PROJECT_ID}`;

export const LOCAL_LEAD = { email: "lead@local.test", password: "local-development-only" };

// ---------------------------------------------------------------------------
// Process + output helpers
// ---------------------------------------------------------------------------

export function exec(command, args, { capture = false, allowFail = false, env, timeout, cwd = ROOT } = {}) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      env: { ...process.env, ...env },
      timeout,
      maxBuffer: 1 << 30,
    });
  } catch (error) {
    if (allowFail) return null;
    throw error;
  }
}

export function supabaseArgs(remapped) {
  return remapped ? ["--workdir", WORKDIR] : [];
}

export function runSupabase(remapped, args, capture = false) {
  return exec(process.execPath, [supabaseCli, ...supabaseArgs(remapped), ...args], { capture });
}

export function fatal(title, lines = []) {
  const bar = "=".repeat(78);
  console.error(`\n${bar}\n  ERROR: ${title}\n${bar}`);
  for (const line of lines) console.error(line ? `  ${line}` : "");
  console.error(`${bar}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Prerequisites
// ---------------------------------------------------------------------------

export function nodeStatus() {
  const major = Number(process.versions.node.split(".")[0]);
  return {
    version: process.versions.node,
    ok: major >= 22,
    // Odd majors are short-lived "Current" releases; LTS is the safer choice.
    isLts: major % 2 === 0,
  };
}

export function dockerVersion() {
  const out = exec(dockerBin, ["info", "--format", "{{.ServerVersion}}"], { capture: true, allowFail: true, timeout: 20000 });
  return out?.trim() || null;
}

export function requireNode() {
  const node = nodeStatus();
  if (!node.ok) {
    fatal(`Node.js ${node.version} is too old`, ["This project needs Node.js 22 or newer.", "Install the current LTS from https://nodejs.org and re-run."]);
  }
  if (!node.isLts) console.warn(`Note: Node ${node.version} is not an LTS release. If you hit odd errors, try Node 22 LTS.`);
  if (!existsSync(supabaseCli)) {
    fatal("The Supabase CLI is not installed", ["Run `npm install` in the repo root first (it installs the pinned Supabase CLI)."]);
  }
}

export function requireDocker() {
  if (dockerVersion()) return;
  fatal("Docker is not running", [
    "Could not reach the Docker engine.",
    "",
    "  1. Start Docker Desktop and wait until it says \"Engine running\" (30-60s).",
    "  2. Check with:  docker info",
    "  3. Re-run this command.",
    "",
    isWindows ? "If Docker Desktop will not start: run `wsl --update`, then `wsl --shutdown`, and relaunch it." : "",
  ]);
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export function portsFor(base) {
  return Object.fromEntries(Object.entries(OFFSETS).map(([name, offset]) => [name, base + offset]));
}

/** A port is usable only if we can bind it (catches in-use AND Windows-reserved ranges). */
function canBind(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (error) => resolve({ ok: false, reason: error.code ?? "ERROR" }));
    server.once("listening", () => server.close(() => resolve({ ok: true })));
    server.listen(port, "0.0.0.0");
  });
}

const REQUIRED_OFFSETS = ["shadow", "api", "db", "studio", "mailpit"];

/** First base whose whole port block can be bound; null (plus reasons) if none. */
export async function pickBase(preferred) {
  const candidates = [...new Set([preferred, ...CANDIDATE_BASES].filter(Boolean))];
  const rejected = [];
  for (const base of candidates) {
    const ports = portsFor(base);
    let blocker = null;
    for (const name of REQUIRED_OFFSETS) {
      const result = await canBind(ports[name]);
      if (!result.ok) {
        blocker = `${ports[name]} (${name}): ${result.reason === "EACCES" ? "reserved by Windows/Hyper-V" : result.reason === "EADDRINUSE" ? "already in use" : result.reason}`;
        break;
      }
    }
    if (!blocker) return { base, rejected };
    rejected.push({ base, blocker });
  }
  return { base: null, rejected };
}

function publishedPort(container, internalPort) {
  const out = exec(dockerBin, ["port", container, `${internalPort}/tcp`], { capture: true, allowFail: true });
  const match = out && /:(\d+)/.exec(out);
  return match ? Number(match[1]) : null;
}

function containerRunning(name) {
  return exec(dockerBin, ["inspect", "-f", "{{.State.Running}}", name], { capture: true, allowFail: true })?.trim() === "true";
}

/** The already-running Supabase for this project, if any, with the ports it really uses. */
export function runningStack() {
  if (!containerRunning(DB_CONTAINER)) return null;
  const apiPort = publishedPort(`supabase_kong_${PROJECT_ID}`, 8000);
  const dbPort = publishedPort(DB_CONTAINER, 5432);
  if (!apiPort || !dbPort) return null;
  return { apiPort, dbPort, base: apiPort - OFFSETS.api, layoutOk: dbPort === apiPort + (OFFSETS.db - OFFSETS.api) };
}

export function dbVolumeExists() {
  return exec(dockerBin, ["volume", "inspect", DB_VOLUME], { capture: true, allowFail: true }) !== null;
}

// ---------------------------------------------------------------------------
// Remapped Supabase workdir (the repo's supabase/config.toml is never edited)
// ---------------------------------------------------------------------------

const PORT_KEYS = [
  ["api", "port", "api"],
  ["db", "port", "db"],
  ["db", "shadow_port", "shadow"],
  ["studio", "port", "studio"],
  ["local_smtp", "port", "mailpit"],
  ["inbucket", "port", "mailpit"],
  ["analytics", "port", "analytics"],
  ["db.pooler", "port", "pooler"],
];

export function remapConfig(toml, base) {
  const ports = portsFor(base);
  let section = "";
  let hasAnalytics = false;
  const lines = toml.split(/\r?\n/).map((line) => {
    const header = /^\s*\[([^\]]+)\]/.exec(line);
    if (header) {
      section = header[1];
      if (section === "analytics") hasAnalytics = true;
      return line;
    }
    for (const [sec, key, slot] of PORT_KEYS) {
      if (section === sec && new RegExp(`^\\s*${key}\\s*=\\s*\\d+`).test(line)) return `${key} = ${ports[slot]}`;
    }
    return line;
  });
  // Analytics defaults to a port inside the same reserved ranges; it is not needed locally.
  if (!hasAnalytics) lines.push("", "[analytics]", "enabled = false", `port = ${ports.analytics}`);
  return lines.join("\n");
}

export function prepareWorkdir(base) {
  const src = path.join(ROOT, "supabase");
  const dst = path.join(WORKDIR, "supabase");
  mkdirSync(dst, { recursive: true });
  rmSync(path.join(dst, "migrations"), { recursive: true, force: true });
  cpSync(path.join(src, "migrations"), path.join(dst, "migrations"), { recursive: true });
  if (existsSync(path.join(src, "seed.sql"))) cpSync(path.join(src, "seed.sql"), path.join(dst, "seed.sql"));
  writeFileSync(path.join(dst, "config.toml"), remapConfig(readFileSync(path.join(src, "config.toml"), "utf8"), base));
}

// ---------------------------------------------------------------------------
// Database access, state, backups
// ---------------------------------------------------------------------------

export function dbSql(sql) {
  const out = exec(dockerBin, ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql], { capture: true, allowFail: true, timeout: 30000 });
  return out === null ? null : out.trim();
}

/** Row counts of the tables that matter, or null if the schema is not there. */
export function readCounts() {
  const out = dbSql("select (select count(*) from public.app_users) || ',' || (select count(*) from public.strategies)");
  if (!out || !/^\d+,\d+$/.test(out)) return null;
  const [appUsers, strategies] = out.split(",").map(Number);
  return { app_users: appUsers, strategies };
}

export function appliedMigrations() {
  const out = dbSql("select count(*) from supabase_migrations.schema_migrations");
  return out && /^\d+$/.test(out) ? Number(out) : null;
}

export function repoMigrationCount() {
  return readdirSync(path.join(ROOT, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).length;
}

export function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

export function saveState(state) {
  mkdirSync(LOCAL_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2));
}

/** Plain-SQL safety copy of the whole local database. Keeps the newest three. */
export function backupDatabase(label = "auto") {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const dump = exec(dockerBin, ["exec", DB_CONTAINER, "pg_dump", "-U", "postgres", "-d", "postgres", "--no-owner", "--clean", "--if-exists"], { capture: true, allowFail: true, timeout: 120000 });
  if (!dump) return null;
  const file = path.join(BACKUP_DIR, `db-${new Date().toISOString().replace(/[:.]/g, "-")}-${label}.sql`);
  writeFileSync(file, dump);
  const all = readdirSync(BACKUP_DIR).filter((f) => f.startsWith("db-")).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 3))) rmSync(path.join(BACKUP_DIR, old), { force: true });
  return file;
}

export function latestBackup() {
  if (!existsSync(BACKUP_DIR)) return null;
  const all = readdirSync(BACKUP_DIR).filter((f) => f.startsWith("db-")).sort();
  return all.length ? path.join(BACKUP_DIR, all[all.length - 1]) : null;
}

export function describeSize(file) {
  return `${Math.max(1, Math.round(statSync(file).size / 1024))} KB`;
}
