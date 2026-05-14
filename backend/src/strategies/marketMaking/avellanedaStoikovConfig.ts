/**
 * strategies/marketMaking/avellanedaStoikovConfig.ts
 *
 * Default configuration, factory helpers, and named presets for the
 * Avellaneda-Stoikov inventory-aware market making strategy.
 *
 * Three presets are provided so the strategy can be instantiated for
 * different risk profiles without re-deriving every parameter:
 *
 *   - "conservative": wide spreads, low gamma, small base size, tight
 *                     inventory limits. Designed for paper trading and
 *                     low-toxicity environments.
 *   - "balanced":     mid-range parameters; the documented "default"
 *                     starting point for backtest exploration.
 *   - "aggressive":   tighter spreads, higher gamma + κ, larger base
 *                     size and inventory limits. Higher fill rates but
 *                     more sensitive to adverse selection.
 *
 * Inputs:  Partial overrides from caller (symbol, sizing, risk tweaks).
 * Outputs: A complete, validated AvellanedaStoikovConfig ready for the
 *          AvellanedaStoikovStrategy constructor.
 */

import { newId } from "../../utils/ids";
import type { Symbol } from "../../types/common";
import type { AvellanedaStoikovConfig } from "./avellanedaStoikovTypes";

// ------------------------------------------------------------------
// Defaults (the "balanced" preset)
// ------------------------------------------------------------------

/**
 * Default Avellaneda-Stoikov configuration values (balanced preset).
 * These represent a reasonable starting point for a single liquid equity
 * on minute bars. Adjust gamma/kappa per instrument when backtesting.
 */
export const DEFAULT_AVELLANEDA_STOIKOV_CONFIG: Omit<
  AvellanedaStoikovConfig,
  "id" | "symbol" | "symbols"
> = {
  name: "Avellaneda-Stoikov MM",
  type: "market_making",
  rollingWindowMs: 1_800_000, // 30 min — enough for ~30 minute-bars
  maxPositionSizeUsd: 25_000,
  cooldownMs: 0,              // strategy-level cooldown handled by quoteRefreshMs
  enabled: true,

  // Core AS parameters
  gamma: 0.5,
  kappa: 1.5,
  horizonMs: 23_400_000,      // 6.5 hours, one US equity session
  clampHorizon: true,
  minHorizonFraction: 0.05,

  // Volatility estimation
  volEstimator: "stddev_returns",
  volWindowSize: 30,
  volEwmaLambda: 0.94,
  sigmaFloor: 1e-5,           // 1 bp on a $1 price baseline; relative to mid
  sigmaCap: 0.05,             // 5% per-bar return → already extreme

  // Inventory + sizing
  inventoryTarget: 0,
  inventoryLimit: 200,        // hard cap (shares)
  baseOrderQty: 10,
  maxQuoteQty: 20,

  // Quote refresh / safeguards
  quoteRefreshMs: 1_000,
  minHalfSpread: 0.01,        // 1 cent half-spread floor → 2-cent quoted spread
  maxHalfSpread: 1.00,        // 1 dollar half-spread cap
  tickSize: 0.01,

  // Kill-switches
  killSwitchSigma: 0.10,      // 10% per-bar realized vol → halt
  killSwitchInventoryMult: 1.5,

  minObservations: 10,
  sharpeConvention: "intraday" as const,
};

// ------------------------------------------------------------------
// Named Presets
// ------------------------------------------------------------------

/** Preset identifier */
export type AvellanedaStoikovPreset = "conservative" | "balanced" | "aggressive";

/**
 * Returns a partial override matching the requested risk preset.
 * Merge this on top of DEFAULT_AVELLANEDA_STOIKOV_CONFIG (createAvellanedaStoikovConfig
 * does this automatically).
 */
export function getAvellanedaStoikovPreset(
  preset: AvellanedaStoikovPreset,
): Partial<AvellanedaStoikovConfig> {
  switch (preset) {
    case "conservative":
      return {
        gamma: 1.5,
        kappa: 0.8,
        baseOrderQty: 5,
        maxQuoteQty: 10,
        inventoryLimit: 100,
        minHalfSpread: 0.05,        // 5 cent floor → 10 cent quoted spread
        maxHalfSpread: 0.50,
        quoteRefreshMs: 2_000,
        killSwitchSigma: 0.05,
        killSwitchInventoryMult: 1.2,
        minObservations: 30,
        volWindowSize: 60,
        maxPositionSizeUsd: 10_000,
      };
    case "balanced":
      return {};
    case "aggressive":
      return {
        gamma: 0.2,
        kappa: 3.0,
        baseOrderQty: 25,
        maxQuoteQty: 50,
        inventoryLimit: 500,
        minHalfSpread: 0.01,
        maxHalfSpread: 0.25,
        quoteRefreshMs: 500,
        killSwitchSigma: 0.20,
        killSwitchInventoryMult: 2.0,
        minObservations: 10,
        volWindowSize: 20,
        maxPositionSizeUsd: 50_000,
      };
  }
}

// ------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------

/**
 * Throws on any structurally invalid AS config (negative gamma, zero
 * tickSize, inverted min/max spreads, etc.). Called by the factory.
 */
export function validateAvellanedaStoikovConfig(c: AvellanedaStoikovConfig): void {
  const errors: string[] = [];

  if (!c.symbol) errors.push("symbol is required");
  if (c.gamma <= 0) errors.push("gamma must be > 0");
  if (c.kappa <= 0) errors.push("kappa must be > 0");
  if (c.horizonMs <= 0) errors.push("horizonMs must be > 0");
  if (c.tickSize <= 0) errors.push("tickSize must be > 0");
  if (c.minHalfSpread < 0) errors.push("minHalfSpread must be ≥ 0");
  if (c.maxHalfSpread <= c.minHalfSpread)
    errors.push("maxHalfSpread must be > minHalfSpread");
  if (c.baseOrderQty < 1) errors.push("baseOrderQty must be ≥ 1");
  if (c.maxQuoteQty < c.baseOrderQty)
    errors.push("maxQuoteQty must be ≥ baseOrderQty");
  if (c.inventoryLimit < 0) errors.push("inventoryLimit must be ≥ 0");
  if (c.sigmaFloor < 0) errors.push("sigmaFloor must be ≥ 0");
  if (c.sigmaCap <= c.sigmaFloor)
    errors.push("sigmaCap must be > sigmaFloor");
  if (c.volWindowSize < 2) errors.push("volWindowSize must be ≥ 2");
  if (c.volEwmaLambda <= 0 || c.volEwmaLambda >= 1)
    errors.push("volEwmaLambda must be in (0, 1)");
  if (c.minHorizonFraction <= 0 || c.minHorizonFraction > 1)
    errors.push("minHorizonFraction must be in (0, 1]");
  if (c.minObservations < 2) errors.push("minObservations must be ≥ 2");
  if (c.killSwitchInventoryMult < 1)
    errors.push("killSwitchInventoryMult must be ≥ 1");
  if (c.quoteRefreshMs < 0) errors.push("quoteRefreshMs must be ≥ 0");

  if (errors.length > 0) {
    throw new Error(
      `Invalid AvellanedaStoikovConfig: ${errors.join("; ")}`,
    );
  }
}

// ------------------------------------------------------------------
// Factory
// ------------------------------------------------------------------

/**
 * Creates a complete AvellanedaStoikovConfig by layering defaults, the
 * optional named preset, and caller overrides (in that order). A new ID
 * is assigned unless one is provided. Throws on invalid config.
 *
 * @param symbol    - The instrument to make markets in
 * @param preset    - Optional risk preset to layer on top of defaults
 * @param overrides - Optional partial config to override anything above
 */
export function createAvellanedaStoikovConfig(
  symbol: Symbol,
  preset: AvellanedaStoikovPreset = "balanced",
  overrides: Partial<AvellanedaStoikovConfig> = {},
): AvellanedaStoikovConfig {
  const config: AvellanedaStoikovConfig = {
    ...DEFAULT_AVELLANEDA_STOIKOV_CONFIG,
    ...getAvellanedaStoikovPreset(preset),
    id: newId(),
    symbol,
    symbols: [symbol],
    name: `Avellaneda-Stoikov: ${symbol}`,
    ...overrides,
  } as AvellanedaStoikovConfig;

  validateAvellanedaStoikovConfig(config);
  return config;
}
