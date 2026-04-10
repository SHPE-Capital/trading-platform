/**
 * adapters/alpaca/index.ts
 *
 * Re-exports all Alpaca adapter modules.
 */

export { AlpacaMarketDataAdapter } from "./marketData";
export { AlpacaOrderExecutionAdapter } from "./orderExecution";
export { normalizeQuote, normalizeTrade, normalizeBar } from "./normalizer";
