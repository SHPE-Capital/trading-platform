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
import type { StrategyRun } from "../../types/strategy";
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
export async function insertOrder(order: Order): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("orders").insert(order);
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
export async function insertFill(fill: Fill): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("fills").insert(fill);
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

/**
 * Persists a new strategy run record.
 * @param run - The StrategyRun to insert
 * @returns void
 */
export async function insertStrategyRun(run: StrategyRun): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("strategy_runs").insert(run);
  if (error) logger.error("insertStrategyRun failed", { error: error.message });
}

/**
 * Updates a strategy run record (e.g. on stop or error).
 * @param runId - Strategy run ID
 * @param updates - Fields to update
 * @returns void
 */
export async function updateStrategyRun(runId: UUID, updates: Partial<StrategyRun>): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("strategy_runs").update(updates).eq("id", runId);
  if (error) logger.error("updateStrategyRun failed", { error: error.message });
}

/**
 * Retrieves all strategy run records.
 * @returns Array of StrategyRun records
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
  return (data ?? []) as StrategyRun[];
}

// ------------------------------------------------------------------
// Backtest Results
// ------------------------------------------------------------------

/**
 * Persists a backtest result record.
 * @param result - The BacktestResult to insert
 * @returns void
 */
export async function insertBacktestResult(result: BacktestResult): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("backtest_results").insert(result);
  if (error) logger.error("insertBacktestResult failed", { error: error.message });
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
    logger.error("getBacktestResultById failed", { error: error.message });
    return null;
  }
  return data as BacktestResult;
}
