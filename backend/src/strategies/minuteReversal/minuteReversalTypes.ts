/**
 * strategies/minuteReversal/minuteReversalTypes.ts
 *
 * TypeScript types for the minute-bar reversal test strategy.
 *
 * Inputs:  N/A — type definitions only.
 * Outputs: N/A — type definitions only.
 */

import type { Symbol, EpochMs, ExecutionAlgoType, Metadata } from "../../types/common";
import type { StrategyRiskBudget } from "../../types/risk";

/**
 * Full configuration for a minute-reversal strategy instance.
 * Extends BaseStrategyConfig with the reversal-specific parameters.
 */
export interface MinuteReversalConfig {
  // ------- Inherited from BaseStrategyConfig (duplicated for isolation) -------
  id: string;
  name: string;
  type: "minute_reversal";
  /** Every symbol is traded independently against its own previous bar. */
  symbols: Symbol[];
  /** Unused by this strategy; kept for the BaseStrategyConfig contract. */
  rollingWindowMs: number;
  maxPositionSizeUsd: number;
  /** Unused by this strategy; it trades at most once per bar per symbol. */
  cooldownMs: number;
  enabled: boolean;
  executionAlgo?: ExecutionAlgoType;
  riskBudget?: StrategyRiskBudget;
  description?: string;
  meta?: Metadata;

  // ------- Minute-reversal-specific -------

  /** Whole shares per order. */
  qtyPerTrade: number;
  /**
   * Largest absolute share position per symbol. An order that would move the
   * position past it is skipped, so a long run of up (or down) bars cannot
   * build an unbounded short (or long).
   */
  maxPositionQty: number;
  /**
   * Bars further apart than this are not "the previous minute" (a restart, a
   * halt, overnight). The newer bar becomes the baseline instead of a trade.
   */
  maxBarGapMs: number;
  /**
   * Trade only bars that open at or after 09:30 ET and are decided (they
   * arrive when they close) before 16:00 ET. The IEX stream delivers extended
   * hours bars too; those still serve as baselines. Exchange holidays and
   * early closes are not modelled.
   */
  regularHoursOnly: boolean;
}

/** What the strategy remembers per symbol between bars. */
export interface MinuteReversalSymbolState {
  /** Start time of the last bar seen (Alpaca bars are stamped with their open). */
  lastBarTs: EpochMs | null;
  lastClose: number | null;
}

/** Attached to every signal so each order can be audited against its bars. */
export interface MinuteReversalSignalMeta {
  prevBarTs: string;
  prevClose: number;
  barTs: string;
  close: number;
  /** The book's position in the symbol when the signal was raised. */
  positionBefore: number;
  [key: string]: unknown;
}
