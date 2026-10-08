#!/usr/bin/env node
/**
 * Fails when strategy algorithm code changes without its VERSION going up.
 *
 * Every backtest and run records the algorithm VERSION it ran, and approval
 * only accepts evidence produced by the deployed VERSION. That guarantee is
 * worth nothing if behaviour changes while the number stays the same, so this
 * check turns "remember to bump" into a required CI status.
 *
 * A strategy needs a bump when:
 *   - any non-test file in its own folder (backend/src/strategies/<dir>/) changed, or
 *   - a shared module it imports changed (strategies/base, services/indicators,
 *     core/state/rollingWindow).
 *
 * Behaviour-neutral refactors can opt out with the PR label
 * `strategy-version-unchanged` (or STRATEGY_VERSION_OVERRIDE=1 locally).
 *
 * Usage: node scripts/check-strategy-versions.mjs [--base <ref>] [--head <ref>]
 *   --base defaults to origin/$GITHUB_BASE_REF, else origin/main.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const OVERRIDE_LABEL = "strategy-version-unchanged";
const STRATEGIES = "backend/src/strategies/";
const SHARED = ["backend/src/strategies/base/", "backend/src/services/indicators/", "backend/src/core/state/rollingWindow.ts"];
const VERSION_RE = /static\s+readonly\s+VERSION\s*=\s*(\d+)/;

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const show = (ref, path) => { try { return git("show", `${ref}:${path}`); } catch { return null; } };

const base = arg("--base") ?? `origin/${process.env.GITHUB_BASE_REF || "main"}`;
const head = arg("--head") ?? "HEAD";

function overridden() {
  if (process.env.STRATEGY_VERSION_OVERRIDE === "1") return "STRATEGY_VERSION_OVERRIDE=1";
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) return null;
  const labels = JSON.parse(fs.readFileSync(eventPath, "utf8")).pull_request?.labels ?? [];
  return labels.some((l) => l.name === OVERRIDE_LABEL) ? `label "${OVERRIDE_LABEL}"` : null;
}

const mergeBase = git("merge-base", base, head);
const changed = git("diff", "--name-only", mergeBase, head).split("\n").filter(Boolean);
const isBehaviourFile = (p) => p.endsWith(".ts") && !p.includes("/tests/") && !p.endsWith(".test.ts");

// Versioned strategies as they exist at head: folder -> { file, version }.
const strategies = new Map();
for (const file of git("ls-tree", "-r", "--name-only", head, STRATEGIES).split("\n")) {
  if (!isBehaviourFile(file) || file.startsWith("backend/src/strategies/base/")) continue;
  const match = VERSION_RE.exec(show(head, file) ?? "");
  if (match) strategies.set(file.slice(STRATEGIES.length).split("/")[0], { file, version: Number(match[1]) });
}

const sharedChanges = changed.filter((p) => isBehaviourFile(p) && SHARED.some((s) => p.startsWith(s)));
const failures = [];

for (const [dir, { file, version }] of strategies) {
  const prefix = `${STRATEGIES}${dir}/`;
  const ownChanges = changed.filter((p) => p.startsWith(prefix) && isBehaviourFile(p));

  // Shared modules this strategy actually imports, matched by module path.
  const sources = git("ls-tree", "-r", "--name-only", head, prefix).split("\n")
    .filter(isBehaviourFile).map((f) => show(head, f) ?? "").join("\n");
  const importedShared = sharedChanges.filter((p) => {
    const module = p.replace(/^backend\/src\//, "").replace(/\.ts$/, "");
    const tail = module.split("/").slice(-2).join("/"); // e.g. indicators/zscore, base/strategy
    return sources.includes(tail);
  });

  const reasons = [...ownChanges, ...importedShared];
  if (reasons.length === 0) continue;

  const before = VERSION_RE.exec(show(mergeBase, file) ?? "");
  if (!before) continue; // new strategy, or VERSION newly introduced: nothing to compare
  if (version > Number(before[1])) {
    console.log(`ok   ${dir}: v${before[1]} -> v${version}`);
    continue;
  }
  failures.push({ dir, file, from: Number(before[1]), to: version, reasons });
}

if (failures.length === 0) {
  console.log(`Strategy versions OK (${changed.length} changed files, base ${base}).`);
  process.exit(0);
}

const why = overridden();
for (const f of failures) {
  const msg = `${f.dir} changed without a VERSION bump (still v${f.to}, was v${f.from}). ` +
    `Changed: ${f.reasons.join(", ")}`;
  if (why) console.log(`::warning file=${f.file}::${msg} — allowed by ${why}`);
  else console.log(`::error file=${f.file}::${msg}`);
}
if (why) {
  console.log(`Behaviour-neutral change declared via ${why}; not failing.`);
  process.exit(0);
}
console.log(
  `\nBump "static readonly VERSION" in each strategy above so results and approvals can tell the old ` +
  `algorithm from the new one. If the change cannot alter signals or sizing, add the PR label ` +
  `"${OVERRIDE_LABEL}".`,
);
process.exit(1);
