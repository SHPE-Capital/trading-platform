/**
 * strategies/base/strategy.ts
 *
 * Base interface and abstract class for all trading strategies.
 * Every strategy must implement IStrategy. The abstract BaseStrategy
 * provides lifecycle management and common convenience methods.
 *
 * Inputs:  EvaluationContext containing symbol/portfolio/order state.
 * Outputs: StrategySignal or null (no signal this tick).
 */

import type { StrategySignal, BaseStrategyConfig, StrategyType } from "../../types/strategy";
import type { SymbolStateManager } from "../../core/state/symbolState";
import type { PortfolioStateManager } from "../../core/state/portfolioState";
import type { OrderStateManager } from "../../core/state/orderState";
import type { EventBus } from "../../core/engine/eventBus";
import type { UUID } from "../../types/common";
import { nowMs } from "../../utils/time";
import { newId } from "../../utils/ids";

// ------------------------------------------------------------------
// Evaluation context
// ------------------------------------------------------------------

/**
 * The context object passed to IStrategy.evaluate on every tick.
 * Provides read-only access to all shared state.
 */
export interface EvaluationContext {
  /** Symbol that triggered this evaluation */
  symbol: string;
  /** Full symbol state manager (read-only access) */
  symbolState: SymbolStateManager;
  /** Portfolio state manager (read-only access) */
  portfolioState: PortfolioStateManager;
  /** Order state manager (read-only access) */
  orderState: OrderStateManager;
}

// ------------------------------------------------------------------
// IStrategy interface
// ------------------------------------------------------------------

/**
 * Contract every strategy must implement.
 * Strategies are isolated units that consume state and emit signals.
 * They must NOT: call external APIs, hold WebSocket connections, or
 * write directly to the database.
 */
export interface IStrategy {
  /** Unique instance ID (assigned at creation) */
  readonly id: UUID;
  /** Algorithm type identifier */
  readonly type: StrategyType;
  /** Full strategy configuration */
  readonly config: BaseStrategyConfig;

  /** Called by the Orchestrator when the strategy is activated */
  start(): void;

  /** Called by the Orchestrator when the strategy is deactivated */
  stop(): void;

  /**
   * Called by the Orchestrator on every relevant market event.
   * Should be fast and non-blocking.
   * @param context - Current EvaluationContext
   * @returns StrategySignal if an action should be taken, null otherwise
   */
  evaluate(context: EvaluationContext): StrategySignal | null;
}

// ------------------------------------------------------------------
// Abstract base class
// ------------------------------------------------------------------

/**
 * Abstract base class with lifecycle management.
 * Concrete strategies extend this and implement evaluate().
 */
export abstract class BaseStrategy implements IStrategy {
  readonly id: UUID;
  abstract readonly type: StrategyType;
  protected isActive = false;

  constructor(readonly config: BaseStrategyConfig) {
    this.id = config.id;
  }

  start(): void {
    this.isActive = true;
  }

  stop(): void {
    this.isActive = false;
  }

  abstract evaluate(context: EvaluationContext): StrategySignal | null;

  /**
   * Convenience: builds a StrategySignal with required fields filled in.
   */
  protected buildSignal(
    partial: Omit<StrategySignal, "id" | "strategyId" | "strategyType" | "ts">,
  ): StrategySignal {
    return {
      id: newId(),
      strategyId: this.id,
      strategyType: this.type,
      ts: nowMs(),
      ...partial,
    };
  }
}
