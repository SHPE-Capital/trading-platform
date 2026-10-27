/**
 * config/strategyDefaults.ts
 *
 * Lookup tables derived from the strategy catalog (config/strategyCatalog.ts).
 * Each definition carries the algorithm version and a fully-populated default
 * config that the frontend uses to pre-fill new strategy forms.
 *
 * version tracks the strategy algorithm version, not per-config edit counts.
 * New configs inherit STRATEGY_DEFINITIONS[type].algorithmVersion at creation time.
 * Bump version in the strategy class when the algorithm changes in a breaking way.
 *
 * Add a strategy in strategyCatalog.ts, not here.
 */

import type { StrategyType } from "../types/strategy";
import type { IStrategy } from "../strategies/base/strategy";
import { STRATEGY_CATALOG } from "./strategyCatalog";
import type { ParamSpec, StrategyStatus } from "./strategyManifest";
import { newId } from "../utils/ids";

export interface StrategyDefinition {
  type: StrategyType;
  label: string;
  description: string;
  /** Whether new configs and runs of this type may be created. */
  status: StrategyStatus;
  hidden?: boolean;
  backtestable?: boolean;
  /**
   * Current algorithm version sourced directly from the strategy class
   * (e.g. PairsStrategy.VERSION). Never stored in the strategies table —
   * derived at runtime so the API always reflects the deployed code version.
   */
  algorithmVersion: number;
  defaultConfig: Record<string, unknown>;
  /** Fields for the frontend's generic form; absent for bespoke or hidden forms. */
  params?: ParamSpec[];
}

/**
 * Maps each strategy type to a factory that instantiates the IStrategy from a
 * raw config object. Includes EVERY status: restoring a persisted run must work
 * whatever its type's status is today. Gate new launches with strategyPolicy.ts.
 */
export const STRATEGY_FACTORY: Record<string, (config: Record<string, unknown>) => IStrategy> =
  Object.fromEntries(STRATEGY_CATALOG.map((m) => [m.type, (config: Record<string, unknown>) =>
    m.create({ ...config, id: config.id ?? newId(), type: m.type })]));

export const STRATEGY_DEFINITIONS: Record<string, StrategyDefinition> = Object.fromEntries(
  STRATEGY_CATALOG.map((m): [string, StrategyDefinition] => [
    m.type,
    {
      type: m.type,
      label: m.label,
      description: m.description,
      status: m.status,
      hidden: m.hidden,
      backtestable: m.backtestable ?? true,
      algorithmVersion: m.version,
      defaultConfig: m.defaultConfig,
      ...(m.params && { params: m.params }),
    },
  ]),
);

/**
 * Why a config cannot be traded, or null when it can (or the strategy declares
 * no check). Call before storing a config so a mistake is reported at save time.
 */
export function configProblem(type: string, config: Record<string, unknown>): string | null {
  return STRATEGY_CATALOG.find((m) => m.type === type)?.validate?.(config) ?? null;
}
