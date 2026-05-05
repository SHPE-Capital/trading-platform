/**
 * adapters/supabase/repositories.ts
 *
 * Repository-style functions for persisting and retrieving data from Supabase.
 * All database interactions in the backend go through this module, keeping
 * Supabase-specific logic isolated from the rest of the system.
 *
 * Inputs:  Domain objects (Order, Fill, PortfolioSnapshot, StrategyRun, etc.)
 * Outputs: Persisted records; query results for API responses.
 */

import { getSupabaseClient } from "./client";
import { logger } from "../../utils/logger";
import type { Order, Fill } from "../../types/orders";
import type { PortfolioSnapshot } from "../../types/portfolio";
import type { StrategyRun, Strategy } from "../../types/strategy";
import type { BacktestResult } from "../../types/backtest";
import type { UUID } from "../../types/common";

// ------------------------------------------------------------------
// Orders
// ------------------------------------------------------------------

/**
 * Persists a submitted order record to the database.
 * @param order - The Order object to insert
 * @returns void
 */
export async function insertOrder(order: Order, isPaper = true): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("orders").insert({ ...order, is_paper: isPaper });
  if (error) logger.error("insertOrder failed", { error: error.message });
}

/**
 * Updates an existing order record (status, fill qty, etc.).
 * @param orderId - Internal order ID
 * @param updates - Partial Order fields to update
 * @returns void
 */
export async function updateOrder(orderId: UUID, updates: Partial<Order>): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("orders").update(updates).eq("id", orderId);
  if (error) logger.error("updateOrder failed", { error: error.message, orderId });
}

/**
 * Fetches all orders for a given strategy run.
 * @param strategyRunId - Strategy run ID to filter by
 * @returns Array of Order records
 */
export async function getOrdersByStrategyRun(strategyRunId: UUID): Promise<Order[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("strategy_id", strategyRunId)
    .order("submitted_at", { ascending: true });
  if (error) {
    logger.error("getOrdersByStrategyRun failed", { error: error.message });
    return [];
  }
  return (data ?? []) as Order[];
}

// ------------------------------------------------------------------
// Fills
// ------------------------------------------------------------------

/**
 * Persists a fill record to the database.
 * @param fill - The Fill object to insert
 * @returns void
 */
export async function insertFill(fill: Fill, isPaper = true): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("fills").insert({ ...fill, is_paper: isPaper });
  if (error) logger.error("insertFill failed", { error: error.message });
}

// ------------------------------------------------------------------
// Portfolio Snapshots
// ------------------------------------------------------------------

/**
 * Persists a portfolio snapshot to the database.
 * @param snapshot - The PortfolioSnapshot to insert
 * @returns void
 */
export async function insertPortfolioSnapshot(snapshot: PortfolioSnapshot): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("portfolio_snapshots").insert(snapshot);
  if (error) logger.error("insertPortfolioSnapshot failed", { error: error.message });
}

/**
 * Retrieves the most recent portfolio snapshot from the database.
 * @returns PortfolioSnapshot or null if none exists
 */
export async function getLatestPortfolioSnapshot(): Promise<PortfolioSnapshot | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("portfolio_snapshots")
    .select("*")
    .order("ts", { ascending: false })
    .limit(1)
    .single();
  if (error) {
    logger.error("getLatestPortfolioSnapshot failed", { error: error.message });
    return null;
  }
  return data as PortfolioSnapshot;
}

/**
 * Retrieves the portfolio equity curve (all snapshots) for charting.
 * @param limit - Maximum number of snapshots to return
 * @returns Array of PortfolioSnapshot records ordered by time ascending
 */
export async function getPortfolioEquityCurve(limit = 500): Promise<PortfolioSnapshot[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("portfolio_snapshots")
    .select("*")
    .order("ts", { ascending: true })
    .limit(limit);
  if (error) {
    logger.error("getPortfolioEquityCurve failed", { error: error.message });
    return [];
  }
  return (data ?? []) as PortfolioSnapshot[];
}

// ------------------------------------------------------------------
// Strategy Runs
// ------------------------------------------------------------------

// Maps a raw Supabase row (snake_case) to the camelCase StrategyRun type.
function mapStrategyRun(row: Record<string, unknown>): StrategyRun {
  return {
    id: row.id as UUID,
    strategyId: row.strategy_id as UUID,
    strategyType: row.strategy_type as StrategyRun["strategyType"],
    strategyVersion: row.strategy_version as number | undefined,
    name: row.name as string,
    config: row.config as StrategyRun["config"],
    status: row.status as StrategyRun["status"],
    executionMode: row.execution_mode as string,
    startedAt: row.started_at ? new Date(row.started_at as string).getTime() : Date.now(),
    stoppedAt: row.stopped_at ? new Date(row.stopped_at as string).getTime() : undefined,
    totalSignals: (row.total_signals as number) ?? 0,
    totalOrders: (row.total_orders as number) ?? 0,
    realizedPnl: (row.realized_pnl as number) ?? 0,
    meta: row.meta as StrategyRun["meta"],
  };
}

/**
 * Persists a new strategy run record.
 * Converts camelCase StrategyRun fields to snake_case DB columns.
 */
export async function insertStrategyRun(run: StrategyRun): Promise<void> {
  const supabase = getSupabaseClient();
  const payload = {
    id: run.id,
    strategy_id: run.strategyId,
    strategy_type: run.strategyType,
    strategy_version: run.strategyVersion ?? null,
    name: run.name,
    config: run.config,
    status: run.status,
    execution_mode: run.executionMode,
    started_at: run.startedAt ? new Date(run.startedAt).toISOString() : null,
    stopped_at: run.stoppedAt ? new Date(run.stoppedAt).toISOString() : null,
    total_signals: run.totalSignals,
    total_orders: run.totalOrders,
    realized_pnl: run.realizedPnl,
    meta: run.meta ?? null,
  };
  const { error } = await supabase.from("strategy_runs").insert(payload);
  if (error) logger.error("insertStrategyRun failed", { error: error.message });
}

/**
 * Updates a strategy run record (e.g. on stop or error).
 * Only maps fields that are present in the updates object.
 */
export async function updateStrategyRun(runId: UUID, updates: Partial<StrategyRun>): Promise<void> {
  const supabase = getSupabaseClient();
  const payload: Record<string, unknown> = {};
  if (updates.status !== undefined)       payload.status         = updates.status;
  if (updates.stoppedAt !== undefined)    payload.stopped_at     = new Date(updates.stoppedAt).toISOString();
  if (updates.totalSignals !== undefined) payload.total_signals  = updates.totalSignals;
  if (updates.totalOrders !== undefined)  payload.total_orders   = updates.totalOrders;
  if (updates.realizedPnl !== undefined)  payload.realized_pnl   = updates.realizedPnl;
  const { error } = await supabase.from("strategy_runs").update(payload).eq("id", runId);
  if (error) logger.error("updateStrategyRun failed", { error: error.message });
}

/**
 * Retrieves all strategy run records, mapped to camelCase StrategyRun objects.
 */
export async function getAllStrategyRuns(): Promise<StrategyRun[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("strategy_runs")
    .select("*")
    .order("started_at", { ascending: false });
  if (error) {
    logger.error("getAllStrategyRuns failed", { error: error.message });
    return [];
  }
  return (data ?? []).map((row) => mapStrategyRun(row as Record<string, unknown>));
}

// ------------------------------------------------------------------
// Strategy Definitions (strategies table)
// ------------------------------------------------------------------

export async function getAllStrategies(): Promise<Strategy[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("strategies")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) { logger.error("getAllStrategies failed", { error: error.message }); return []; }
  return (data ?? []) as Strategy[];
}

export async function getStrategyById(id: UUID): Promise<Strategy | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("strategies").select("*").eq("id", id).single();
  if (error) {
    if (error.code === "PGRST116") return null;
    logger.error("getStrategyById failed", { error: error.message });
    return null;
  }
  return data as Strategy;
}

/** version is required — caller passes STRATEGY_DEFINITIONS[type].version */
export async function insertStrategy(input: {
  strategy_type: string;
  version: number;
  name: string;
  config: Record<string, unknown>;
}): Promise<Strategy> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("strategies").insert(input).select().single();
  if (error) throw new Error(`insertStrategy failed: ${error.message}`);
  return data as Strategy;
}

/** version is NOT changed — it reflects the algorithm version, not an edit counter */
export async function updateStrategy(
  id: UUID,
  name: string,
  config: Record<string, unknown>,
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("strategies")
    .update({ name, config, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) logger.error("updateStrategy failed", { error: error.message, id });
}

export async function deleteStrategy(id: UUID): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("strategies").delete().eq("id", id);
  if (error) logger.error("deleteStrategy failed", { error: error.message, id });
}

// ------------------------------------------------------------------
// Backtest Results
// ------------------------------------------------------------------

export async function insertBacktestOrders(backtestId: string, orders: Order[]): Promise<void> {
  if (!orders || orders.length === 0) {
    logger.info("insertBacktestOrders: no orders to insert", { backtestId });
    return;
  }
  const supabase = getSupabaseClient();
  const CHUNK_SIZE = 1000;

  for (let i = 0; i < orders.length; i += CHUNK_SIZE) {
    const chunk = orders.slice(i, i + CHUNK_SIZE);
    const payload = chunk.map(o => ({
      id:             o.id,
      backtest_id:    backtestId,
      strategy_id:    o.strategyId,
      symbol:         o.symbol,
      side:           o.side,
      qty:            o.qty,
      filled_qty:     o.filledQty,
      avg_fill_price: o.avgFillPrice ?? null,
      order_type:     o.orderType,
      limit_price:    o.limitPrice ?? null,
      stop_price:     o.stopPrice ?? null,
      status:         o.status,
      submitted_at:   new Date(o.submittedAt).toISOString(),
      closed_at:      o.closedAt ? new Date(o.closedAt).toISOString() : null,
    }));

    const { error } = await supabase.from("backtest_orders").insert(payload);
    if (error) {
      let msg = error.message || "Unknown error";
      if (msg.startsWith("<!DOCTYPE") || msg.startsWith("<html")) {
        msg = `HTML response (Cloudflare/5xx) - length: ${msg.length}`;
      }
      logger.error("insertBacktestOrders failed on chunk", {
        error: { ...error, message: msg },
        backtestId,
        chunkIndex: i,
      });
      throw new Error(`Failed to insert backtest orders chunk: ${msg}`);
    }
  }
}

export async function insertBacktestFills(backtestId: string, fills: Fill[]): Promise<void> {
  if (!fills || fills.length === 0) {
    logger.info("insertBacktestFills: no fills to insert", { backtestId });
    return;
  }
  const supabase = getSupabaseClient();
  const CHUNK_SIZE = 1000;

  for (let i = 0; i < fills.length; i += CHUNK_SIZE) {
    const chunk = fills.slice(i, i + CHUNK_SIZE);
    const payload = chunk.map(f => ({
      id:          f.id,
      backtest_id: backtestId,
      order_id:    f.orderId,
      symbol:      f.symbol,
      side:        f.side,
      qty:         f.qty,
      price:       f.price,
      notional:    f.notional,
      commission:  f.commission,
      ts:          f.isoTs || new Date(f.ts).toISOString(),
    }));

    const { error } = await supabase.from("backtest_fills").insert(payload);
    if (error) {
      let msg = error.message || "Unknown error";
      if (msg.startsWith("<!DOCTYPE") || msg.startsWith("<html")) {
        msg = `HTML response (Cloudflare/5xx) - length: ${msg.length}`;
      }
      logger.error("insertBacktestFills failed on chunk", {
        error: { ...error, message: msg },
        backtestId,
        chunkIndex: i,
      });
      throw new Error(`Failed to insert backtest fills chunk: ${msg}`);
    }
  }
}

// Not currently used — waiting for frontend wiring to replace the inline logic in insertBacktestResult.
export function downsampleEquityCurve<T>(curve: T[], targetPoints = 5000): T[] {
  if (!curve || curve.length <= targetPoints) return curve;

  const step = (curve.length - 1) / (targetPoints - 1);
  const downsampled = [];
  for (let i = 0; i < targetPoints - 1; i++) {
    downsampled.push(curve[Math.floor(i * step)]);
  }
  downsampled.push(curve[curve.length - 1]);
  return downsampled;
}

/**
 * Persists a full backtest result summary to the backtest_results table.
 * @param result - The BacktestResult to insert
 * @returns void
 */
export async function insertBacktestResult(result: BacktestResult): Promise<void> {
  const supabase = getSupabaseClient();

  let downsampledEquity = result.equity_curve ?? [];
  if (downsampledEquity.length > 5000) {
    const step = (downsampledEquity.length - 1) / 4999;
    const newCurve = [];
    for (let i = 0; i < 4999; i++) {
      newCurve.push(downsampledEquity[Math.floor(i * step)]);
    }
    newCurve.push(downsampledEquity[downsampledEquity.length - 1]);
    downsampledEquity = newCurve;
  }

  const payload: any = {
    ...result,
    started_at: new Date(result.started_at).toISOString(),
    completed_at: result.completed_at ? new Date(result.completed_at).toISOString() : null,
    equity_curve: downsampledEquity,
  };
  
  // Strip orders and fills from the summary row completely
  delete payload.orders;
  delete payload.fills;

  // Persist the FK link to the strategy definition row if the config referenced one
  payload.strategy_id = result.config ? (result.config as { strategyId?: string }).strategyId ?? null : null;
  payload.strategy_version = result.config ? (result.config as { strategyVersion?: number }).strategyVersion ?? null : null;

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 2000 * attempt));
      logger.warn("insertBacktestResult: retrying after transient error", { attempt });
    }
    const { error } = await supabase.from("backtest_results").insert(payload);
    if (!error) return;

    let msg = error.message || "Unknown error";
    const isTransient = msg.startsWith("<!DOCTYPE") || msg.startsWith("<html");
    if (isTransient) msg = `HTML response (Cloudflare/5xx) - length: ${msg.length}`;

    if (!isTransient || attempt === MAX_RETRIES) {
      logger.error("insertBacktestResult failed", { error: { ...error, message: msg } });
      throw new Error(`Failed to insert backtest result: ${msg}`);
    }
    logger.warn("insertBacktestResult: transient 5xx, will retry", { attempt, msg });
  }
}

export async function updateBacktestResultStatus(id: string, status: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("backtest_results")
    .update({ status })
    .eq("id", id);
  if (error) logger.error("updateBacktestResultStatus failed", { error: error.message, id });
}

/**
 * Retrieves all backtest result summaries (without large equity curve payload).
 * @returns Array of BacktestResult records
 */
export async function getAllBacktestResults(): Promise<BacktestResult[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("backtest_results")
    .select("*")
    .order("started_at", { ascending: false });
  if (error) {
    logger.error("getAllBacktestResults failed", { error: error.message });
    return [];
  }
  return (data ?? []) as BacktestResult[];
}

/**
 * Retrieves a single backtest result by ID, including the full equity curve.
 * @param id - Backtest result ID
 * @returns BacktestResult or null
 */
export async function getBacktestResultById(id: UUID): Promise<BacktestResult | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("backtest_results")
    .select("*")
    .eq("id", id)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    logger.error("getBacktestResultById failed", { error: error.message });
    return null;
  }
  return data as BacktestResult;
}
