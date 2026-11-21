/**
 * tests/strategy/team3Reversal/team3ReversalStrategy.test.ts
 *
 * The VERSION 3 baseline (VWAP reversion) end to end, through the real engine:
 * when it enters, why it exits, how it sizes, and how filters plug in.
 * Platform-contract checks live in contract.test.ts.
 */

jest.mock('../../../config/env', () => jest.requireActual('./envMock'));

import { Team3ReversalStrategy } from '../../../strategies/team3Reversal/team3ReversalStrategy';
import { createTeam3ReversalConfig, validateTeam3ReversalConfig } from '../../../strategies/team3Reversal/team3ReversalConfig';
import { STRATEGY_FACTORY, STRATEGY_DEFINITIONS, configProblem } from '../../../config/strategyDefaults';
import { TEST_KNOBS, chop, day, runTeam3 } from './engine';

const DAY = '2026-10-06';
const calm = chop(40);
const reasons = (signals: { meta?: Record<string, unknown> }[]) => signals.map((s) => s.meta?.reason ?? s.meta?.kind);

describe('baseline entry', () => {
  it('shorts a spike above VWAP and buys a drop below it', async () => {
    const up = await runTeam3(day('AAPL', DAY, [...calm, 101, 101, 100, ...chop(10)]), TEST_KNOBS);
    const down = await runTeam3(day('AAPL', DAY, [...calm, 99, 99, 100, ...chop(10)]), TEST_KNOBS);
    expect(up.signals[0].direction).toBe('short');
    expect(down.signals[0].direction).toBe('long');
  });

  it('does not enter during the opening warm-up', async () => {
    const { signals } = await runTeam3(day('AAPL', DAY, [...chop(10), 101, 100, ...chop(10)]), { ...TEST_KNOBS, skipOpenMinutes: 15 });
    expect(signals).toHaveLength(0);
  });

  it('does not enter when the way back to VWAP is thinner than minEdgeBps', async () => {
    const small = [...calm, 100.1, 100.1, 100, ...chop(10)];               // ~8 bps from VWAP, z still large
    expect((await runTeam3(day('AAPL', DAY, small), { ...TEST_KNOBS, minEdgeBps: 15 })).signals).toHaveLength(0);
    expect((await runTeam3(day('AAPL', DAY, small), { ...TEST_KNOBS, minEdgeBps: 5 })).signals.length).toBeGreaterThan(0);
  });

  it('does not enter when the stretch is below entryZ', async () => {
    const wide = day('AAPL', DAY, chop(60, 100, 1));                       // swings of +/-1 reach |z| ~2.6, never 3
    expect((await runTeam3(wide, { ...TEST_KNOBS, entryZ: 3 })).signals).toHaveLength(0);
    expect((await runTeam3(wide, { ...TEST_KNOBS, entryZ: 2 })).signals.length).toBeGreaterThan(0);
  });

  it('holds one position per symbol: no adding while held', async () => {
    const { signals } = await runTeam3(day('AAPL', DAY, [...calm, 101, 101.5, 102, 102.5, ...Array(5).fill(102.5)]), { ...TEST_KNOBS, maxHoldBars: 100 });
    expect(signals.filter((s) => s.meta?.kind === 'enter')).toHaveLength(1);
  });
});

describe('baseline exits', () => {
  it('target: closes once the close is back at VWAP', async () => {
    const { signals } = await runTeam3(day('AAPL', DAY, [...calm, 101, 100.8, 99.9, ...chop(10)]), TEST_KNOBS);
    expect(reasons(signals)).toEqual(['enter', 'target']);
  });

  it('stop: closes when price stretches stopZ sigmas against us', async () => {
    const run = [...calm, 101, 101.2, 103, 104, ...Array(5).fill(104)];
    const { signals } = await runTeam3(day('AAPL', DAY, run), { ...TEST_KNOBS, entryZ: 2, stopZ: 4 });
    expect(reasons(signals)).toContain('stop');
  });

  it('time: closes after maxHoldBars if nothing else happened', async () => {
    const { signals } = await runTeam3(day('AAPL', DAY, [...calm, 101, ...Array(10).fill(101)]), { ...TEST_KNOBS, maxHoldBars: 3 });
    expect(reasons(signals)).toEqual(['enter', 'time']);
    expect(signals[1].meta?.barsHeld).toBe(3);
  });
});

describe('sizing', () => {
  it('fixed notional: floor(tradeUsd / price) shares', async () => {
    const { signals } = await runTeam3(day('AAPL', DAY, [...calm, 101, 100, ...chop(5)]), { ...TEST_KNOBS, tradeUsd: 2_000 });
    expect(signals[0].qty).toBe(Math.floor(2_000 / 101));
  });

  it('vol sizing: sized from today\'s session returns and still capped by $ per symbol', async () => {
    const { signals } = await runTeam3(day('AAPL', DAY, [...calm, 101, 100, ...chop(5)]),
      { ...TEST_KNOBS, useVolSizing: true, riskPerTradeUsd: 1_000_000, maxPositionSizeUsd: 6_000, tradeUsd: 5_000 });
    expect(signals[0].meta?.sizing).toBe('vol');
    expect(signals[0].qty).toBe(Math.floor(6_000 / 101));
  });
});

describe('filters', () => {
  it('a switched-on filter can block the entry, and its name goes into meta when it allows', async () => {
    const bars = day('AAPL', DAY, [...calm, 101, 100, ...chop(5)]);
    const block = { entry: [{ name: 'never', switchKey: 'useVwapRegime' as const, status: 'done' as const, allows: () => false }] };
    const allow = { entry: [{ name: 'always', switchKey: 'useVwapRegime' as const, status: 'done' as const, allows: () => true }] };
    expect((await runTeam3(bars, { ...TEST_KNOBS, useVwapRegime: true }, { filters: block })).signals).toHaveLength(0);
    expect((await runTeam3(bars, { ...TEST_KNOBS, useVwapRegime: true }, { filters: allow })).signals[0].meta?.filtersOn).toBe('always');
  });

  it('vwapRegime (done) blocks a quiet trend-free day with too few crossings', async () => {
    const trend = Array.from({ length: 40 }, (_, i) => 100 + i * 0.01);   // never crosses VWAP from below
    const { signals } = await runTeam3(day('AAPL', DAY, [...trend, 99, 100, ...chop(5)]), { ...TEST_KNOBS, useVwapRegime: true, minVwapCrossings: 4 });
    expect(signals).toHaveLength(0);
  });
});

describe('team3_reversal config and registration', () => {
  it('accepts the defaults', () => {
    expect(() => validateTeam3ReversalConfig(createTeam3ReversalConfig())).not.toThrow();
    expect(configProblem('team3_reversal', {})).toBeNull();
  });

  it.each([
    [{ entryZ: 0 }, /entryZ/],
    [{ stopZ: 1.5, entryZ: 2 }, /stopZ must be greater/],
    [{ maxHoldBars: 0 }, /maxHoldBars/],
    [{ lastEntryMinutesBeforeClose: 2, flattenMinutesBeforeClose: 5 }, /lastEntryMinutesBeforeClose/],
    [{ tradeUsd: 20_000 }, /tradeUsd/],
    [{ maxGrossUsd: 1_000_000 }, /protocol/],
    [{ lookbackBars: 0 }, /lookbackBars/],
    [{ useVolume: true }, /stub/],
    [{ useVolSizing: true, lookbackBars: 3 }, /lookbackBars >= 5/],
  ])('rejects %j', (config, message) => {
    expect(configProblem('team3_reversal', config)).toMatch(message);
  });

  it('builds from a partial saved config, filling defaults (old VERSION 2 fields are ignored)', () => {
    const strategy = STRATEGY_FACTORY.team3_reversal({ id: 'cfg-3', symbols: ['SPY'], useBigMove: true, qtyPerTrade: 1 });
    expect(strategy).toBeInstanceOf(Team3ReversalStrategy);
    expect(strategy.config).toMatchObject({ id: 'cfg-3', symbols: ['SPY'], entryZ: 2, tradeUsd: 5_000 });
  });

  it('is described by the class version, and every form field exists in its default config', () => {
    const def = STRATEGY_DEFINITIONS.team3_reversal;
    expect(def.algorithmVersion).toBe(Team3ReversalStrategy.VERSION);
    for (const param of def.params ?? []) expect(def.defaultConfig).toHaveProperty(param.key);
  });
});
