/**
 * types/strategy.ts
 *
 * Frontend types for strategy definitions, runtime state, and signals.
 */

export type StrategyType =
  | "pairs_trading"
  | "momentum"
  | "arbitrage"
  | "market_making"
  | "neural_network";

export type StrategyRunStatus = "idle" | "running" | "paused" | "stopped" | "error";

export interface StrategyRun {
  id: string;
  strategyId: string;
  strategyType: StrategyType;
  name: string;
  config: Record<string, unknown>;
  status: StrategyRunStatus;
  executionMode: string;
  startedAt?: number;
  stoppedAt?: number;
  totalSignals: number;
  totalOrders: number;
  realizedPnl: number;
}

export interface PairsStrategyConfig {
  id: string;
  name: string;
  type: "pairs_trading";
  leg1Symbol: string;
  leg2Symbol: string;
  symbols: [string, string];
  rollingWindowMs: number;
  maxPositionSizeUsd: number;
  cooldownMs: number;
  enabled: boolean;
  hedgeRatioMethod: "fixed" | "rolling_ols";
  fixedHedgeRatio: number;
  entryZScore: number;
  exitZScore: number;
  stopLossZScore: number;
  maxHoldingTimeMs: number;
  minObservations: number;
  tradeNotionalUsd: number;
  priceSource: "mid" | "last_trade";
}
