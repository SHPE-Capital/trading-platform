jest.mock('../../config/env', () => ({
  env: {
    alpacaApiKey: 'k', alpacaApiSecret: 's', alpacaTradingMode: 'paper', supabaseUrl: 'https://t.supabase.co',
    supabaseAnonKey: 'a', supabaseServiceRoleKey: 's', port: 8080, nodeEnv: 'test', logLevel: 'error',
    defaultRollingWindowMs: 60_000, maxPositionSizeUsd: 10_000, maxNotionalExposureUsd: 50_000,
    orderCooldownMs: 5_000, databaseUrl: '',
  },
}));
jest.mock('../../utils/time', () => ({
  ...jest.requireActual('../../utils/time'),
  nowMs: jest.fn(),
}));

import fs from 'node:fs';
import path from 'node:path';
import { nowMs } from '../../utils/time';
import { BreakoutMomentumStrategy } from '../../strategies/momentum/breakoutMomentumStrategy';
import { createBreakoutMomentumConfig } from '../../strategies/momentum/breakoutMomentumConfig';
import { computeConfigId } from '../../strategies/momentum/weeklyConfigLoader';
import {
  ShadowPolicyRunner,
  ShadowSignalLog,
  signalRecorderSink,
} from '../../strategies/momentum/shadowRun';
import { SignalRecorder } from '../../core/live/signalRecorder';
import type { Bar } from '../../types/market';
import type { BreakoutSignalSettings } from '../../strategies/momentum/breakoutMomentumTypes';

const MIN = 60_000;
const MON = '2026-11-23';
const TUE = '2026-11-24';
const OPEN = 570;
const SMALL: Partial<BreakoutSignalSettings> = { atrLength: 2, warmupMultiple: 1, emaSlowLookback: 1 };
const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'weeklyConfig', 'selected.json'), 'utf8'),
);

function artifact(params: Record<string, number>, runId = 'run-A') {
  const subset = [...new Set(Object.keys(params).map((k) => k.split('.')[0]))].sort();
  const a = JSON.parse(JSON.stringify(FIXTURE));
  a.run_id = runId;
  a.selected = { config_id: computeConfigId('v1', subset, params), grid_version: 'v1', subset, params };
  return a;
}
const at = (date: string, m: number) => Date.parse(`${date}T00:00:00-05:00`) + m * MIN;
function bar(symbol: string, date: string, m: number, h: number, l: number, c: number): Bar {
  const ts = at(date, m);
  return { symbol, open: c, high: h, low: l, close: c, volume: 100, ts, isoTs: new Date(ts).toISOString(), timeframe: '1m' };
}
/** Breakout at t5 and t6 (see breakoutMomentumStrategy.test.ts); t7 no signal. */
function day1(symbol: string, date = MON): Bar[] {
  const b = [10, 10, 10, 10, 10].map((p, i) => bar(symbol, date, OPEN + i, p, p, p));
  b.push(bar(symbol, date, OPEN + 5, 11, 10, 11), bar(symbol, date, OPEN + 6, 12, 11, 12), bar(symbol, date, OPEN + 7, 12, 12, 12));
  return b;
}
function stratConfig(raw: unknown, id: string) {
  return createBreakoutMomentumConfig({ id, symbols: ['AAPL'], weeklyConfigArtifact: raw, signals: SMALL as BreakoutSignalSettings });
}
const LOOSE = { 'breakout.n': 3, 'breakout.b': 0.5 };
const TIGHT = { 'breakout.n': 3, 'breakout.b': 2 }; // never breaks out on the worked series

beforeEach(() => {
  (nowMs as jest.Mock).mockReturnValue(at(MON, 20 * 60));
});

function runner(sink = new ShadowSignalLog()) {
  const r = new ShadowPolicyRunner({
    livePolicyId: 'policy-live',
    sink,
    shadows: [
      { policyId: 'policy-b', strategyConfig: stratConfig(artifact(LOOSE), 's-b') },
      { policyId: 'policy-c', strategyConfig: stratConfig(artifact(TIGHT, 'run-C'), 's-c') },
    ],
  });
  return { r, sink };
}

describe('ShadowPolicyRunner', () => {
  it('records each policy on its own artifact from the shared bars, once per hypothetical entry', () => {
    const { r, sink } = runner();
    const written = day1('AAPL').flatMap((b) => r.onBar(b));

    // policy-b: breakout at t5 only (t6 signals again but it already holds hypothetically); policy-c: none.
    expect(written).toHaveLength(1);
    const rec = sink.records()[0];
    expect(rec).toMatchObject({
      shadow: true, policyId: 'policy-b', livePolicyId: 'policy-live', runId: 'run-A', symbol: 'AAPL',
      sessionDate: MON, referenceClose: 11, barTs: at(MON, OPEN + 5), decidedAtTs: at(MON, OPEN + 6),
    });
    expect(rec.limitPrice).toBeCloseTo(11 * 1.002, 10);
    // 0.08 x 100000 / limit price, whole shares
    expect(rec.qty).toBe(Math.floor(8000 / (11 * 1.002)));
    expect(rec.intent.exitPlan.maxHoldMinutes).toBe(60);
    expect(sink.records('policy-c')).toHaveLength(0);
    expect(r.statsFor('policy-b')).toEqual({ bars: 8, signals: 1, unsized: 0, errors: 0 });
    expect(r.statsFor('policy-c')?.signals).toBe(0);
  });

  it('does not touch a live instance that sees the same bars (compare with live-only run)', () => {
    const liveOnly = new BreakoutMomentumStrategy(stratConfig(artifact(LOOSE), 'live'));
    const withShadows = new BreakoutMomentumStrategy(stratConfig(artifact(LOOSE), 'live'));
    const { r } = runner();
    const bars = day1('AAPL');
    const a = bars.map((b) => liveOnly.decideBar(b, 0, true));
    const b = bars.map((x) => { r.onBar(x); return withShadows.decideBar(x, 0, true); });
    expect(b).toEqual(a);
  });

  it('releases the hypothetical position after max hold, so a later breakout records again', () => {
    const { r, sink } = runner();
    day1('AAPL').forEach((b) => r.onBar(b));
    expect(sink.records()).toHaveLength(1);
    day1('AAPL', TUE).forEach((b) => r.onBar(b));
    expect(sink.records('policy-b')).toHaveLength(2);
    expect(sink.records('policy-b')[1].sessionDate).toBe(TUE);
  });

  it('drops candidates whose hypothetical size is under one share and counts them', () => {
    const sink = new ShadowSignalLog();
    const r = new ShadowPolicyRunner({
      livePolicyId: 'L', sink,
      shadows: [{ policyId: 'p', strategyConfig: stratConfig(artifact(LOOSE), 's'), sizer: () => 0.4 }],
    });
    day1('AAPL').forEach((b) => r.onBar(b));
    expect(sink.records()).toHaveLength(0);
    expect(r.statsFor('p')?.unsized).toBeGreaterThan(0);
  });

  it('uses a configured sizer when given', () => {
    const sink = new ShadowSignalLog();
    const r = new ShadowPolicyRunner({
      livePolicyId: 'L', sink,
      shadows: [{ policyId: 'p', strategyConfig: stratConfig(artifact(LOOSE), 's'), sizer: () => 7.9 }],
    });
    day1('AAPL').forEach((b) => r.onBar(b));
    expect(sink.records()[0].qty).toBe(7);
  });

  it('exports JSON lines per policy', () => {
    const { r, sink } = runner();
    day1('AAPL').forEach((b) => r.onBar(b));
    const lines = sink.exportJsonl('policy-b').split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ policyId: 'policy-b', shadow: true, symbol: 'AAPL' });
    expect(sink.exportJsonl('policy-c')).toBe('');
  });

  it('stores shadow records through SignalRecorder as dropped / shadow_signal_only without editing it', async () => {
    const rows: any[] = [];
    const outcomes: any[] = [];
    const recorder = new SignalRecorder({
      brokerAccount: null,
      insert: async (x) => { rows.push(...x); },
      setOutcome: async (id, o, why) => { outcomes.push({ id, o, why }); },
    });
    const shadow = new ShadowPolicyRunner({
      livePolicyId: 'policy-live', sink: signalRecorderSink(recorder, 'run-1'),
      shadows: [{ policyId: 'policy-b', strategyConfig: stratConfig(artifact(LOOSE), 's-b') }],
    });
    day1('AAPL').forEach((b) => shadow.onBar(b));
    await recorder.flush();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      strategy_id: 'policy-b', symbol: 'AAPL', direction: 'long', run_id: 'run-1',
      outcome: 'dropped', outcome_reason: 'shadow_signal_only',
    });
    expect(rows[0].payload.meta.shadow).toBe(true);
    expect(outcomes).toHaveLength(0);
  });

  it('isolates a failing shadow from the others', () => {
    const { r, sink } = runner();
    const bad = (r as any).shadows[1];
    bad.strategy.decideBar = () => { throw new Error('boom'); };
    day1('AAPL').forEach((b) => r.onBar(b));
    expect(sink.records('policy-b')).toHaveLength(1);
    expect(r.statsFor('policy-c')?.errors).toBe(8);
  });

  it('routes a newer artifact to one policy and rejects unknown policies', () => {
    const { r } = runner();
    expect(() => r.submitArtifact('nope', null)).toThrow(/unknown shadow policy/);
    expect(() => r.submitArtifact('policy-c', artifact(LOOSE, 'run-C2'))).not.toThrow();
  });

  it('rejects duplicate policy ids and a shadow that reuses the live policy id', () => {
    const cfg = (id: string) => ({ policyId: id, strategyConfig: stratConfig(artifact(LOOSE), id) });
    const sink = new ShadowSignalLog();
    expect(() => new ShadowPolicyRunner({ livePolicyId: 'L', sink, shadows: [cfg('a'), cfg('a')] })).toThrow(/duplicated/);
    expect(() => new ShadowPolicyRunner({ livePolicyId: 'L', sink, shadows: [cfg('L')] })).toThrow(/live policy/);
    expect(() => new ShadowPolicyRunner({ livePolicyId: '', sink, shadows: [] })).toThrow(/livePolicyId/);
  });

  it('is signal-only by construction: no order, risk, capital or broker imports', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'strategies', 'momentum', 'shadowRun.ts'), 'utf8');
    const imports = src.split('\n').filter((l) => /^import /.test(l)).join('\n');
    expect(imports).not.toMatch(/oms|risk|capital|alpaca|broker|orchestrator|adapters/i);
  });
});
