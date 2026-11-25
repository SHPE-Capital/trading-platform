/**
 * runtime/team3Bootstrap.ts
 *
 * Paired day-bootstrap of two saved Team 3 backtests (R6-T1; keep rule in
 * docs/team3/MASTER.md, Testing rules). A is the baseline, B the row.
 *
 *   npx ts-node src/runtime/team3Bootstrap.ts <rowId>                 (vs its universe's frozen V4 baseline)
 *   npx ts-node src/runtime/team3Bootstrap.ts <baselineId> <rowId> [--draws 10000] [--seed 20261123]
 *
 * One id: the row's universe is read from its saved symbols and the matching
 * baseline is used (Momentum -> A04, Core -> A03; TEAM3_BASELINES in protocol.ts).
 * Two ids: both runs must be the same universe, or it refuses.
 *
 * Reads both equity curves from Supabase, rebuilds daily net P&L by ET date
 * (contract/daily.ts), and prints one line:
 *   TEAM3_BOOT {"a":..,"b":..,"all":{n,meanDiff,shareBBeatsA,ci95},"firstHalf":..,"secondHalf":..,"halvesAgree":..}
 *
 * Refuses runs that touch out-of-sample days unless --stage3 is given (OOS ban).
 */

import { getBacktestResultById } from "../adapters/supabase/repositories";
import { pairedDayBootstrap, BOOTSTRAP_DEFAULTS } from "../strategies/team3Reversal/contract/bootstrap";
import { dailyPnl } from "../strategies/team3Reversal/contract/daily";
import { TEAM3_BASELINES, oosLocked, universeOf } from "../strategies/team3Reversal/contract/protocol";
import type { BacktestResult } from "../types/backtest";
import { logger } from "../utils/logger";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function load(id: string, stage3: boolean): Promise<{ result: BacktestResult; window: { startDate: string; endDate: string } }> {
  const result = await getBacktestResultById(id);
  if (!result) throw new Error(`backtest ${id} not found (was its summary saved?)`);
  const cfg = result.config as unknown as { startDate: string; endDate: string };
  const window = { startDate: cfg.startDate, endDate: cfg.endDate };
  if (oosLocked(window.endDate, stage3)) {
    throw new Error(`backtest ${id} ends ${window.endDate}, after the in-sample window: OOS is locked until Stage 3 (pass --stage3 only then)`);
  }
  return { result, window };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const positional = args.filter((x, i) => !x.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && args[i - 1] !== "--stage3"));
  if (positional.length < 1 || positional.length > 2) throw new Error("usage: team3Bootstrap.ts [<baselineId>] <rowId> [--draws N] [--seed S] [--stage3]");
  const draws = Number(flag(args, "--draws") ?? BOOTSTRAP_DEFAULTS.draws);
  const seed = Number(flag(args, "--seed") ?? BOOTSTRAP_DEFAULTS.seed);
  const stage3 = args.includes("--stage3");

  const universe = (r: BacktestResult) => universeOf((r.config as unknown as { strategyConfig: { symbols: string[] } }).strategyConfig.symbols ?? []);
  let idA: string, idB: string;
  let a: Awaited<ReturnType<typeof load>>, b: Awaited<ReturnType<typeof load>>;
  if (positional.length === 1) {
    idB = positional[0];
    b = await load(idB, stage3);
    const u = universe(b.result);
    if (!u || u === "expanded") throw new Error(`backtest ${idB}: no frozen baseline for this universe (${u ?? "?"}); pass the baseline id explicitly`);
    idA = TEAM3_BASELINES[u];
    a = await load(idA, stage3);
  } else {
    [idA, idB] = positional;
    [a, b] = await Promise.all([load(idA, stage3), load(idB, stage3)]);
    const ua = universe(a.result), ub = universe(b.result);
    if (!ua || ua !== ub) throw new Error(`universes differ or are unknown: A ${ua ?? "?"}, B ${ub ?? "?"} (compare Momentum rows to A04 and Core rows to A03)`);
  }
  if (a.window.startDate !== b.window.startDate || a.window.endDate !== b.window.endDate) {
    throw new Error(`windows differ: A ${a.window.startDate}..${a.window.endDate}, B ${b.window.startDate}..${b.window.endDate}`);
  }
  const capital = (r: BacktestResult) => (r.config as unknown as { initialCapital: number }).initialCapital;
  const dailyA = dailyPnl(a.result.equity_curve ?? [], capital(a.result), a.window);
  const dailyB = dailyPnl(b.result.equity_curve ?? [], capital(b.result), b.window);
  const boot = pairedDayBootstrap(dailyA, dailyB, { draws, seed });

  const net = (d: { pnl: number }[]) => +d.reduce((s, x) => s + x.pnl, 0).toFixed(2);
  console.log("TEAM3_BOOT " + JSON.stringify({ universe: universe(b.result), a: idA, b: idB, netA: net(dailyA), netB: net(dailyB), ...boot }));
}

main().then(() => process.exit(0)).catch((err) => {
  logger.error("runtime/team3Bootstrap: fatal error", { err: String(err) });
  process.exit(1);
});
