/**
 * config/env.ts
 *
 * Reads and validates environment variables from process.env.
 * Throws at startup if any required variable is missing.
 * All env access in the codebase should go through this module.
 *
 * Inputs:  process.env (populated by dotenv in the entry point).
 * Outputs: Typed `env` object consumed by all other config modules.
 */

import "dotenv/config";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function optionalNumber(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) throw new Error(`Environment variable ${key} must be a number, got: "${raw}"`);
  return parsed;
}

function optionalBool(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  return raw.toLowerCase() === "true";
}

export const env = {
  // Server
  port: optionalNumber("PORT", 8080),
  nodeEnv: optional("NODE_ENV", "development"),
  corsOrigin: optional("CORS_ORIGIN", "http://localhost:3000"),

  // Alpaca
  alpacaApiKey: requireEnv("ALPACA_API_KEY"),
  alpacaApiSecret: requireEnv("ALPACA_API_SECRET"),
  alpacaTradingMode: optional("ALPACA_TRADING_MODE", "paper") as "paper" | "live",
  alpacaPaperBaseUrl: optional("ALPACA_PAPER_BASE_URL", "https://paper-api.alpaca.markets"),
  alpacaLiveBaseUrl: optional("ALPACA_LIVE_BASE_URL", "https://api.alpaca.markets"),
  alpacaDataStreamUrl: optional("ALPACA_DATA_STREAM_URL", "wss://stream.data.alpaca.markets/v2"),
  alpacaPaperStreamUrl: optional("ALPACA_PAPER_STREAM_URL", "wss://paper-api.alpaca.markets/stream"),
  alpacaLiveStreamUrl: optional("ALPACA_LIVE_STREAM_URL", "wss://api.alpaca.markets/stream"),

  // Supabase
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseAnonKey: requireEnv("SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  databaseUrl: optional("DATABASE_URL", ""),

  // Logging
  logLevel: optional("LOG_LEVEL", "info") as "debug" | "info" | "warn" | "error",

  // Rolling window defaults
  defaultRollingWindowMs: optionalNumber("DEFAULT_ROLLING_WINDOW_MS", 60_000),

  // Risk defaults
  maxPositionSizeUsd: optionalNumber("MAX_POSITION_SIZE_USD", 10_000),
  maxNotionalExposureUsd: optionalNumber("MAX_NOTIONAL_EXPOSURE_USD", 50_000),
  orderCooldownMs: optionalNumber("ORDER_COOLDOWN_MS", 5_000),

  // Feature flags
  enableLiveTrading: optionalBool("ENABLE_LIVE_TRADING", false),
  enableWebSocketPush: optionalBool("ENABLE_WEBSOCKET_PUSH", true),
} as const;
