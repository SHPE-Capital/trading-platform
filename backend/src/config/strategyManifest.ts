/**
 * config/strategyManifest.ts
 *
 * The one description every strategy gives the platform: who it is, whether it
 * may be launched, how to build it, and (optionally) which parameters the
 * frontend should draw a form for. config/strategyCatalog.ts lists them all.
 *
 * Status is a release gate for NEW launches only:
 *   planned — code exists but is not released. Hidden from the picker; cannot
 *             be saved or started.
 *   ready   — released. Can be saved, started, and proposed.
 *   retired — no new saves or starts. Existing saved configs stay readable.
 *
 * Status never affects a run that already exists. Restoring or adopting a
 * persisted run resolves its factory by type alone (STRATEGY_FACTORY), so
 * flipping a strategy to "retired" cannot stop what is already trading.
 */

import type { IStrategy } from "../strategies/base/strategy";
import type { StrategyType } from "../types/strategy";

export type StrategyStatus = "planned" | "experimental" | "ready" | "retired";

/** One editable field in the generic strategy form. */
export interface ParamSpec {
  /** Key in the strategy's config object. */
  key: string;
  label: string;
  /** "symbols" is a comma-separated list stored as a string[]. */
  kind: "number" | "text" | "symbols" | "boolean";
  min?: number;
  max?: number;
  step?: number;
  /** One line of help shown under the field. */
  hint?: string;
}

export interface StrategyManifest {
  type: StrategyType;
  status: StrategyStatus;
  /** Hide teaching/reference implementations from every picker, independently of eligibility. */
  hidden?: boolean;
  /** All strategies use the common engine unless explicitly unsupported. */
  backtestable?: boolean;
  label: string;
  description: string;
  /**
   * Algorithm version. Read it from the class (e.g. MyStrategy.VERSION) rather
   * than typing a number, so the two can never drift apart.
   */
  version: number;
  /** Fully-populated config used to pre-fill new configurations. */
  defaultConfig: Record<string, unknown>;
  /** Builds the strategy from a saved config. Fill missing fields from defaults here. */
  create: (config: Record<string, unknown>) => IStrategy;
  /**
   * Fields for the generic form. Omit when the strategy has its own bespoke
   * form (pairs trading) or should not be launchable from the UI yet.
   */
  params?: ParamSpec[];
  /**
   * Returns why a saved config cannot be traded, or null when it can. Runs when
   * a config is saved, so a mistake is reported to its author at once instead
   * of failing later at start. Receives the config as the client sent it, so
   * fill missing fields from the defaults before checking. Omit to skip the check.
   */
  validate?: (config: Record<string, unknown>) => string | null;
}

/** Runs a check that throws on a bad config and returns its message, or null if it passes. */
export function asProblem(check: () => void): string | null {
  try {
    check();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
