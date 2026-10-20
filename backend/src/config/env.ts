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

/**
 * Where a trading runtime's orders go. "sim" fills them locally against market
 * data and never contacts a broker; the alpaca targets trade the account whose
 * keys are configured, subject to the startup account check.
 */
export type ExecutionTarget = "sim" | "alpaca-paper" | "alpaca-live";

/**
 * What a trading runtime does with market data that fails validation (see
 * adapters/alpaca/normalizer.ts). "quarantine" drops it before it reaches
 * prices, marks and strategies; "pass" restores the old behaviour.
 */
function marketDataInvalidPolicy(): "pass" | "quarantine" {
  const raw = optional("MARKET_DATA_INVALID_POLICY", "quarantine");
  if (raw === "pass" || raw === "quarantine") return raw;
  throw new Error(`MARKET_DATA_INVALID_POLICY must be pass or quarantine, got: "${raw}"`);
}

/**
 * How a sim runtime streaming live data prices orders: "quote" against the
 * live quotes and trades (the backtest's quote model), "bar" on the next bar.
 */
function simExecutionModel(): "quote" | "bar" {
  const raw = optional("SIM_EXECUTION_MODEL", "quote");
  if (raw === "quote" || raw === "bar") return raw;
  throw new Error(`SIM_EXECUTION_MODEL must be quote or bar, got: "${raw}"`);
}

function executionTarget(): ExecutionTarget {
  const raw = optional("EXECUTION_TARGET", "sim");
  if (raw === "sim" || raw === "alpaca-paper" || raw === "alpaca-live") return raw;
  throw new Error(`EXECUTION_TARGET must be sim, alpaca-paper or alpaca-live, got: "${raw}"`);
}

const alpacaApiKey = optional("ALPACA_API_KEY", "");
const alpacaApiSecret = optional("ALPACA_API_SECRET", "");

export const env = {
  // Server
  port: optionalNumber("PORT", 8080),
  nodeEnv: optional("NODE_ENV", "development"),
  corsOrigin: optional("CORS_ORIGIN", "http://localhost:3000"),
  /** Isolation boundary for queues and live-run adoption (for example local/prod). */
  runtimeOrigin: optional("APP_RUNTIME_ORIGIN", "local"),
  buildSha: optional("APP_BUILD_SHA", "local"),
  buildDirty: optionalBool("APP_BUILD_DIRTY", true),

  // Execution
  executionTarget: executionTarget(),
  /**
   * Account number this runtime must be trading. Mandatory on the AWS origin;
   * optional for a member's own paper account.
   */
  expectedBrokerAccount: optional("EXPECTED_BROKER_ACCOUNT", ""),

  // Alpaca. Trading keys are only needed by the alpaca targets; data keys
  // (market data and the market clock) fall back to them when unset.
  alpacaApiKey,
  alpacaApiSecret,
  alpacaDataKey: optional("ALPACA_DATA_KEY", alpacaApiKey),
  alpacaDataSecret: optional("ALPACA_DATA_SECRET", alpacaApiSecret),
  alpacaTradingMode: optional("ALPACA_TRADING_MODE", "paper") as "paper" | "live",
  alpacaPaperBaseUrl: optional("ALPACA_PAPER_BASE_URL", "https://paper-api.alpaca.markets"),
  alpacaLiveBaseUrl: optional("ALPACA_LIVE_BASE_URL", "https://api.alpaca.markets"),
  alpacaDataStreamUrl: optional("ALPACA_DATA_STREAM_URL", "wss://stream.data.alpaca.markets/v2/iex"),
  marketDataInvalidPolicy: marketDataInvalidPolicy(),
  alpacaPaperStreamUrl: optional("ALPACA_PAPER_STREAM_URL", "wss://paper-api.alpaca.markets/stream"),
  alpacaLiveStreamUrl: optional("ALPACA_LIVE_STREAM_URL", "wss://api.alpaca.markets/stream"),
  /**
   * Historical market-data requests per minute this process may make. Alpaca's
   * free plan allows 200 across everything on the key; the default leaves room
   * for the bar loader.
   */
  alpacaDataRequestsPerMinute: optionalNumber("ALPACA_DATA_REQUESTS_PER_MINUTE", 190),
  /** Local cache of historical bars, quotes and trades (relative paths resolve from the process's cwd). */
  marketDataDir: optional("MARKET_DATA_DIR", ".local/marketdata"),
  /** Where minute/day bars are cached: "file" (MARKET_DATA_DIR, default) or "supabase" (bars table). */
  barCache: optional("BAR_CACHE", "file") === "supabase" ? "supabase" : "file",

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

  // Live runner (Part 05)
  /** How long a runner's claim on a strategy run survives without a heartbeat. */
  runLeaseSeconds: optionalNumber("RUN_LEASE_SECONDS", 90),
  /** evaluate() errors in a row before a live strategy is auto-disabled. */
  maxConsecutiveStrategyErrors: optionalNumber("MAX_CONSECUTIVE_STRATEGY_ERRORS", 5),
  /** Seconds without data for a strategy's symbol (market open) before the runner warns about it. */
  diagnosticsNoDataSeconds: optionalNumber("DIAGNOSTICS_NO_DATA_SECONDS", 300),
  /** A repeated blocked or rejected order is logged once per this many seconds, with a count of the rest. */
  diagnosticsLogWindowSeconds: optionalNumber("DIAGNOSTICS_LOG_WINDOW_SECONDS", 60),
  /** Maximum share of the paper book available to a self-service sandbox run. */
  sandboxMaxCapitalPct: optionalNumber("SANDBOX_MAX_CAPITAL_PCT", 0.05),
  /** Maximum concurrently running paper sandboxes owned by one member. */
  sandboxMaxActiveRunsPerMember: optionalNumber("SANDBOX_MAX_ACTIVE_RUNS_PER_MEMBER", 2),
  /** Automatic lifetime of a self-service paper sandbox. */
  sandboxRunTtlHours: optionalNumber("SANDBOX_RUN_TTL_HOURS", 24),
  /** Buy-and-hold benchmark shown beside run and strategy performance. */
  benchmarkSymbol: optional("BENCHMARK_SYMBOL", "SPY"),
  /** How often a trading runtime copies its broker's orders and fills into the ledger. */
  brokerSyncIntervalMs: optionalNumber("BROKER_SYNC_INTERVAL_MS", 60_000),

  // Sim replay — used by a sim runtime with no data keys. Cached 1-minute bars
  // from REPLAY_FROM to REPLAY_TO are published as if live, REPLAY_SPEED times
  // faster than they happened.
  replayFrom: optional("REPLAY_FROM", ""),
  replayTo: optional("REPLAY_TO", ""),
  replaySpeed: optionalNumber("REPLAY_SPEED", 1),

  // Sim fills. With live data a sim runtime prices orders on the stream's
  // quotes and trades, assuming SIM_LATENCY_MS from decision to market; a
  // replay has bars only and fills on the next bar.
  simExecutionModel: simExecutionModel(),
  simLatencyMs: optionalNumber("SIM_LATENCY_MS", 250),

  // Latency instrumentation of a trading runtime (docs/guides/latency-benchmark.md).
  // Off by default; when on it only observes — no trading decision changes.
  latencyProbe: optionalBool("LATENCY_PROBE", false),
  /** Output directory; default artifacts/latency/runtime-<mode>-<run id> under the working directory. */
  latencyProbeDir: optional("LATENCY_PROBE_DIR", ""),
  latencyProbeSample: optionalNumber("LATENCY_PROBE_SAMPLE", 0.01),
  latencyProbeDetail: optional("LATENCY_PROBE_DETAIL", "frame") as "frame" | "stage",
  latencyProbeExportSeconds: optionalNumber("LATENCY_PROBE_EXPORT_SECONDS", 60),
  /** Also record raw inbound market-data frames from this runtime's own stream. */
  latencyRecord: optionalBool("LATENCY_RECORD", false),
  latencyRecordMaxMb: optionalNumber("LATENCY_RECORD_MAX_MB", 2048),

  // Feature flags
  enableLiveTrading: optionalBool("ENABLE_LIVE_TRADING", false),
  enableWebSocketPush: optionalBool("ENABLE_WEBSOCKET_PUSH", true),

  // Portfolio
  initialCapital: optionalNumber("INITIAL_CAPITAL", 100_000),

  // Optional startup strategy (standalone / debug use).
  // When both are set, bootstrap auto-registers a pairs strategy on boot.
  // Leave empty (the default) when the frontend manages all strategies.
  startupLeg1: optional("STARTUP_LEG1", ""),
  startupLeg2: optional("STARTUP_LEG2", ""),
} as const;
