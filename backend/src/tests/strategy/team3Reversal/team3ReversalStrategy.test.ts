jest.mock('../../../config/env', () => ({
  env: {
    alpacaApiKey: 'test-key',
    alpacaApiSecret: 'test-secret',
    alpacaTradingMode: 'paper',
    supabaseUrl: 'https://test.supabase.co',
    supabaseAnonKey: 'test-anon',
    supabaseServiceRoleKey: 'test-service',
    port: 8080,
    nodeEnv: 'test',
    logLevel: 'error',
    defaultRollingWindowMs: 60_000,
    maxPositionSizeUsd: 10_000,
    maxNotionalExposureUsd: 50_000,
    orderCooldownMs: 5_000,
    databaseUrl: '',
  },
}));

import { Team3ReversalStrategy } from '../../../strategies/team3Reversal/team3ReversalStrategy';
import {
  createTeam3ReversalConfig,
  validateTeam3ReversalConfig,
  type Team3ReversalConfig,
} from '../../../strategies/team3Reversal/team3ReversalConfig';
import { TEAM3_FILTERS, type FilterSet } from '../../../strategies/team3Reversal/filters';
import type { EntryInput, ExitInput } from '../../../strategies/team3Reversal/filters/types';
import {
  BeginnerReversalStrategy,
  createBeginnerReversalConfig,
} from '../../../strategies/beginnerReversal/beginnerReversalStrategy';
import { STRATEGY_FACTORY, STRATEGY_DEFINITIONS, configProblem } from '../../../config/strategyDefaults';
import { SymbolStateManager } from '../../../core/state/symbolState';
import { PortfolioStateManager } from '../../../core/state/portfolioState';
import { OrderStateManager } from '../../../core/state/orderState';
import type { BaseStrategy, EvaluationContext } from '../../../strategies/base/strategy';
import type { Bar } from '../../../types/market';
import type { StrategySignal } from '../../../types/strategy';
import { MINUTE, NOON_ET } from './helpers';

function bar(symbol: string, minute: number, close: number, start = NOON_ET, volume = 100): Bar {
  const ts = start + minute * MINUTE;
  return {
    symbol, open: close, high: close, low: close, close, volume,
    ts, isoTs: new Date(ts).toISOString(), timeframe: '1m',
  };
}

/** Runs a strategy against bars, filling every signal immediately at the bar's close. */
function harness(strategy: BaseStrategy) {
  strategy.start();
  const symbolState = new SymbolStateManager();
  const portfolioState = new PortfolioStateManager(100_000);
  const orderState = new OrderStateManager();
  let n = 0;
  const context = (symbol: string): EvaluationContext => ({ symbol, symbolState, portfolioState, orderState });
  const onBar = (b: Bar): StrategySignal | null => {
    symbolState.onBar(b);
    const signal = strategy.evaluate(context(b.symbol));
    if (signal) {
      const side = signal.direction === 'long' || signal.direction === 'close_short' ? 'buy' : 'sell';
      portfolioState.applyFill({
        id: `f-${n}`, orderId: `o-${n++}`, symbol: b.symbol, side, qty: signal.qty, price: b.close,
        notional: signal.qty * b.close, commission: 0, ts: b.ts, isoTs: b.isoTs,
      });
    }
    return signal;
  };
  return { onBar, portfolioState };
}

function team(overrides: Partial<Team3ReversalConfig> = {}, filters?: FilterSet) {
  const config = createTeam3ReversalConfig({ id: 't3-1', symbols: ['SPY', 'AAPL'], ...overrides });
  return new Team3ReversalStrategy(config, filters);
}

/** A filter set whose filters and exit rule are jest mocks, so tests can see and steer them. */
function spyFilters(allow: boolean, exit: boolean) {
  const allows = jest.fn((_i: EntryInput) => allow);
  const shouldExit = jest.fn((_i: ExitInput) => exit);
  const filters: FilterSet = {
    entry: [{ name: 'bigMove', switchKey: 'useBigMove', allows }],
    exit: shouldExit,
  };
  return { filters, allows, shouldExit };
}

describe('Team3ReversalStrategy baseline (every switch off)', () => {
  it('trades exactly like Beginner Reversal on the same bars', () => {
    const closes = [100, 101, 100.5, 100.5, 99, 99.5, 101, 102, 101.2, 100, 100.3];
    const t3 = harness(team());
    const br = harness(new BeginnerReversalStrategy(createBeginnerReversalConfig({ id: 'br', symbols: ['SPY', 'AAPL'] })));
    const pick = (s: StrategySignal | null) => s && { direction: s.direction, qty: s.qty, triggerLabel: s.triggerLabel };
    closes.forEach((c, i) => {
      expect(pick(t3.onBar(bar('SPY', i, c)))).toEqual(pick(br.onBar(bar('SPY', i, c))));
    });
  });

  it('uses the first bar only as a baseline', () => {
    expect(harness(team()).onBar(bar('SPY', 0, 100))).toBeNull();
  });

  it('does not trade outside 9:30-16:00 ET, but still remembers the bar', () => {
    const preMarket = Date.UTC(2026, 9, 6, 12, 0); // 8:00 ET
    const { onBar } = harness(team());
    onBar(bar('SPY', 0, 100, preMarket));
    expect(onBar(bar('SPY', 1, 101, preMarket))).toBeNull();
    // First regular-session bar compares against the remembered pre-market close.
    expect(onBar(bar('SPY', 0, 100))).toMatchObject({ direction: 'long', triggerLabel: 'bar_down_buy' });
  });

  it('ignores a bar delivered twice', () => {
    const { onBar } = harness(team());
    onBar(bar('SPY', 0, 100));
    expect(onBar(bar('SPY', 1, 101))).not.toBeNull();
    expect(onBar(bar('SPY', 1, 101))).toBeNull();
  });
});

describe('Team3ReversalStrategy entry filters', () => {
  it('runs a filter only when its switch is on', () => {
    const off = spyFilters(false, true);
    const onBarOff = harness(team({}, off.filters)).onBar;
    onBarOff(bar('SPY', 0, 100));
    expect(onBarOff(bar('SPY', 1, 101))).not.toBeNull();
    expect(off.allows).not.toHaveBeenCalled();

    const on = spyFilters(false, true);
    const onBarOn = harness(team({ useBigMove: true }, on.filters)).onBar;
    onBarOn(bar('SPY', 0, 100));
    expect(onBarOn(bar('SPY', 1, 101))).toBeNull();
    expect(on.allows).toHaveBeenCalledTimes(1);
  });

  it('gives the filter the bar, the earlier bars, the move, the side, and other symbols', () => {
    const { filters, allows } = spyFilters(true, true);
    const { onBar } = harness(team({ useBigMove: true, lookbackBars: 2 }, filters));
    onBar(bar('SPY', 0, 400));
    onBar(bar('AAPL', 0, 100));
    onBar(bar('AAPL', 1, 100)); // unchanged: no decision, no filter call
    onBar(bar('AAPL', 2, 99));
    onBar(bar('AAPL', 3, 100));

    const input = allows.mock.calls[allows.mock.calls.length - 1][0];
    expect(input.symbol).toBe('AAPL');
    expect(input.bar.close).toBe(100);
    expect(input.history.map((b) => b.close)).toEqual([100, 99]); // capped at lookbackBars
    expect(input.move).toBeCloseTo(1 / 99);
    expect(input.side).toBe('sell');
    expect(input.barsOf('SPY').map((b) => b.close)).toEqual([400]);
    expect(input.config.useBigMove).toBe(true);
  });

  it('records which filters were on in the signal', () => {
    const { filters } = spyFilters(true, true);
    const { onBar } = harness(team({ useBigMove: true }, filters));
    onBar(bar('SPY', 0, 100));
    expect(onBar(bar('SPY', 1, 99))?.meta).toMatchObject({ filtersOn: 'bigMove' });
  });
});

describe('Team3ReversalStrategy holdUntilBack exit rule', () => {
  it('holds the position, ignoring new signals, until the exit rule says close', () => {
    const rule = spyFilters(true, false);
    const { onBar, portfolioState } = harness(team({ useHoldUntilBack: true }, rule.filters));
    onBar(bar('SPY', 0, 100));
    expect(onBar(bar('SPY', 1, 101))).toMatchObject({ direction: 'short', qty: 1 });
    expect(onBar(bar('SPY', 2, 100.5))).toBeNull(); // baseline would buy here; hold mode waits
    expect(onBar(bar('SPY', 3, 100.2))).toBeNull();
    expect(rule.shouldExit.mock.calls.map(([i]) => i.barsHeld)).toEqual([1, 2]);
    expect(rule.shouldExit.mock.calls[1][0]).toMatchObject({ entryPrice: 101, positionQty: -1 });

    rule.shouldExit.mockReturnValue(true);
    expect(onBar(bar('SPY', 4, 100))).toMatchObject({
      direction: 'close_short', qty: 1, triggerLabel: 'hold_until_back_exit', meta: { barsHeld: 3 },
    });
    expect(portfolioState.getPosition('SPY')?.qty ?? 0).toBe(0);
    // Flat again: the next bar can enter.
    expect(onBar(bar('SPY', 5, 101))).toMatchObject({ direction: 'short' });
  });

  it('with the stub rule, closes on the next bar', () => {
    const { onBar } = harness(team({ useHoldUntilBack: true }, TEAM3_FILTERS));
    onBar(bar('SPY', 0, 100));
    onBar(bar('SPY', 1, 101));
    expect(onBar(bar('SPY', 2, 101.5))).toMatchObject({ direction: 'close_short', triggerLabel: 'hold_until_back_exit' });
  });
});

describe('team3_reversal config and registration', () => {
  it('accepts the defaults', () => {
    expect(() => validateTeam3ReversalConfig(createTeam3ReversalConfig())).not.toThrow();
    expect(configProblem('team3_reversal', {})).toBeNull();
  });

  it.each([
    [{ qtyPerTrade: 0 }, /qtyPerTrade/],
    [{ qtyPerTrade: 2, maxPositionQty: 1 }, /maxPositionQty/],
    [{ lookbackBars: 0 }, /lookbackBars/],
    [{ bigMoveMinZ: -1 }, /bigMoveMinZ/],
    [{ skipEdgeMinutes: -5 }, /skipEdgeMinutes/],
    [{ useRelativeToSpy: true, symbols: ['AAPL'] }, /SPY in symbols/],
  ])('rejects %j', (config, message) => {
    expect(configProblem('team3_reversal', config)).toMatch(message);
  });

  it('builds from a partial saved config, filling defaults', () => {
    const strategy = STRATEGY_FACTORY.team3_reversal({ id: 'cfg-3', symbols: ['SPY'] });
    expect(strategy).toBeInstanceOf(Team3ReversalStrategy);
    expect(strategy.config).toMatchObject({ id: 'cfg-3', symbols: ['SPY'], useBigMove: false, lookbackBars: 30 });
  });

  it('is described by the class version, and every form field exists in its default config', () => {
    const def = STRATEGY_DEFINITIONS.team3_reversal;
    expect(def.algorithmVersion).toBe(Team3ReversalStrategy.VERSION);
    for (const param of def.params ?? []) expect(def.defaultConfig).toHaveProperty(param.key);
  });
});
