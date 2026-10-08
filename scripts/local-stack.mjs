import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const isWindows = process.platform === "win32";
const docker = isWindows ? "docker.exe" : "docker";
const supabaseCli = fileURLToPath(new URL("../node_modules/supabase/dist/supabase.js", import.meta.url));
const action = process.argv[2] ?? "up";

function runSupabase(args, capture = false) {
  return run(process.execPath, [supabaseCli, ...args], capture);
}

function run(command, args, capture = false, extraEnv = {}) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    env: { ...process.env, ...extraEnv },
  });
}

function parseEnv(output) {
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return values;
}

async function ensureLocalLead(apiUrl, serviceKey) {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  const email = "lead@local.test";
  const password = "local-development-only";
  const usersResponse = await fetch(`${apiUrl}/auth/v1/admin/users?page=1&per_page=1000`, { headers });
  if (!usersResponse.ok) throw new Error(`Could not list local auth users: ${await usersResponse.text()}`);
  const usersBody = await usersResponse.json();
  let user = usersBody.users?.find((candidate) => candidate.email === email);
  if (!user) {
    const createResponse = await fetch(`${apiUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name: "Local Lead" } }),
    });
    if (!createResponse.ok) throw new Error(`Could not create the local lead: ${await createResponse.text()}`);
    user = await createResponse.json();
  }

  const profileResponse = await fetch(`${apiUrl}/rest/v1/app_users?id=eq.${encodeURIComponent(user.id)}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ membership_status: "active", role: "lead" }),
  });
  if (!profileResponse.ok) throw new Error(`Could not activate the local lead: ${await profileResponse.text()}`);
}

function gitValue(args, fallback) {
  try {
    return run(isWindows ? "git.exe" : "git", args, true).trim() || fallback;
  } catch {
    return fallback;
  }
}

if (action === "down") {
  spawnSync(docker, ["compose", "-f", "docker/docker-compose.dev.yml", "down"], {
    stdio: "inherit",
    env: {
      ...process.env,
      LOCAL_SUPABASE_ANON_KEY: "unused-while-stopping",
      LOCAL_SUPABASE_SERVICE_ROLE_KEY: "unused-while-stopping",
      LOCAL_DATABASE_URL: "postgresql://unused:unused@localhost/unused",
    },
  });
  runSupabase(["stop"]);
  process.exit(0);
}

if (action === "reset") {
  runSupabase(["start"]);
  runSupabase(["db", "reset"]);
} else if (action !== "up") {
  throw new Error(`Unknown action "${action}". Use up, down, or reset.`);
} else {
  runSupabase(["start"]);
}

const local = parseEnv(runSupabase(["status", "-o", "env"], true));
const apiUrl = local.API_URL ?? "http://127.0.0.1:54321";
const anonKey = local.ANON_KEY ?? local.PUBLISHABLE_KEY;
const serviceKey = local.SERVICE_ROLE_KEY ?? local.SECRET_KEY;
const dbUrl = local.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!anonKey || !serviceKey) throw new Error("Supabase status did not return local API keys.");

await ensureLocalLead(apiUrl, serviceKey);

const composeEnv = {
  LOCAL_SUPABASE_ANON_KEY: anonKey,
  LOCAL_SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  LOCAL_DATABASE_URL: dbUrl.replace("127.0.0.1", "host.docker.internal").replace("localhost", "host.docker.internal"),
  LOCAL_BUILD_SHA: gitValue(["rev-parse", "--short=12", "HEAD"], "local"),
  LOCAL_BUILD_DIRTY: gitValue(["status", "--porcelain"], "") ? "true" : "false",
};

console.log("\nLocal account: lead@local.test / local-development-only");
console.log("App: http://localhost:3000  Supabase Studio: http://localhost:54323\n");

const compose = spawnSync(
  docker,
  ["compose", "-f", "docker/docker-compose.dev.yml", "up", "--build", ...process.argv.slice(3)],
  { stdio: "inherit", env: { ...process.env, ...composeEnv } },
);
process.exit(compose.status ?? 1);
