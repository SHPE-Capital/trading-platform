/**
 * strategies/momentum/index.ts
 *
 * Public surface of the momentum strategy: weekly config loader (P1-2) and the
 * breakout strategy (P1-3).
 */

export * from "./weeklyConfig";
export * from "./weeklyConfigLoader";
export * from "./breakoutMomentumTypes";
export * from "./breakoutMomentumConfig";
export { BreakoutMomentumStrategy } from "./breakoutMomentumStrategy";
export { MomentumIndicatorBank, type BankBar, type BankStep } from "./breakoutMomentumIndicators";
export { breakoutMomentumManifest } from "./manifest";
export * from "./shadowRun";
