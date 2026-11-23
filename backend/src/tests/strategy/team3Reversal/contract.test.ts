/**
 * tests/strategy/team3Reversal/contract.test.ts
 *
 * One test per row of strategies/team3Reversal/CONTRACT.md. Each runs Team 3
 * through the real BacktestEngine under TEAM3_PROTOCOL. If the platform changes
 * one of our assumptions, the matching test fails here, not as a mystery P&L.
 */

jest.mock('../../../config/env', () => jest.requireActual('./envMock'));

import { BaseStrategy, type EvaluationContext } from '../../../strategies/base/strategy';
import type { StrategySignal, StrategyType } from '../../../types/strategy';
import { Team3ReversalStrategy } from '../../../strategies/team3Reversal/team3ReversalStrategy';
import { createTeam3ReversalConfig, validateTeam3ReversalConfig } from '../../../strategies/team3Reversal/team3ReversalConfig';
import { TEAM3_PROTOCOL } from '../../../strategies/team3Reversal/contract/protocol';
import type { EntryInput } from '../../../strategies/team3Reversal/filters/types';
import { STRATEGY_DEFINITIONS } from '../../../config/strategyDefaults';
import { MINUTE, TEST_KNOBS, chop, day, runTeam3, sessionMinute } from './engine';

const DAY = '2026-10-06';
const NEXT_DAY = '2026-10-07';
/** Calm 40 minutes, a 1% spike up at minute 40, then back to VWAP. */
const SPIKE = [...chop(40), 101, { open: 100.9, close: 100.8 }, 100.3, 100.0, ...chop(20)];

describe('Platform gives us', () => {
  it('G1: a signal on bar k fills at bar k+1 open (plus costs), never at bar k close', async () => {
    const { fills, signals } = await runTeam3(day('AAPL', DAY, SPIKE), TEST_KNOBS);
    expect(signals[0].direction).toBe('short');
    const entry = fills[0];
    expect(entry.ts).toBe(sessionMinute(DAY, 41));                     // bar 41 opens when bar 40 ends
    expect(entry.price).toBeCloseTo(100.9 * (1 - 7 / 10_000), 4);      // open - (slippage 5 + half spread 2) bps
  });

  it('G2: other symbols are read for the same minute (cross-section), even when evaluated later', async () => {
    const lag: number[] = [];
    const probe = {
      entry: [{
        name: 'probe', switchKey: 'useVwapRegime' as const, status: 'done' as const,
        allows: ({ bar, barsOf }: EntryInput) => { lag.push(bar.ts - barsOf('SPY')[barsOf('SPY').length - 1].ts); return true; },
      }],
    };
    const bars = [...day('AAPL', DAY, SPIKE), ...day('SPY', DAY, chop(SPIKE.length, 500, 0.1))];
    await runTeam3(bars, { ...TEST_KNOBS, useVwapRegime: true }, { filters: probe });
    expect(lag.length).toBeGreaterThan(0);
    expect(lag.every((d) => d === 0)).toBe(true);                     // SPY's bar is this minute's, not last minute's
  });

  it('G3: the protocol fixes the risk config, with the run-long kill switch off', () => {
    expect(TEAM3_PROTOCOL.riskConfig.maxIntradayDrawdownPct).toBe(1);
    expect(TEAM3_PROTOCOL).toMatchObject({ initialCapital: 100_000, slippageBps: 5, commissionPerShare: 0.005 });
  });
});

describe('We promise back', () => {
  it('P1: pre-market and after-hours bars never trade, and never feed VWAP or the previous bar', async () => {
    const wild = [90, 110, 90, 110, 90];
    const clean = await runTeam3(day('AAPL', DAY, SPIKE), TEST_KNOBS);
    const dirty = await runTeam3(day('AAPL', DAY, SPIKE, { pre: wild, post: wild }), TEST_KNOBS);
    expect(clean.signals.length).toBeGreaterThan(0);
    expect(dirty.signals.map((s) => s.meta)).toEqual(clean.signals.map((s) => s.meta));
  });

  it('P2: the 9:30 bar never fades the overnight gap', async () => {
    const bars = [
      ...day('AAPL', DAY, chop(390)),
      ...day('AAPL', NEXT_DAY, [{ open: 103, close: 103 }, ...chop(30, 103)]),   // gaps up 3% overnight
    ];
    const { signals } = await runTeam3(bars, { ...TEST_KNOBS, skipOpenMinutes: 0 });
    expect(signals).toHaveLength(0);
  });

  it('P3: flat by the close every day, even if the trade never comes back', async () => {
    const late = [...chop(370), 101, ...Array(19).fill(101.5)];       // spikes at 15:40 and never returns
    const { signals, fills } = await runTeam3(day('AAPL', DAY, late), { ...TEST_KNOBS, maxHoldBars: 1_000 });
    expect(signals.map((s) => s.meta?.reason ?? s.direction)).toEqual(['short', 'close']);
    expect(fills.reduce((n, f) => n + (f.side === 'buy' ? f.qty : -f.qty), 0)).toBe(0);
    expect(fills[fills.length - 1].ts).toBeLessThan(sessionMinute(DAY, 390));   // filled before 16:00
  });

  it('P4: caps hold: $ per symbol and $ gross (shorts included), pending orders counted', async () => {
    const names = ['AAPL', 'AMZN', 'MSFT', 'QQQ'];
    const bars = names.flatMap((s) => day(s, DAY, SPIKE));               // all four spike in the same minute
    const { signals, fills } = await runTeam3(bars, { ...TEST_KNOBS, tradeUsd: 5_000, maxPositionSizeUsd: 5_000, maxGrossUsd: 12_000 });
    const entries = signals.filter((s) => s.meta?.kind === 'enter');
    expect(entries.map((s) => s.qty)).toEqual([49, 49, 20]);              // third trimmed to fit $12k, fourth has no room
    expect(entries.every((s) => s.qty * 101 <= 5_000)).toBe(true);         // per-symbol cap
    const entryNotional = fills.filter((f) => f.ts === fills[0].ts).reduce((n, f) => n + f.notional, 0);
    expect(entryNotional).toBeLessThanOrEqual(12_000);
  });

  it("P5: the position is Team 3's own: another strategy on the same symbol does not leak in", async () => {
    const bars = day('AAPL', DAY, SPIKE);
    const alone = await runTeam3(bars, TEST_KNOBS);
    const shared = await runTeam3(bars, TEST_KNOBS, { others: [new BuyAndHold('other-strategy', 'AAPL', 30)] });
    expect(shared.signals.map((s) => [s.direction, s.qty])).toEqual(alone.signals.map((s) => [s.direction, s.qty]));
    expect(shared.result.final_portfolio.positions.find((p) => p.symbol === 'AAPL')?.qty).toBe(30);   // only the other's shares remain
  });

  it('P6: exit meta entryPrice is the real average fill of the entry, and the exit closes exactly what we hold', async () => {
    const { signals, fills } = await runTeam3(day('AAPL', DAY, SPIKE), TEST_KNOBS);
    const exit = signals.find((s) => s.meta?.kind === 'exit')!;
    expect(exit.meta?.entryPrice).toBeCloseTo(fills[0].price, 8);
    expect(exit.qty).toBe(fills[0].qty);
  });

  it('P7: under the protocol the engine accepts every order (no contract violations)', async () => {
    const bars = ['AAPL', 'MSFT'].flatMap((s) => [...day(s, DAY, SPIKE), ...day(s, NEXT_DAY, SPIKE)]);
    const { strategy, signals } = await runTeam3(bars, TEST_KNOBS);
    expect(signals).toHaveLength(8);                                       // 2 symbols x 2 days x (entry + exit)
    expect(strategy.book.violations).toEqual([]);
  });

  it('P8: every signal has whole qty > 0 and a direction the platform maps to an order', async () => {
    const { signals } = await runTeam3(day('AAPL', DAY, SPIKE), TEST_KNOBS);
    for (const s of signals) {
      expect(Number.isInteger(s.qty) && s.qty > 0).toBe(true);
      expect(['long', 'short', 'close_long', 'close_short']).toContain(s.direction);
    }
  });

  it('P9: a filter still marked stub cannot be switched on', () => {
    expect(() => validateTeam3ReversalConfig(createTeam3ReversalConfig({ useVolume: true }))).toThrow(/stub/);
    expect(() => validateTeam3ReversalConfig(createTeam3ReversalConfig({ useRelativeToSpy: true }))).toThrow(/stub/);
  });

  it('P10: results are tied to VERSION 5, and the catalog reports it', () => {
    expect(Team3ReversalStrategy.VERSION).toBe(5);
    expect(STRATEGY_DEFINITIONS.team3_reversal.algorithmVersion).toBe(5);
  });
});

/** Another strategy on the same account: buys `qty` of a symbol on its first bar and holds. */
class BuyAndHold extends BaseStrategy {
  readonly type: StrategyType = 'beginner_reversal';
  private done = false;
  constructor(id: string, private readonly symbol: string, private readonly qty: number) {
    super({ id, name: 'buy and hold', type: 'beginner_reversal', symbols: [symbol], rollingWindowMs: MINUTE, maxPositionSizeUsd: 10_000, cooldownMs: 0, enabled: true });
  }
  evaluate(ctx: EvaluationContext): StrategySignal | null {
    if (this.done || ctx.symbol !== this.symbol) return null;
    this.done = true;
    return this.buildSignal({ symbol: this.symbol, direction: 'long', qty: this.qty });
  }
}
