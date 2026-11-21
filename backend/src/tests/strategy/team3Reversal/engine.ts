/**
 * tests/strategy/team3Reversal/engine.ts
 *
 * Runs Team 3 through the REAL BacktestEngine on in-memory bars, under
 * TEAM3_PROTOCOL. Fills, costs, risk checks and timing are exactly the
 * platform's, so a test here proves the contract, not a simulation of it.
 * (Test files must mock env first: see ./envMock.)
 */

import { BacktestEngine } from '../../../core/backtest/backtestEngine';
import type { BacktestLoader } from '../../../core/backtest/backtestLoader';
import type { IStrategy } from '../../../strategies/base/strategy';
import type { Bar } from '../../../types/market';
import type { StrategySignal } from '../../../types/strategy';
import { Team3ReversalStrategy } from '../../../strategies/team3Reversal/team3ReversalStrategy';
import { createTeam3ReversalConfig, type Team3ReversalConfig } from '../../../strategies/team3Reversal/team3ReversalConfig';
import { protocolBacktestConfig } from '../../../strategies/team3Reversal/contract/protocol';
import type { FilterSet } from '../../../strategies/team3Reversal/filters';

export const MINUTE = 60_000;

/** 9:30 ET on an October 2026 trading day (EDT, UTC-4), e.g. openOf('2026-10-06'). */
export function openOf(isoDay: string): number {
  const [y, m, d] = isoDay.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 13, 30);
}

export type Step = number | { close: number; open?: number; volume?: number };

/** One bar per minute from startTs. open defaults to the previous close. */
export function minuteBars(symbol: string, startTs: number, steps: Step[]): Bar[] {
  let prev: number | undefined;
  return steps.map((step, i) => {
    const s = typeof step === 'number' ? { close: step } : step;
    const open = s.open ?? prev ?? s.close;
    prev = s.close;
    const ts = startTs + i * MINUTE;
    return {
      symbol, ts, isoTs: new Date(ts).toISOString(), timeframe: '1Min',
      open, close: s.close, high: Math.max(open, s.close), low: Math.min(open, s.close), volume: s.volume ?? 100_000,
    };
  });
}

/** n quiet bars alternating mid +/- amp: a calm, choppy session around `mid`. */
export function chop(n: number, mid = 100, amp = 0.02): number[] {
  return Array.from({ length: n }, (_, i) => (i % 2 === 0 ? mid + amp : mid - amp));
}

/** A day for one symbol: optional pre-market bars ending 9:29, session bars from 9:30, after-hours from 16:00. */
export function day(symbol: string, isoDay: string, session: Step[], extra: { pre?: Step[]; post?: Step[] } = {}): Bar[] {
  const open = openOf(isoDay);
  const pre = extra.pre ?? [];
  return [
    ...minuteBars(symbol, open - pre.length * MINUTE, pre),
    ...minuteBars(symbol, open, session),
    ...minuteBars(symbol, open + 390 * MINUTE, extra.post ?? []),
  ];
}

/** Start time (ms) of session minute k (0 = the 9:30 bar). */
export const sessionMinute = (isoDay: string, k: number) => openOf(isoDay) + k * MINUTE;

/** Settings that let a test see one clean round trip without the stop firing on synthetic data. */
export const TEST_KNOBS: Partial<Team3ReversalConfig> = { stopZ: 1_000, skipOpenMinutes: 15 };

export async function runTeam3(
  bars: Bar[],
  overrides: Partial<Team3ReversalConfig> = {},
  opts: { others?: IStrategy[]; filters?: FilterSet } = {},
) {
  const symbols = [...new Set(bars.map((b) => b.symbol))].sort();
  const config = createTeam3ReversalConfig({ id: 'team3-test', symbols, ...overrides });
  const strategy = new Team3ReversalStrategy(config, opts.filters);

  // Record every signal Team 3 emits (meta included), without changing behaviour.
  const signals: StrategySignal[] = [];
  const evaluate = strategy.evaluate.bind(strategy);
  strategy.evaluate = (ctx) => {
    const s = evaluate(ctx);
    if (s) signals.push(s);
    return s;
  };

  const sorted = [...bars].sort((a, b) => a.ts - b.ts || a.symbol.localeCompare(b.symbol));
  const loader = { streamBars: async function* () { yield sorted; } } as unknown as BacktestLoader;
  const window = {
    startDate: new Date(sorted[0].ts).toISOString(),
    endDate: new Date(sorted[sorted.length - 1].ts + MINUTE).toISOString(),
  };
  const result = await new BacktestEngine(loader).run(
    protocolBacktestConfig(config, window, Team3ReversalStrategy.VERSION),
    () => [strategy, ...(opts.others ?? [])],
  );
  const orders = result.orders ?? [];
  const ours = new Set(orders.filter((o) => o.strategyId === config.id).map((o) => o.id));
  const fills = (result.fills ?? []).filter((f) => ours.has(f.orderId));
  return { result, strategy, signals, orders, fills };
}
