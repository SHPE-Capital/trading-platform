// Mock env: must come before any import that touches config/env.
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
import {
  createBreakoutMomentumConfig,
  resolveBreakoutParams,
  validateBreakoutMomentumConfig,
} from '../../strategies/momentum/breakoutMomentumConfig';
import { MomentumIndicatorBank } from '../../strategies/momentum/breakoutMomentumIndicators';
import { computeConfigId } from '../../strategies/momentum/weeklyConfigLoader';
import { breakoutMomentumManifest } from '../../strategies/momentum/manifest';
import { STRATEGY_CATALOG } from '../../config/strategyCatalog';
import { SymbolStateManager } from '../../core/state/symbolState';
import { PortfolioStateManager } from '../../core/state/portfolioState';
import { OrderStateManager } from '../../core/state/orderState';
import type { EvaluationContext } from '../../strategies/base/strategy';
import type { Bar } from '../../types/market';
import type { BreakoutSignalSettings } from '../../strategies/momentum/breakoutMomentumTypes';

const mockNowMs = nowMs as jest.Mock;
const MIN = 60_000;
const MON = '2026-11-23';
const TUE = '2026-11-24';

const SELECTED_FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'weeklyConfig', 'selected.json'), 'utf8'),
);

/** Small windows so every value can be worked by hand: ATR(2), warm-up multiple 1. */
const SMALL: Partial<BreakoutSignalSettings> = { atrLength: 2, warmupMultiple: 1, emaSlowLookback: 1 };

function artifact(
  params: Record<string, number>,
  opts: { runId?: string; activation?: { start: string; end: string }; mutate?: (a: any) => void } = {},
) {
  const subset = [...new Set(Object.keys(params).map((k) => k.split('.')[0]))].sort();
  const a = JSON.parse(JSON.stringify(SELECTED_FIXTURE));
  a.run_id = opts.runId ?? 'run-A';
  a.selected = { config_id: computeConfigId('v1', subset, params), grid_version: 'v1', subset, params };
  if (opts.activation) a.activation = opts.activation;
  opts.mutate?.(a);
  return a;
}

/** 09:30 ET (EST in late November) of `date`, plus `minute` minutes after midnight local. */
const at = (date: string, minuteOfDay: number) => Date.parse(`${date}T00:00:00-05:00`) + minuteOfDay * MIN;
const OPEN = 570;

function bar(symbol: string, date: string, minuteOfDay: number, h: number, l: number, c: number, v = 100): Bar {
  const ts = at(date, minuteOfDay);
  return { symbol, open: c, high: h, low: l, close: c, volume: v, ts, isoTs: new Date(ts).toISOString(), timeframe: '1m' };
}

/**
 * The hand-worked series. ATR(2); breakout n=3, b=0.5.
 *   t0..t4: 10/10/10                       -> ATR 0 from t2 on
 *   t5: h11 l10 c11: TR 1, ATR (0+1)/2 = .5;  preceding high (t2..t4) 10, threshold 10.25, 11 > 10.25
 *   t6: h12 l11 c12: TR 1, ATR (.5+1)/2 = .75; preceding high (t3..t5) 11, threshold 11.375, 12 > 11.375
 *   t7: h12 l12 c12: TR 0, ATR .375;           preceding high (t4..t6) 12, threshold 12.1875, 12 no
 */
const FLAT = [10, 10, 10, 10, 10];
function day1(symbol: string, startMinute = OPEN): Bar[] {
  const bars: Bar[] = FLAT.map((p, i) => bar(symbol, MON, startMinute + i, p, p, p));
  bars.push(bar(symbol, MON, startMinute + 5, 11, 10, 11));
  bars.push(bar(symbol, MON, startMinute + 6, 12, 11, 12));
  bars.push(bar(symbol, MON, startMinute + 7, 12, 12, 12));
  return bars;
}

function setup(artifactRaw: unknown, signals: Partial<BreakoutSignalSettings> = SMALL, symbols = ['AAPL']) {
  const strategy = new BreakoutMomentumStrategy(
    createBreakoutMomentumConfig({ id: 'bm-1', symbols, weeklyConfigArtifact: artifactRaw, signals: signals as BreakoutSignalSettings }),
  );
  strategy.start();
  const symbolState = new SymbolStateManager();
  const portfolioState = new PortfolioStateManager(100_000);
  const orderState = new OrderStateManager();
  const context = (symbol: string): EvaluationContext => ({ symbol, symbolState, portfolioState, orderState });
  const onBar = (b: Bar) => {
    symbolState.onBar(b);
    return strategy.evaluate(context(b.symbol));
  };
  return { strategy, context, onBar, portfolioState, symbolState };
}

const BREAKOUT_ONLY = { 'breakout.n': 3, 'breakout.b': 0.5 };

/** Runs decideBar over bars, flat and with no position. */
function run(strategy: BreakoutMomentumStrategy, bars: Bar[]) {
  return bars.map((b) => strategy.decideBar(b, 0, true));
}

beforeEach(() => {
  mockNowMs.mockReturnValue(at(MON, 20 * 60));
});

describe('hand-worked breakout series', () => {
  it('flags the breakout at t5 and t6 with the worked ATR, preceding high and threshold', () => {
    const { strategy } = setup(artifact(BREAKOUT_ONLY));
    const d = run(strategy, day1('AAPL'));

    // Not ready before t2 (ATR) and t3 (3 preceding highs); flat prices never exceed the threshold.
    expect(d.slice(0, 5).map((x) => x.signal)).toEqual([false, false, false, false, false]);
    expect(d[0].skipReason).toBe('indicators_not_ready');
    expect(d[2].skipReason).toBe('indicators_not_ready'); // t2: ATR ready, preceding high (n=3) not yet
    expect(d[3].skipReason).toBe('no_signal'); // t3: ready, close == threshold 10, not strictly above

    expect(d[5].signal).toBe(true);
    expect(d[5].indicators).toMatchObject({ atr: 0.5, precedingHigh: 10, breakoutThreshold: 10.25 });
    expect(d[5].skipReason).toBeNull();

    expect(d[6].indicators).toMatchObject({ atr: 0.75, precedingHigh: 11, breakoutThreshold: 11.375 });
    expect(d[6].signal).toBe(true);

    expect(d[7].indicators).toMatchObject({ atr: 0.375, precedingHigh: 12, breakoutThreshold: 12.1875 });
    expect(d[7].signal).toBe(false);
    expect(d[7].skipReason).toBe('no_signal');
  });

  it('builds the entry intent from the artifact (limit markup, exit plan, ids)', () => {
    const { strategy } = setup(artifact(BREAKOUT_ONLY));
    const intent = run(strategy, day1('AAPL'))[5].intent!;
    expect(intent).toMatchObject({
      symbol: 'AAPL', assetId: 'a-0001', runId: 'run-A', sessionDate: MON, referenceClose: 11, atr: 0.5,
    });
    expect(intent.limitPrice).toBeCloseTo(11 * 1.002, 10);
    expect(intent.exitPlan).toEqual({
      entryAtr: 0.5, initialStopAtr: 1.5, trailActivationAtr: 1.0, trailDistanceAtr: 1.5,
      maxHoldMinutes: 60, sessionExitMinutesBeforeClose: 5, sessionExitMinuteOfDay: 960 - 5,
    });
  });

  it('takes every tunable from the artifact: b=0.5 passes, b=0.9 does not (10.45 vs close 11 still passes; b=2 does not)', () => {
    const wide = setup(artifact({ 'breakout.n': 3, 'breakout.b': 2 }));
    // threshold at t5 = 10 + 2*.5 = 11; close 11 is not strictly above
    expect(run(wide.strategy, day1('AAPL'))[5].signal).toBe(false);
    const short = setup(artifact({ 'breakout.n': 2, 'breakout.b': 0.5 }));
    // n=2: preceding high is ready one bar earlier; t5 threshold unchanged at 10.25
    expect(run(short.strategy, day1('AAPL'))[5].indicators?.breakoutThreshold).toBe(10.25);
  });

  it('applies the exit settings of the artifact, not constants', () => {
    const a = artifact(BREAKOUT_ONLY, { mutate: (x) => { x.account.exit.initial_stop_atr = 2.25; x.account.exit.max_hold_minutes = 30; } });
    const { strategy } = setup(a);
    const plan = run(strategy, day1('AAPL'))[5].intent!.exitPlan;
    expect(plan.initialStopAtr).toBe(2.25);
    expect(plan.maxHoldMinutes).toBe(30);
  });
});

describe('confirmations (hand-worked)', () => {
  it('VWAP band: z = (11 - 10.1111)/0.5 = 1.7778 passes e=2, fails e=1.5', () => {
    // VWAP at t5 = (5 bars of typical 10 + typical 32/3) x volume 100 / 600 = 10.1111
    const pass = setup(artifact({ ...BREAKOUT_ONLY, 'vwap.e': 2 }));
    const d = run(pass.strategy, day1('AAPL'))[5];
    expect(d.indicators!.vwap).toBeCloseTo(10.111111, 5);
    expect(d.components.vwap).toEqual({ ready: true, pass: true });
    expect(d.signal).toBe(true);

    const fail = setup(artifact({ ...BREAKOUT_ONLY, 'vwap.e': 1.5 }));
    const f = run(fail.strategy, day1('AAPL'))[5];
    expect(f.components.vwap).toEqual({ ready: true, pass: false });
    expect(f.signal).toBe(false);
    expect(f.components.breakout?.pass).toBe(true);
  });

  it('EMA trend: fast 2 / slow 3 at t5 are 10.6667 / 10.5, slow 5 bars... 1 bar earlier 10', () => {
    // fast alpha 2/3: seed 10, t5 = 10 + (2/3)(1) = 10.6667. slow alpha 1/2: seed 10, t5 = 10.5; t4 = 10.
    // (fast - slow)/ATR = 0.16667/0.5 = 0.3333 > d = 0.2; slow rising 10.5 > 10.
    const pass = setup(artifact({ ...BREAKOUT_ONLY, 'ema.fast': 2, 'ema.slow': 3, 'ema.d': 0.2 }));
    const d = run(pass.strategy, day1('AAPL'))[5];
    expect(d.indicators!.emaFast).toBeCloseTo(10.666667, 5);
    expect(d.indicators!.emaSlow).toBeCloseTo(10.5, 10);
    expect(d.indicators!.emaSlowPrev).toBeCloseTo(10, 10);
    expect(d.components.ema).toEqual({ ready: true, pass: true });
    expect(d.signal).toBe(true);

    const fail = setup(artifact({ ...BREAKOUT_ONLY, 'ema.fast': 2, 'ema.slow': 3, 'ema.d': 0.4 }));
    expect(run(fail.strategy, day1('AAPL'))[5].signal).toBe(false);
  });

  it('relative volume: current 2-bar sum 400 over median 200 = 2.0 passes v=1.5, fails v=2.5', () => {
    const settings: BreakoutSignalSettings = {
      atrLength: 2, warmupMultiple: 1, emaSlowLookback: 1, rvolHistorySessions: 2, rvolMinObservations: 2, floatTol: 1e-6,
    };
    const feed = (v: number) => {
      const bank = new MomentumIndicatorBank(
        { breakout: { n: 1, b: 0 }, adx: null, ema: null, rvol: { w: 2, v }, vwap: null }, settings);
      let step;
      for (const [date, extra] of [['2026-11-20', 0], ['2026-11-23', 0], ['2026-11-24', 200]] as const) {
        for (let i = 0; i < 6; i++) {
          const vol = date === '2026-11-24' && i === 5 ? 100 + extra : 100;
          step = bank.update({
            high: 10, low: 10, close: 10, volume: vol, ts: at(date, OPEN + i), sessionId: date, minuteOfDay: OPEN + i,
          });
        }
      }
      return step!;
    };
    const pass = feed(1.5);
    expect(pass.indicators.rvol).toBe(2);
    expect(pass.components.rvol).toEqual({ ready: true, pass: true });
    expect(feed(2.5).components.rvol).toEqual({ ready: true, pass: false });
  });
});

describe('fail closed', () => {
  const bars = day1('AAPL');

  it.each([
    ['missing artifact', null, 'missing'],
    ['invalid artifact', { nonsense: true }, 'invalid'],
    ['unknown version', { ...artifact(BREAKOUT_ONLY), schema_version: 'weekly_config.v2' }, 'unknown_version'],
    ['no_deployment artifact', JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weeklyConfig', 'no_deployment.json'), 'utf8')), 'no_deployment'],
    ['stale artifact', artifact(BREAKOUT_ONLY, { activation: { start: '2026-11-16', end: '2026-11-20' } }), 'stale'],
    ['not yet active', artifact(BREAKOUT_ONLY, { activation: { start: '2026-11-30', end: '2026-12-04' } }), 'not_yet_active'],
    ['failed acceptance', artifact(BREAKOUT_ONLY, { mutate: (a) => { a.acceptance.passed = false; } }), 'acceptance_failed'],
    ['unusable params', artifact({ 'breakout.n': 0, 'breakout.b': 0.5 }), 'params_unsupported'],
    ['entry score threshold the platform cannot compute', artifact(BREAKOUT_ONLY, { mutate: (a) => { a.account.entry_score_threshold = 1.5; } }), 'params_unsupported'],
  ])('opens no entry on a breakout bar: %s', (_n, raw, reason) => {
    const { strategy, onBar } = setup(raw);
    const decisions = run(strategy, bars);
    expect(decisions.every((d) => d.intent === null && !d.entriesAllowed)).toBe(true);
    expect(decisions[5].skipReason).toBe(reason);
    // And the engine adapter emits nothing.
    const fresh = setup(raw);
    expect(bars.map((b) => fresh.onBar(b)).every((s) => s === null)).toBe(true);
    void onBar;
  });

  it('never opens an entry for a symbol outside the artifact universe', () => {
    const { strategy } = setup(artifact(BREAKOUT_ONLY), SMALL, ['ZZZ']);
    expect(run(strategy, day1('ZZZ'))[5].skipReason).toBe('symbol_not_in_universe');
  });

  it('opens no entry on a stale day even with a perfect breakout', () => {
    const { strategy } = setup(artifact(BREAKOUT_ONLY, { activation: { start: MON, end: MON } }));
    const tue = [
      ...day1('AAPL'),
      bar('AAPL', TUE, OPEN, 20, 19, 20),
    ];
    const d = run(strategy, tue);
    expect(d[5].intent).not.toBeNull();
    expect(d[8].signal).toBe(true);
    expect(d[8].skipReason).toBe('stale');
    expect(d[8].intent).toBeNull();
  });

  it('keeps indicators and protection config running while entries are disabled', () => {
    const { strategy } = setup(artifact(BREAKOUT_ONLY, { activation: { start: MON, end: MON } }));
    run(strategy, day1('AAPL'));
    const stale = strategy.decideBar(bar('AAPL', TUE, OPEN, 20, 19, 20), 100, false);
    expect(stale.skipReason).toBe('stale');
    expect(stale.indicators).not.toBeNull();
    expect(strategy.activeWeeklyConfig?.run_id).toBe('run-A');
  });

  it('a missing artifact later (while holding) keeps the config in force', () => {
    const { strategy } = setup(artifact(BREAKOUT_ONLY));
    run(strategy, day1('AAPL').slice(0, 6));
    strategy.submitArtifact(null);
    const d = strategy.decideBar(bar('AAPL', MON, OPEN + 6, 12, 11, 12), 100, false);
    expect(d.skipReason).toBe('missing');
    expect(d.runId).toBe('run-A');
    expect(strategy.activeWeeklyConfig?.run_id).toBe('run-A');
  });

  it('switches config only while flat', () => {
    const { strategy } = setup(artifact(BREAKOUT_ONLY));
    run(strategy, day1('AAPL').slice(0, 6));
    strategy.submitArtifact(artifact({ 'breakout.n': 2, 'breakout.b': 0 }, { runId: 'run-B' }));

    const holding = strategy.decideBar(bar('AAPL', MON, OPEN + 6, 12, 11, 12), 100, false);
    expect(holding.skipReason).toBe('switch_pending_not_flat');
    expect(strategy.activeWeeklyConfig?.run_id).toBe('run-A');
    expect(holding.indicators!.breakoutThreshold).toBeCloseTo(11.375, 10); // still run-A parameters

    const flat = strategy.decideBar(bar('AAPL', MON, OPEN + 7, 12, 12, 12), 0, true);
    expect(strategy.activeWeeklyConfig?.run_id).toBe('run-B');
    expect(flat.runId).toBe('run-B');
  });
});

describe('entry rules', () => {
  it('rebuilds indicators from history when the artifact arrives late (same values as from the start)', () => {
    const early = setup(artifact(BREAKOUT_ONLY));
    const late = setup(null);
    const bars = day1('AAPL');
    const e = run(early.strategy, bars);
    run(late.strategy, bars.slice(0, 5));
    late.strategy.submitArtifact(artifact(BREAKOUT_ONLY));
    const l = run(late.strategy, bars.slice(5));
    expect(l[0].indicators).toEqual(e[5].indicators);
    expect(l[0].intent).toEqual(e[5].intent);
    expect(l[1].indicators).toEqual(e[6].indicators);
  });

  it('warmUp primes history without signalling; the first live bar then decides with full indicators', () => {
    const { strategy } = setup(artifact(BREAKOUT_ONLY));
    const bars = day1('AAPL');
    expect(strategy.warmUp(bars.slice(0, 5))).toBe(5);
    expect(strategy.lastDecision('AAPL')).toBeNull();
    const d = strategy.decideBar(bars[5], 0, true);
    expect(d.indicators).toMatchObject({ atr: 0.5, precedingHigh: 10, breakoutThreshold: 10.25 });
    expect(d.signal).toBe(true);
  });

  it('warmUp ignores incomplete, extended-hours, weekend and bad bars', () => {
    mockNowMs.mockReturnValue(at(MON, OPEN + 3) + 30_000); // bar at OPEN+3 is still in progress
    const { strategy } = setup(artifact(BREAKOUT_ONLY));
    const ok = day1('AAPL').slice(0, 4);
    const pre = bar('AAPL', MON, OPEN - 10, 10, 10, 10);
    const weekend = bar('AAPL', '2026-11-21', OPEN, 10, 10, 10);
    const bad = { ...bar('AAPL', MON, OPEN + 1, 10, 10, 10), close: NaN };
    expect(strategy.warmUp([weekend, pre, ...ok, bad])).toBe(3);
  });

  it('one entry per stock per session; the next session may enter again', () => {
    const { strategy } = setup(artifact(BREAKOUT_ONLY, { activation: { start: MON, end: '2026-11-27' } }));
    const b = day1('AAPL');
    run(strategy, b.slice(0, 6)); // t5 candidate
    // The position opened (held at t6), then closed (flat at t7): still entered today.
    expect(strategy.decideBar(b[6], 100, false).skipReason).toBe('holding');
    expect(strategy.decideBar(b[7], 0, true).skipReason).toBe('already_entered_today');
    // Next session: t8 = h20 l19 c20. TR 8, ATR (.375+8)/2 = 4.1875, preceding high (t5..t7) 12,
    // threshold 12 + .5*4.1875 = 14.09375; 20 > threshold.
    const d = strategy.decideBar(bar('AAPL', TUE, OPEN, 20, 19, 20), 0, true);
    expect(d.indicators).toMatchObject({ atr: 4.1875, precedingHigh: 12, breakoutThreshold: 14.09375 });
    expect(d.intent).not.toBeNull();
  });

  it('closes the entry window per research: m+1 >= length - session_exit_minutes (15:53 ok, 15:54 not)', () => {
    // length 390, exit 5: no entry once m + 1 >= 385. Bar at 15:53 is m = 383, at 15:54 m = 384.
    const ok = setup(artifact(BREAKOUT_ONLY));
    expect(run(ok.strategy, day1('AAPL', 15 * 60 + 48))[5].intent).not.toBeNull(); // t5 at 15:53
    const late = setup(artifact(BREAKOUT_ONLY));
    const d = run(late.strategy, day1('AAPL', 15 * 60 + 49))[5]; // t5 at 15:54
    expect(d.signal).toBe(true);
    expect(d.skipReason).toBe('entry_window_closed');
  });

  it('uses the artifact exit minutes for the window', () => {
    const a = artifact(BREAKOUT_ONLY, { mutate: (x) => { x.account.exit.session_exit_minutes_before_close = 10; } });
    const { strategy } = setup(a);
    // t5 at 15:48 is m = 378; 379 >= 390 - 10 = 380? no, still open. t5 at 15:49: 380 >= 380 closed.
    expect(run(strategy, day1('AAPL', 15 * 60 + 43))[5].intent).not.toBeNull();
    const s2 = setup(a);
    expect(run(s2.strategy, day1('AAPL', 15 * 60 + 44))[5].skipReason).toBe('entry_window_closed');
  });

  it('ignores extended-hours bars, bad bars, other timeframes and out-of-order bars', () => {
    const { strategy } = setup(artifact(BREAKOUT_ONLY));
    expect(strategy.decideBar(bar('AAPL', MON, OPEN - 1, 10, 10, 10), 0, true).skipReason).toBe('outside_session');
    expect(strategy.decideBar(bar('AAPL', MON, 960, 10, 10, 10), 0, true).skipReason).toBe('outside_session');
    expect(strategy.decideBar(bar('AAPL', '2026-11-21', OPEN, 10, 10, 10), 0, true).skipReason).toBe('outside_session');
    expect(strategy.decideBar({ ...bar('AAPL', MON, OPEN, 10, 10, 10), high: 9 }, 0, true).skipReason).toBe('bad_bar');
    expect(strategy.decideBar({ ...bar('AAPL', MON, OPEN, 10, 10, 10), volume: -1 }, 0, true).skipReason).toBe('bad_bar');
    expect(strategy.decideBar({ ...bar('AAPL', MON, OPEN, 10, 10, 10), timeframe: '5m' }, 0, true).skipReason).toBe('bad_bar');
    strategy.decideBar(bar('AAPL', MON, OPEN + 1, 10, 10, 10), 0, true);
    expect(strategy.decideBar(bar('AAPL', MON, OPEN + 1, 10, 10, 10), 0, true).skipReason).toBe('out_of_order');
    expect(strategy.decideBar(bar('AAPL', MON, OPEN, 10, 10, 10), 0, true).skipReason).toBe('out_of_order');
  });

  it('a missing minute resets the recursive indicators and waits for the warm-up again', () => {
    const { strategy } = setup(artifact(BREAKOUT_ONLY));
    const b = day1('AAPL');
    run(strategy, b.slice(0, 5));
    // Skip one minute, then a breakout-looking bar: warm-up restarts, so it is not ready.
    const d = strategy.decideBar(bar('AAPL', MON, OPEN + 6, 11, 10, 11), 0, true);
    expect(d.skipReason).toBe('indicators_not_ready');
    expect(d.signal).toBe(false);
  });

  it('is deterministic: two instances fed the same bars decide identically', () => {
    const a = setup(artifact(BREAKOUT_ONLY));
    const b = setup(artifact(BREAKOUT_ONLY));
    expect(run(a.strategy, day1('AAPL'))).toEqual(run(b.strategy, day1('AAPL')));
  });
});

describe('engine adapter (evaluate)', () => {
  it('emits a long limit signal at t5 with the intent in meta; a quote tick does not decide twice', () => {
    const { onBar, strategy, context } = setup(artifact(BREAKOUT_ONLY));
    const sigs = day1('AAPL').map((b) => onBar(b));
    expect(sigs.slice(0, 5).every((s) => s === null)).toBe(true);
    // per_stock_pct 0.08 x 100,000 = 8,000 / (11 x 1.002 = 11.022) = 725.8 -> 725 shares (provisional sizer)
    expect(sigs[5]).toMatchObject({
      symbol: 'AAPL', direction: 'long', qty: 725, triggerLabel: 'breakout_momentum_entry',
      order: { type: 'limit', timeInForce: 'ioc' },
    });
    expect(sigs[5]!.order!.limitPrice).toBeCloseTo(11.022, 10);
    expect((sigs[5]!.meta as any).exitPlan.entryAtr).toBe(0.5);
    expect(strategy.lastDecision('AAPL')?.skipReason).toBe('no_signal'); // t7
    expect(strategy.evaluate(context('AAPL'))).toBeNull();
  });

  it('an entry that never filled (no position) lets the next bar propose again, as research does', () => {
    // Research resolves a pending entry at the next bar's open: filled -> held, cancelled -> free again.
    const { onBar } = setup(artifact(BREAKOUT_ONLY));
    const b = day1('AAPL');
    b.slice(0, 5).forEach((x) => onBar(x));
    expect(onBar(b[5])).not.toBeNull();
    // t6 is another breakout bar (threshold 11.375, close 12) and nothing filled.
    expect(onBar(b[6])).toMatchObject({ meta: { referenceClose: 12, atr: 0.75 } });
  });

  it('uses an injected sizer and drops a zero quantity', () => {
    const { onBar, strategy } = setup(artifact(BREAKOUT_ONLY));
    strategy.setSizer(() => 0);
    expect(day1('AAPL').map((b) => onBar(b)).every((s) => s === null)).toBe(true);
    const other = setup(artifact(BREAKOUT_ONLY));
    other.strategy.setSizer((i) => (i.symbol === 'AAPL' ? 7.9 : 0));
    expect(day1('AAPL').map((b) => other.onBar(b))[5]).toMatchObject({ qty: 7 });
  });

  it('does nothing when stopped or disabled', () => {
    const { onBar, strategy } = setup(artifact(BREAKOUT_ONLY));
    strategy.stop();
    expect(day1('AAPL').map((b) => onBar(b)).every((s) => s === null)).toBe(true);
  });

  it('a held position blocks entries and counts as entered today', () => {
    const { onBar, portfolioState } = setup(artifact(BREAKOUT_ONLY));
    const b = day1('AAPL');
    b.slice(0, 5).forEach((x) => onBar(x));
    portfolioState.applyFill({
      id: 'f', orderId: 'o', symbol: 'AAPL', side: 'buy', qty: 10, price: 11, notional: 110, commission: 0,
      ts: b[5].ts, isoTs: b[5].isoTs,
    });
    expect(onBar(b[5])).toBeNull();
    expect(onBar(b[6])).toBeNull();
  });
});

describe('config and manifest', () => {
  it('resolves the fixture params and refuses unusable ones', () => {
    expect(resolveBreakoutParams(SELECTED_FIXTURE.selected)).toEqual({
      ok: true,
      params: { breakout: { n: 20, b: 0.1 }, adx: { period: 14, q: 20 }, ema: null, rvol: null, vwap: null },
    });
    const sel = (subset: string[], params: Record<string, number>) => ({ config_id: 'x', grid_version: 'v1', subset, params });
    expect(resolveBreakoutParams(sel(['adx'], { 'adx.period': 7, 'adx.q': 15 })).ok).toBe(false); // no breakout
    expect(resolveBreakoutParams(sel(['breakout', 'zzz'], { 'breakout.n': 3, 'breakout.b': 0, 'zzz.x': 1 })).ok).toBe(false);
    expect(resolveBreakoutParams(sel(['breakout'], { 'breakout.n': 3 })).ok).toBe(false); // missing key
    expect(resolveBreakoutParams(sel(['breakout'], { 'breakout.n': 3, 'breakout.b': 0, 'breakout.z': 1 })).ok).toBe(false);
    expect(resolveBreakoutParams(sel(['breakout'], { 'breakout.n': 2.5, 'breakout.b': 0 })).ok).toBe(false);
    expect(resolveBreakoutParams(sel(['breakout'], { 'breakout.n': 3, 'breakout.b': -1 })).ok).toBe(false);
    expect(resolveBreakoutParams(sel(['breakout', 'ema'], { 'breakout.n': 3, 'breakout.b': 0, 'ema.fast': 8, 'ema.slow': 8, 'ema.d': 0 })).ok).toBe(false);
    expect(resolveBreakoutParams(sel(['breakout', 'rvol'], { 'breakout.n': 3, 'breakout.b': 0, 'rvol.w': 3, 'rvol.v': 0 })).ok).toBe(false);
  });

  it('validates the strategy config', () => {
    expect(() => validateBreakoutMomentumConfig(createBreakoutMomentumConfig({ symbols: ['A'] }))).not.toThrow();
    expect(() => validateBreakoutMomentumConfig(createBreakoutMomentumConfig({ symbols: ['A', 'A'] }))).toThrow(/unique/);
    expect(() => validateBreakoutMomentumConfig(createBreakoutMomentumConfig({ signals: { atrLength: 0 } as any }))).toThrow(/atrLength/);
    expect(() => validateBreakoutMomentumConfig(createBreakoutMomentumConfig({ signals: { rvolMinObservations: 99 } as any }))).toThrow(/rvolMinObservations/);
    expect(() => validateBreakoutMomentumConfig(createBreakoutMomentumConfig({ session: { openMinute: 600, closeMinute: 600 } }))).toThrow(/session/);
  });

  it('defaults mirror the research protocol constants', () => {
    const c = createBreakoutMomentumConfig();
    expect(c.signals).toEqual({
      atrLength: 14, warmupMultiple: 5, emaSlowLookback: 5, rvolHistorySessions: 20, rvolMinObservations: 15, floatTol: 1e-6,
    });
    expect(c.historyBars).toBe(21 * 390);
  });

  it('warm-up lookback covers the relative-volume history', () => {
    const s = new BreakoutMomentumStrategy(createBreakoutMomentumConfig());
    // 21 sessions -> ceil(21*7/5) = 30 calendar days + 4 slack
    expect(s.warmUpLookbackMs()).toBe(34 * 86_400_000);
  });

  it('is registered in the catalog as experimental and hidden, and builds a strategy', () => {
    expect(STRATEGY_CATALOG).toContain(breakoutMomentumManifest);
    expect(breakoutMomentumManifest).toMatchObject({ type: 'momentum', status: 'experimental', hidden: true, version: 1 });
    const built = breakoutMomentumManifest.create({ id: 'x', symbols: ['AAPL'] });
    expect(built).toBeInstanceOf(BreakoutMomentumStrategy);
    expect(breakoutMomentumManifest.validate!({ symbols: ['AAPL'] })).toBeNull();
    expect(breakoutMomentumManifest.validate!({ symbols: ['AAPL', 'AAPL'] })).toMatch(/unique/);
  });

  it('a strategy built with no artifact trades nothing', () => {
    const built = breakoutMomentumManifest.create({ id: 'x', symbols: ['AAPL'] }) as BreakoutMomentumStrategy;
    built.start();
    const d = built.decideBar(bar('AAPL', MON, OPEN, 10, 10, 10), 0, true);
    expect(d.skipReason).toBe('missing');
  });
});
