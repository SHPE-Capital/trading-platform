/**
 * runtime/team3Bootstrap.ts
 *
 * Paired day-bootstrap of two saved Team 3 backtests (R6-T1; keep rule in
 * docs/team3/MASTER.md, Testing rules). A is the baseline, B the row.
 *
 *   npx ts-node src/runtime/team3Bootstrap.ts <backtestIdA> <backtestIdB> [--draws 10000] [--seed 20261123]
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
import { TEAM3_WINDOWS } from "../strategies/team3Reversal/contract/protocol";
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
  if (!stage3 && Date.parse(window.endDate) > Date.parse(TEAM3_WINDOWS.in.endDate)) {
    throw new Error(`backtest ${id} ends ${window.endDate}, after the in-sample window: OOS is locked until Stage 3 (pass --stage3 only then)`);
  }
  return { result, window };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const positional = args.filter((x, i) => !x.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && args[i - 1] !== "--stage3"));
  const [idA, idB] = positional;
  if (!idA || !idB) throw new Error("usage: team3Bootstrap.ts <backtestIdA> <backtestIdB> [--draws N] [--seed S] [--stage3]");
  const draws = Number(flag(args, "--draws") ?? BOOTSTRAP_DEFAULTS.draws);
  const seed = Number(flag(args, "--seed") ?? BOOTSTRAP_DEFAULTS.seed);
  const stage3 = args.includes("--stage3");

  const [a, b] = await Promise.all([load(idA, stage3), load(idB, stage3)]);
  if (a.window.startDate !== b.window.startDate || a.window.endDate !== b.window.endDate) {
    throw new Error(`windows differ: A ${a.window.startDate}..${a.window.endDate}, B ${b.window.startDate}..${b.window.endDate}`);
  }
  const capital = (r: BacktestResult) => (r.config as unknown as { initialCapital: number }).initialCapital;
  const dailyA = dailyPnl(a.result.equity_curve ?? [], capital(a.result), a.window);
  const dailyB = dailyPnl(b.result.equity_curve ?? [], capital(b.result), b.window);
  const boot = pairedDayBootstrap(dailyA, dailyB, { draws, seed });

  const net = (d: { pnl: number }[]) => +d.reduce((s, x) => s + x.pnl, 0).toFixed(2);
  console.log("TEAM3_BOOT " + JSON.stringify({ a: idA, b: idB, netA: net(dailyA), netB: net(dailyB), ...boot }));
}

main().then(() => process.exit(0)).catch((err) => {
  logger.error("runtime/team3Bootstrap: fatal error", { err: String(err) });
  process.exit(1);
});
