/**
 * utils/logger.ts
 *
 * Structured, leveled logger for the backend. All modules should use
 * this instead of console.log to get consistent log formatting,
 * timestamps, and level filtering.
 *
 * Inputs:  Log level from env config, log message and optional context object.
 * Outputs: Formatted log lines to stdout/stderr.
 */

import { env } from "../config/env";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const configuredLevel = LEVELS[env.logLevel] ?? LEVELS.info;

function formatMessage(level: LogLevel, message: string, context?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] ${message}`;
  if (context && Object.keys(context).length > 0) {
    const safeContext = { ...context };
    for (const [k, v] of Object.entries(safeContext)) {
      if (v instanceof Error) {
        safeContext[k] = { name: v.name, message: v.message, stack: v.stack, cause: (v as any).cause };
      }
    }
    return `${base} ${JSON.stringify(safeContext)}`;
  }
  return base;
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (LEVELS[level] < configuredLevel) return;
  const formatted = formatMessage(level, message, context);
  if (level === "error" || level === "warn") {
    process.stderr.write(formatted + "\n");
  } else {
    process.stdout.write(formatted + "\n");
  }
}

export const logger = {
  /**
   * Debug-level log. High-verbosity; only shown when LOG_LEVEL=debug.
   * @param message - Log message
   * @param context - Optional structured context object
   */
  debug(message: string, context?: Record<string, unknown>): void {
    log("debug", message, context);
  },

  /**
   * Info-level log. Normal operational messages.
   * @param message - Log message
   * @param context - Optional structured context object
   */
  info(message: string, context?: Record<string, unknown>): void {
    log("info", message, context);
  },

  /**
   * Warning-level log. Non-fatal unexpected conditions.
   * @param message - Log message
   * @param context - Optional structured context object
   */
  warn(message: string, context?: Record<string, unknown>): void {
    log("warn", message, context);
  },

  /**
   * Error-level log. Fatal or significant errors.
   * @param message - Log message
   * @param context - Optional structured context object
   */
  error(message: string, context?: Record<string, unknown>): void {
    log("error", message, context);
  },
};
