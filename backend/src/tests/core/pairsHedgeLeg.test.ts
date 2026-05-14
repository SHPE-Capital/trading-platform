jest.mock('../../config/env', () => ({
  env: {
    alpacaApiKey: 'k', alpacaApiSecret: 's', alpacaTradingMode: 'paper',
    alpacaPaperBaseUrl: '', alpacaLiveBaseUrl: '',
    alpacaDataStreamUrl: '', alpacaPaperStreamUrl: '', alpacaLiveStreamUrl: '',
    supabaseUrl: '', supabaseAnonKey: '', supabaseServiceRoleKey: '',
    port: 8080, nodeEnv: 'test', corsOrigin: '', logLevel: 'error',
    defaultRollingWindowMs: 60_000, maxPositionSizeUsd: 10_000,
    maxNotionalExposureUsd: 50_000, orderCooldownMs: 5_000,
    enableLiveTrading: false, enableWebSocketPush: false, databaseUrl: '',
  },
}));

import { EventBus } from '../../core/engine/eventBus';
import { Orchestrator } from '../../core/engine/orchestrator';
import { SymbolStateManager } from '../../core/state/symbolState';
import { PortfolioStateManager } from '../../core/state/portfolioState';
import { OrderStateManager } from '../../core/state/orderState';
import { RiskEngine } from '../../core/risk/riskEngine';
import { ExecutionEngine } from '../../core/execution/executionEngine';
import type { IExecutionSink } from '../../core/execution/IExecutionSink';
import type { OrderIntentCreatedEvent } from '../../types/events';

const noopSink: IExecutionSink = {
  submitOrder: async () => ({} as never),
  cancelOrder: async () => undefined,
};

function makeOrch() {
  const bus = new EventBus();
  const orch = new Orchestrator(
    bus, new SymbolStateManager(), new PortfolioStateManager(100_000),
    new OrderStateManager(), new RiskEngine({}),
    new ExecutionEngine(noopSink), 'backtest',
  );
  orch.start();
  return { bus, orch };
}

describe('Orchestrator pair-hedge leg consistency (fix #8)', () => {
  it('drops BOTH legs when the counterpart qty rounds to zero', () => {
    const { bus } = makeOrch();
    const intents: OrderIntentCreatedEvent[] = [];
    bus.on('ORDER_INTENT_CREATED', (e) => { intents.push(e as OrderIntentCreatedEvent); });

    // qty=1, hedgeRatio=0.4 → Math.floor(1*0.4)=0 → counterpart drops to zero.
    bus.publish({
      id: 'e', type: 'STRATEGY_SIGNAL_CREATED', ts: 1, mode: 'backtest',
      strategyId: 's',
      payload: {
        strategyId: 's', symbol: 'SPY', direction: 'long', qty: 1,
        triggerLabel: 'entry',
        meta: { counterpartSymbol: 'QQQ', counterpartDirection: 'short', hedgeRatio: 0.4 },
      },
    } as never);

    expect(intents).toHaveLength(0);
  });

  it('emits BOTH legs when both qty are > 0', () => {
    const { bus } = makeOrch();
    const intents: OrderIntentCreatedEvent[] = [];
    bus.on('ORDER_INTENT_CREATED', (e) => { intents.push(e as OrderIntentCreatedEvent); });

    bus.publish({
      id: 'e', type: 'STRATEGY_SIGNAL_CREATED', ts: 1, mode: 'backtest',
      strategyId: 's',
      payload: {
        strategyId: 's', symbol: 'SPY', direction: 'long', qty: 10,
        triggerLabel: 'entry',
        meta: { counterpartSymbol: 'QQQ', counterpartDirection: 'short', hedgeRatio: 1.0 },
      },
    } as never);

    expect(intents).toHaveLength(2);
    const symbols = intents.map((i) => i.payload.symbol).sort();
    expect(symbols).toEqual(['QQQ', 'SPY']);
  });
});
