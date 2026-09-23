jest.mock('../../config/env', () => ({ env: { logLevel: 'error' } }));

import { PairsStrategy } from '../../strategies/pairs/pairsStrategy';
import { createPairsConfig } from '../../strategies/pairs/pairsConfig';
import { SymbolStateManager } from '../../core/state/symbolState';
import { PortfolioStateManager } from '../../core/state/portfolioState';
import { OrderStateManager } from '../../core/state/orderState';
import { warmUpStrategy, DEFAULT_WARM_UP_OPTIONS } from '../../core/live/strategyWarmer';
import type { IStrategy } from '../../strategies/base/strategy';
import type { Bar } from '../../types/market';

const MIN = 60_000;

function bar(symbol: string, ts: number, close: number): Bar {
  return { symbol, ts, isoTs: new Date(ts).toISOString(), open: close, high: close, low: close, close, volume: 1, timeframe: '1Min' };
}

/** 40 minutes of history ending a minute ago: leg 2 flat at 100, leg 1 wobbling ±0.1 around it. */
function history(now: number): Bar[] {
  const bars: Bar[] = [];
  for (let i = 40; i >= 1; i--) {
    const ts = now - i * MIN;
    bars.push(bar('XOM', ts, i % 2 === 0 ? 100.1 : 99.9), bar('CVX', ts, 100));
  }
  return bars;
}

function evaluateAt(strategy: PairsStrategy, price1: number, price2: number) {
  const symbolState = new SymbolStateManager();
  const now = Date.now();
  symbolState.onBar(bar('XOM', now, price1));
  symbolState.onBar(bar('CVX', now, price2));
  return strategy.evaluate({
    symbol: 'XOM',
    symbolState,
    portfolioState: new PortfolioStateManager(100_000),
    orderState: new OrderStateManager(),
  });
}

describe('PairsStrategy.warmUp', () => {
  const config = createPairsConfig('XOM', 'CVX', { minObservations: 30, rollingWindowMs: 60 * MIN });

  it('a cold strategy cannot trade: its window is below minObservations', () => {
    const cold = new PairsStrategy(config);
    cold.start();
    expect(evaluateAt(cold, 100.25, 100)).toBeNull();
  });

  it('primes the spread window from history so the first live tick can trade', () => {
    const warm = new PairsStrategy(config);
    warm.start();

    const primed = warm.warmUp(history(Date.now()));
    expect(primed).toBe(40);

    // A 0.25 spread against a ±0.1 history is ~2.4σ: an entry. It could only
    // fire from a flat position, so warm-up also left position state alone.
    const signal = evaluateAt(warm, 100.25, 100);
    expect(signal).not.toBeNull();
    expect(signal!.direction).toBe('short');
  });

  it('samples like evaluate(): one observation per leg-1 bar, leg-2 bars alone add nothing', () => {
    const s = new PairsStrategy(config);
    const now = Date.now();
    const onlyLeg2 = [bar('CVX', now - 3 * MIN, 100), bar('CVX', now - 2 * MIN, 100)];
    expect(s.warmUp(onlyLeg2)).toBe(0);
  });

  it('asks for its longest window: the OLS window when OLS drives the hedge ratio', () => {
    const ols = new PairsStrategy(createPairsConfig('XOM', 'CVX', {
      hedgeRatioMethod: 'rolling_ols', rollingWindowMs: 60 * MIN, olsWindowMs: 240 * MIN,
    }));
    expect(ols.warmUpLookbackMs()).toBe(240 * MIN);
    expect(new PairsStrategy(config).warmUpLookbackMs()).toBe(60 * MIN);
  });
});

describe('warmUpStrategy', () => {
  const NOW = Date.parse('2024-06-03T15:00:00Z');
  const opts = { ...DEFAULT_WARM_UP_OPTIONS, now: () => NOW, marginMs: 10 * MIN };

  it('loads the strategy lookback plus margin, ending now, and replays it', async () => {
    const strategy = new PairsStrategy(createPairsConfig('XOM', 'CVX', { rollingWindowMs: 60 * MIN }));
    const loadBars = jest.fn(async () => history(NOW));

    const primed = await warmUpStrategy(strategy, loadBars, opts);

    expect(primed).toBe(40);
    expect(loadBars).toHaveBeenCalledWith(
      ['XOM', 'CVX'],
      new Date(NOW - 70 * MIN).toISOString(),
      new Date(NOW).toISOString(),
    );
  });

  it('caps extreme windows so a restart cannot spend minutes downloading a year', async () => {
    const strategy = new PairsStrategy(createPairsConfig('XOM', 'CVX', { rollingWindowMs: 365 * 86_400_000 }));
    const loadBars = jest.fn(async (_symbols: string[], _start: string, _end: string): Promise<Bar[]> => []);

    await warmUpStrategy(strategy, loadBars, { ...opts, maxLookbackMs: 5 * 86_400_000, marginMs: 0 });

    expect(loadBars.mock.calls[0][1]).toBe(new Date(NOW - 5 * 86_400_000).toISOString());
  });

  it('is a no-op for strategies without warm-up support', async () => {
    const plain = { config: { symbols: ['SPY'] } } as unknown as IStrategy;
    const loadBars = jest.fn();
    expect(await warmUpStrategy(plain, loadBars, opts)).toBe(0);
    expect(loadBars).not.toHaveBeenCalled();
  });

  it('gives up after the timeout instead of holding up the runner', async () => {
    const strategy = new PairsStrategy(createPairsConfig('XOM', 'CVX'));
    const never = () => new Promise<Bar[]>(() => {});
    await expect(warmUpStrategy(strategy, never, { ...opts, timeoutMs: 20 })).rejects.toThrow(/timed out/);
  });
});
