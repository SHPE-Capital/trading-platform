jest.mock('../../config/env', () => ({ env: { logLevel: 'error' } }));

import { strategyActions, visibleStrategyDefinitions } from '../../config/strategyPolicy';
import { STRATEGY_DEFINITIONS, STRATEGY_FACTORY } from '../../config/strategyDefaults';
import { buildBacktestStrategies } from '../../core/backtest/strategyFactory';
import { BeginnerReversalStrategy } from '../../strategies/beginnerReversal/beginnerReversalStrategy';
import type { BacktestConfig } from '../../types/backtest';

describe('strategy eligibility', () => {
  const base = STRATEGY_DEFINITIONS.beginner_reversal;
  it.each([
    ['development', 'sim', true], ['development', 'alpaca-paper', true],
    ['development', 'alpaca-live', false], ['shared', 'sim', false],
    ['shared', 'alpaca-paper', false], ['shared', 'alpaca-live', false],
  ] as const)('experimental trading: %s / %s = %s', (profile, executionTarget, allowed) => {
    const actions = strategyActions({ ...base, status: 'experimental' }, { profile, executionTarget });
    expect(actions.startTrading.allowed).toBe(allowed);
    expect(actions.save.allowed).toBe(true);
    expect(actions.backtest.allowed).toBe(true);
  });
  it.each(['planned', 'retired'] as const)('%s can be backtested but cannot start or save', (status) => {
    const actions = strategyActions({ ...base, status }, { profile: 'development', executionTarget: 'sim' });
    expect(actions.backtest.allowed).toBe(true);
    expect(actions.startTrading.allowed).toBe(false);
    expect(actions.save.allowed).toBe(false);
  });
  it('honors technical backtest capability independently of readiness', () => {
    expect(strategyActions({ ...base, status: 'ready', backtestable: false }, { profile: 'shared', executionTarget: 'alpaca-live' }))
      .toMatchObject({ backtest: { allowed: false }, startTrading: { allowed: true } });
  });
  it('exposes the released beginner strategy in both profiles with form fields and allowed actions', () => {
    expect(base.status).toBe('ready');
    expect(base.hidden).not.toBe(true);
    for (const profile of ['development', 'shared'] as const) {
      const definition = visibleStrategyDefinitions({ profile, executionTarget: 'sim' })
        .find((d) => d.type === 'beginner_reversal');
      expect(definition).toMatchObject({
        actions: { save: { allowed: true }, backtest: { allowed: true }, startTrading: { allowed: true } },
      });
      expect(definition?.params?.map((p) => p.key)).toEqual(['symbols', 'qtyPerTrade', 'maxPositionQty']);
    }
  });
  it('honors hidden metadata independently of readiness', () => {
    const original = base.hidden;
    try {
      base.hidden = true;
      for (const profile of ['development', 'shared'] as const) {
        expect(visibleStrategyDefinitions({ profile, executionTarget: 'sim' }).map((d) => d.type)).not.toContain('beginner_reversal');
      }
    } finally { base.hidden = original; }
  });
});

describe('shared strategy construction', () => {
  it('constructs the beginner strategy through the same factory for trading and backtests', () => {
    const sc = { type: 'beginner_reversal', symbols: ['SPY'], qtyPerTrade: 2, maxPositionQty: 4 };
    const [backtest] = buildBacktestStrategies({ strategyConfig: sc } as unknown as BacktestConfig);
    const trading = STRATEGY_FACTORY.beginner_reversal(sc);
    expect(backtest).toBeInstanceOf(BeginnerReversalStrategy);
    expect(backtest.config).toMatchObject({ ...trading.config, id: expect.any(String) });
    expect(backtest.config.id).toBeTruthy();
  });
  it('rejects invalid experimental configs before running', () => {
    expect(() => buildBacktestStrategies({ strategyConfig: { type: 'beginner_reversal', qtyPerTrade: 0 } } as unknown as BacktestConfig)).toThrow(/qtyPerTrade/);
  });
  it('preserves symbol overrides and fills pairs defaults identically', () => {
    const sc = { type: 'pairs_trading', symbols: ['AAPL', 'MSFT'] };
    const [backtest] = buildBacktestStrategies({ strategyConfig: sc } as unknown as BacktestConfig);
    expect(backtest.config).toMatchObject({ symbols: ['AAPL', 'MSFT'], leg1Symbol: 'AAPL', leg2Symbol: 'MSFT' });
  });
});
