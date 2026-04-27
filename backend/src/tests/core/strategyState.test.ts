jest.mock('../../utils/time');

import * as time from '../../utils/time';
import { StrategyStateManager } from '../../core/state/strategyState';
import type { StrategySignal } from '../../types/strategy';

const mockNowMs = time.nowMs as jest.Mock;

beforeEach(() => {
  mockNowMs.mockReturnValue(5_000);
  jest.clearAllMocks();
  mockNowMs.mockReturnValue(5_000);
});

function makeSignal(overrides: Partial<StrategySignal> = {}): StrategySignal {
  return {
    id: 'sig-1',
    strategyId: 'strat-1',
    strategyType: 'pairs_trading',
    symbol: 'SPY',
    direction: 'long',
    qty: 10,
    ts: 5_000,
    ...overrides,
  };
}

describe('register / get / getAll', () => {
  it('register creates an idle entry with zero counts', () => {
    const mgr = new StrategyStateManager();
    mgr.register('id-1', 'pairs_trading', 'Test Pairs');
    const state = mgr.get('id-1')!;
    expect(state.status).toBe('idle');
    expect(state.signalCount).toBe(0);
    expect(state.orderCount).toBe(0);
    expect(state.realizedPnl).toBe(0);
  });

  it('get returns null for an unregistered id', () => {
    expect(new StrategyStateManager().get('unknown')).toBeNull();
  });

  it('getAll returns all registered states', () => {
    const mgr = new StrategyStateManager();
    mgr.register('id-1', 'pairs_trading', 'A');
    mgr.register('id-2', 'momentum', 'B');
    expect(mgr.getAll()).toHaveLength(2);
  });
});

describe('setStatus', () => {
  it('transitions status', () => {
    const mgr = new StrategyStateManager();
    mgr.register('id-1', 'pairs_trading', 'Test');
    mgr.setStatus('id-1', 'running');
    expect(mgr.get('id-1')!.status).toBe('running');
  });

  it('sets startedAt when transitioning to running', () => {
    const mgr = new StrategyStateManager();
    mgr.register('id-1', 'pairs_trading', 'Test');
    mockNowMs.mockReturnValue(9_000);
    mgr.setStatus('id-1', 'running');
    expect(mgr.get('id-1')!.startedAt).toBe(9_000);
  });

  it('sets stoppedAt when transitioning to stopped', () => {
    const mgr = new StrategyStateManager();
    mgr.register('id-1', 'pairs_trading', 'Test');
    mockNowMs.mockReturnValue(20_000);
    mgr.setStatus('id-1', 'stopped');
    expect(mgr.get('id-1')!.stoppedAt).toBe(20_000);
  });

  it('does nothing for an unknown id', () => {
    expect(() => new StrategyStateManager().setStatus('unknown', 'running')).not.toThrow();
  });
});

describe('recordSignal', () => {
  it('increments signalCount and stores lastSignal', () => {
    const mgr = new StrategyStateManager();
    mgr.register('id-1', 'pairs_trading', 'Test');
    const sig = makeSignal();
    mgr.recordSignal('id-1', sig);
    expect(mgr.get('id-1')!.signalCount).toBe(1);
    expect(mgr.get('id-1')!.lastSignal).toEqual(sig);
  });

  it('accumulates signal count across multiple calls', () => {
    const mgr = new StrategyStateManager();
    mgr.register('id-1', 'pairs_trading', 'Test');
    mgr.recordSignal('id-1', makeSignal());
    mgr.recordSignal('id-1', makeSignal());
    expect(mgr.get('id-1')!.signalCount).toBe(2);
  });
});

describe('recordOrder', () => {
  it('increments orderCount', () => {
    const mgr = new StrategyStateManager();
    mgr.register('id-1', 'pairs_trading', 'Test');
    mgr.recordOrder('id-1');
    mgr.recordOrder('id-1');
    expect(mgr.get('id-1')!.orderCount).toBe(2);
  });
});

describe('addRealizedPnl', () => {
  it('accumulates realized PnL', () => {
    const mgr = new StrategyStateManager();
    mgr.register('id-1', 'pairs_trading', 'Test');
    mgr.addRealizedPnl('id-1', 500);
    mgr.addRealizedPnl('id-1', -200);
    expect(mgr.get('id-1')!.realizedPnl).toBe(300);
  });
});

describe('recordError', () => {
  it('sets status to error and stores lastError', () => {
    const mgr = new StrategyStateManager();
    mgr.register('id-1', 'pairs_trading', 'Test');
    mgr.recordError('id-1', 'something failed');
    const state = mgr.get('id-1')!;
    expect(state.status).toBe('error');
    expect(state.lastError).toBe('something failed');
    expect(state.stoppedAt).toBe(5_000);
  });
});

describe('deregister / clear', () => {
  it('deregister removes a strategy from the registry', () => {
    const mgr = new StrategyStateManager();
    mgr.register('id-1', 'pairs_trading', 'Test');
    mgr.deregister('id-1');
    expect(mgr.get('id-1')).toBeNull();
  });

  it('clear removes all registered strategies', () => {
    const mgr = new StrategyStateManager();
    mgr.register('id-1', 'pairs_trading', 'A');
    mgr.register('id-2', 'momentum', 'B');
    mgr.clear();
    expect(mgr.getAll()).toHaveLength(0);
  });
});
