// `npm run setup`: one-time, idempotent first-run bootstrap.
// Run `npm install` in the repo root first (it provides the Supabase CLI), then:
//   npm run setup && npm run dev:stack

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ROOT, fatal, requireNode } from "./lib/stack.mjs";

requireNode();

function step(title) {
  console.log(`\n== ${title}`);
}

step("Installing backend and frontend dependencies (for your editor and local tests)");
for (const dir of ["backend", "frontend"]) {
  const result = spawnSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: path.join(ROOT, dir), stdio: "inherit", shell: true });
  if (result.status !== 0) fatal(`npm install failed in ${dir}/`, ["Read the npm output above, fix it, and re-run `npm run setup`."]);
}

step("Creating env files from templates (never overwrites existing ones)");
for (const [example, target] of [
  ["backend/.env.example", "backend/.env"],
  ["frontend/.env.example", "frontend/.env.local"],
]) {
  const from = path.join(ROOT, example);
  const to = path.join(ROOT, target);
  if (existsSync(to)) console.log(`  keep    ${target}`);
  else if (existsSync(from)) (copyFileSync(from, to), console.log(`  created ${target}`));
  else console.log(`  skipped ${target} (no ${example})`);
}
console.log("  The Docker stack injects its own local URLs and keys; these files only matter outside Docker.");

step("Checking prerequisites");
const doctor = spawnSync(process.execPath, [path.join(ROOT, "scripts", "doctor.mjs"), "--pre"], { stdio: "inherit" });
if (doctor.status !== 0) {
  fatal("Setup finished, but a prerequisite is failing", ["Fix the FAIL items above (usually: start Docker Desktop), then run `npm run doctor`."]);
}

console.log(`
Setup complete. Next:
  npm run dev:stack      start Supabase + the app (first run pulls images; takes a few minutes)
  npm run doctor         health report any time
Log in at http://localhost:3000 with lead@local.test / local-development-only
`);
