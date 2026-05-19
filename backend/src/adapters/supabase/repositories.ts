/**
 * adapters/supabase/repositories.ts
 *
 * Repository-style functions for persisting and retrieving data from Supabase.
 * All database interactions in the backend go through this module, keeping
 * Supabase-specific logic isolated from the rest of the system.
 *
 */

import { getSupabaseClient } from "./client";
import { logger } from "../../utils/logger";
import type { Order, Fill } from "../../types/orders";
import type { PortfolioSnapshot } from "../../types/portfolio";
import type { StrategyRun, Strategy } from "../../types/strategy";
import type { BacktestConfig, BacktestResult } from "../../types/backtest";
import type { UUID } from "../../types/common";

// ------------------------------------------------------------------
// Orders
// ------------------------------------------------------------------

/** Persists a submitted order record to the database. */
export async function insertOrder(order: Order, isPaper = true): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("orders").insert({
    id:              order.id,
    broker_order_id: order.brokerOrderId ?? null,
    intent_id:       order.intentId,
    strategy_id:     order.strategyId,
    symbol:          order.symbol,
    side:            order.side,
    qty:             order.qty,
    filled_qty:      order.filledQty,
    avg_fill_price:  order.avgFillPrice ?? null,
    order_type:      order.orderType,
    limit_price:     order.limitPrice ?? null,
    stop_price:      order.stopPrice ?? null,
    time_in_force:   order.timeInForce,
    status:          order.status,
    submitted_at:    new Date(order.submittedAt).toISOString(),
    updated_at:      new Date(order.updatedAt).toISOString(),
    closed_at:       order.closedAt ? new Date(order.closedAt).toISOString() : null,
    meta:            order.meta ?? null,
    is_paper:        isPaper,
    // order.fills is omitted — fills are a separate table with FK to orders.id
  });
  if (error) logger.error("insertOrder failed", { error: error.message });
}

/** Updates an existing order record (status, fill qty, etc.). */
export async function updateOrder(orderId: UUID, updates: Partial<Order>): Promise<void> {
  const supabase = getSupabaseClient();
  const payload: Record<string, unknown> = {};
  if (updates.status !== undefined)        payload.status          = updates.status;
  if (updates.brokerOrderId !== undefined) payload.broker_order_id = updates.brokerOrderId;
  if (updates.filledQty !== undefined)     payload.filled_qty      = updates.filledQty;
  if (updates.avgFillPrice !== undefined)  payload.avg_fill_price  = updates.avgFillPrice;
  if (updates.updatedAt !== undefined)     payload.updated_at      = new Date(updates.updatedAt).toISOString();
  if (updates.closedAt !== undefined)      payload.closed_at       = new Date(updates.closedAt).toISOString();
  const { error } = await supabase.from("orders").update(payload).eq("id", orderId);
  if (error) logger.error("updateOrder failed", { error: error.message, orderId });
}

/** Fetches all orders for a given strategy run. */
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
  return (data ?? []).map((row) => mapOrder(row as Record<string, unknown>));
}

/** Fetches all orders, newest first, optionally limited. */
export async function getAllOrders(limit = 500): Promise<Order[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .order("submitted_at", { ascending: false })
    .limit(limit);
  if (error) {
    logger.error("getAllOrders failed", { error: error.message });
    return [];
  }
  return (data ?? []).map((row) => mapOrder(row as Record<string, unknown>));
}

// ------------------------------------------------------------------
// Fills
// ------------------------------------------------------------------

/** Persists a fill record to the database. */
export async function insertFill(fill: Fill, isPaper = true): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("fills").insert({
    id:         fill.id,
    order_id:   fill.orderId,
    symbol:     fill.symbol,
    side:       fill.side,
    qty:        fill.qty,
    price:      fill.price,
    notional:   fill.notional,
    commission: fill.commission,
    ts:         fill.isoTs || new Date(fill.ts).toISOString(),
    exchange:   fill.exchange ?? null,
    is_paper:   isPaper,
    // fill.isoTs is omitted — not a DB column; used only as the ts value above
  });
  if (error) logger.error("insertFill failed", { error: error.message });
}

// ------------------------------------------------------------------
// Portfolio Snapshots
// ------------------------------------------------------------------

/** Persists a portfolio snapshot to the database. */
export async function insertPortfolioSnapshot(snapshot: PortfolioSnapshot): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("portfolio_snapshots").insert({
    id:                   snapshot.id,
    ts:                   new Date(snapshot.ts).toISOString(),
    cash:                 snapshot.cash,
    positions_value:      snapshot.positionsValue,
    equity:               snapshot.equity,
    initial_capital:      snapshot.initialCapital,
    total_unrealized_pnl: snapshot.totalUnrealizedPnl,
    total_realized_pnl:   snapshot.totalRealizedPnl,
    total_pnl:            snapshot.totalPnl,
    return_pct:           snapshot.returnPct,
    positions:            snapshot.positions,
    position_count:       snapshot.positionCount,
    // snapshot.isoTs and snapshot.strategyBreakdowns are not DB columns
    // strategy_run_id is not populated here (no run context at snapshot time)
  });
  if (error) logger.error("insertPortfolioSnapshot failed", { error: error.message });
}

// Maps a raw Supabase orders row (snake_case) to the camelCase Order type.
function mapOrder(row: Record<string, unknown>): Order {
  return {
    id:            row.id as string,
    brokerOrderId: row.broker_order_id as string | undefined,
    intentId:      row.intent_id as string,
    strategyId:    row.strategy_id as string,
    symbol:        row.symbol as string,
    side:          row.side as Order["side"],
    qty:           row.qty as number,
    filledQty:     (row.filled_qty as number) ?? 0,
    avgFillPrice:  row.avg_fill_price as number | undefined,
    orderType:     row.order_type as Order["orderType"],
    limitPrice:    row.limit_price as number | undefined,
    stopPrice:     row.stop_price as number | undefined,
    timeInForce:   row.time_in_force as Order["timeInForce"],
    status:        row.status as Order["status"],
    submittedAt:   new Date(row.submitted_at as string).getTime(),
    updatedAt:     new Date(row.updated_at as string).getTime(),
    closedAt:      row.closed_at ? new Date(row.closed_at as string).getTime() : undefined,
    fills:         [],
    meta:          row.meta as Order["meta"],
  };
}

// Maps a raw Supabase portfolio_snapshots row (snake_case, ts as ISO string)
// to the camelCase PortfolioSnapshot type (ts as EpochMs number).
function mapPortfolioSnapshot(row: Record<string, unknown>): PortfolioSnapshot {
  const tsRaw = row.ts as string | number;
  const ts = typeof tsRaw === "number" ? tsRaw : new Date(tsRaw).getTime();
  return {
    id:                 row.id as string,
    ts,
    isoTs:              typeof tsRaw === "string" ? tsRaw : new Date(tsRaw).toISOString(),
    cash:               row.cash as number,
    positionsValue:     row.positions_value as number,
    equity:             row.equity as number,
    initialCapital:     row.initial_capital as number,
    totalUnrealizedPnl: row.total_unrealized_pnl as number,
    totalRealizedPnl:   row.total_realized_pnl as number,
    totalPnl:           row.total_pnl as number,
    returnPct:          row.return_pct as number,
    positions:          (row.positions as PortfolioSnapshot["positions"]) ?? [],
    positionCount:      (row.position_count as number) ?? 0,
  };
}

/** Retrieves the most recent portfolio snapshot from the database. */
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
  return mapPortfolioSnapshot(data as Record<string, unknown>);
}

/** Retrieves the portfolio equity curve (all snapshots) for charting. */
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
  return (data ?? []).map((row) => mapPortfolioSnapshot(row as Record<string, unknown>));
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
    startedAt: row.started_at ? new Date(row.started_at as string).getTime() : undefined,
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
  if (error) {
    logger.error("insertStrategyRun failed", { error: error.message });
    throw new Error(`insertStrategyRun failed: ${error.message}`);
  }
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
  if (updates.meta !== undefined)         payload.meta           = updates.meta;
  const { error } = await supabase.from("strategy_runs").update(payload).eq("id", runId);
  if (error) logger.error("updateStrategyRun failed", { error: error.message });
}

/**
 * Retrieves all strategy run records, mapped to camelCase StrategyRun objects.
 */
export async function getAllStrategyRuns(): Promise<StrategyRun[]> {
  const supabase = getSupabaseClient();
  const [runsResult, strategiesResult] = await Promise.all([
    supabase.from("strategy_runs").select("*").order("started_at", { ascending: false }),
    supabase.from("strategies").select("id, name"),
  ]);
  if (runsResult.error) {
    logger.error("getAllStrategyRuns failed", { error: runsResult.error.message });
    return [];
  }
  // strategy_runs.strategy_id has no FK constraint in the DB, so not all IDs
  // resolve to a strategy config. Fall back to config.name (captured at launch).
  const nameById = new Map<string, string>(
    (strategiesResult.data ?? []).map((s) => [s.id as string, s.name as string]),
  );
  return (runsResult.data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const name = nameById.get(r.strategy_id as string)
      ?? (r.config as Record<string, unknown>).name as string;
    return mapStrategyRun({ ...r, name });
  });
}


/** Retrieves a single strategy run by ID. */
export async function getStrategyRunById(id: UUID): Promise<StrategyRun | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("strategy_runs")
    .select("*")
    .eq("id", id)
    .single();
  if (error) {
    if (error.code === "PGRST116") return null;
    logger.error("getStrategyRunById failed", { error: error.message, id });
    return null;
  }
  return mapStrategyRun(data as Record<string, unknown>);
}

/**
 * Finds an existing running startup strategy run by its stable startup key
 * (stored in meta.startupKey). Used on boot to resume rather than create a
 * duplicate row when the runtime restarts with STARTUP_LEG1/LEG2 set.
 */
export async function findRunningStartupRun(startupKey: string): Promise<StrategyRun | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("strategy_runs")
    .select("*")
    .eq("status", "running")
    .filter("meta->>startupKey", "eq", startupKey)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logger.error("findRunningStartupRun failed", { error: error.message });
    return null;
  }
  return data ? mapStrategyRun(data as Record<string, unknown>) : null;
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

export async function insertStrategy(input: {
  strategy_type: string;
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

// Runs `tasks` with at most `concurrency` in-flight at a time.
// Rejects immediately if any task throws, mirroring Promise.all behaviour.
async function runConcurrent<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = [];
  let index = 0;
  async function worker(): Promise<void> {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

const CHUNK_SIZE = 1000;
const CHUNK_CONCURRENCY = 4;

export async function insertBacktestOrders(backtestId: string, orders: Order[]): Promise<void> {
  if (!orders || orders.length === 0) {
    logger.info("insertBacktestOrders: no orders to insert", { backtestId });
    return;
  }
  const supabase = getSupabaseClient();

  const chunks: object[][] = [];
  for (let i = 0; i < orders.length; i += CHUNK_SIZE) {
    chunks.push(orders.slice(i, i + CHUNK_SIZE).map(o => ({
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
    })));
  }

  await runConcurrent(chunks.map((payload, idx) => async () => {
    const { error } = await supabase.from("backtest_orders").insert(payload);
    if (error) {
      let msg = error.message || "Unknown error";
      if (msg.startsWith("<!DOCTYPE") || msg.startsWith("<html")) msg = `HTML response (Cloudflare/5xx) - length: ${msg.length}`;
      logger.error("insertBacktestOrders failed on chunk", { error: { ...error, message: msg }, backtestId, chunkIndex: idx });
      throw new Error(`Failed to insert backtest orders chunk: ${msg}`);
    }
  }), CHUNK_CONCURRENCY);
}

export async function insertBacktestFills(backtestId: string, fills: Fill[]): Promise<void> {
  if (!fills || fills.length === 0) {
    logger.info("insertBacktestFills: no fills to insert", { backtestId });
    return;
  }
  const supabase = getSupabaseClient();

  const chunks: object[][] = [];
  for (let i = 0; i < fills.length; i += CHUNK_SIZE) {
    chunks.push(fills.slice(i, i + CHUNK_SIZE).map(f => ({
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
    })));
  }

  await runConcurrent(fills.length > 0 ? chunks.map((payload, idx) => async () => {
    const { error } = await supabase.from("backtest_fills").insert(payload);
    if (error) {
      let msg = error.message || "Unknown error";
      if (msg.startsWith("<!DOCTYPE") || msg.startsWith("<html")) msg = `HTML response (Cloudflare/5xx) - length: ${msg.length}`;
      logger.error("insertBacktestFills failed on chunk", { error: { ...error, message: msg }, backtestId, chunkIndex: idx });
      throw new Error(`Failed to insert backtest fills chunk: ${msg}`);
    }
  }) : [], CHUNK_CONCURRENCY);
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

/** Persists a full backtest result summary to the backtest_results table. */
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
  
  // Strip fields that are not DB columns
  delete payload.orders;
  delete payload.fills;
  delete payload.reused_from_id;   // serve-time annotation, not a persisted fact
  delete payload.data_validation;  // derivable by re-running validateBars(); not a run result
  delete payload.fill_model;       // derivable from config + DEFAULT_FILL_MODEL merge
  delete payload.assumptions;      // derivable from metrics + config fields

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

// Recursively serializes an object with sorted keys so that two objects with the
// same values but different insertion order produce the same string.
function stableStringify(val: unknown): string {
  if (val === null || typeof val !== "object") return JSON.stringify(val);
  if (Array.isArray(val)) return `[${val.map(stableStringify).join(",")}]`;
  const keys = Object.keys(val as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((val as Record<string, unknown>)[k])}`).join(",")}}`;
}

// Returns a stable fingerprint over the fields that define a unique backtest run.
// Excludes id, name, description, and meta since they don't affect the simulation.
// Includes strategyVersion so results from outdated algorithm versions are not reused.
// Exported so the controller can compute the key without an extra DB round-trip
// (used for in-flight dedup against concurrent identical requests).
export function backtestConfigKey(config: BacktestConfig): string {
  return stableStringify({
    startDate: config.startDate,
    endDate: config.endDate,
    initialCapital: config.initialCapital,
    slippageBps: config.slippageBps,
    commissionPerShare: config.commissionPerShare,
    dataGranularity: config.dataGranularity,
    strategyVersion: config.strategyVersion ?? null,
    strategyConfig: config.strategyConfig,
    riskConfig: config.riskConfig ?? null,
    fillModel: config.fillModel ?? null,
    riskFreeRateAnnual: config.riskFreeRateAnnual ?? 0,
    benchmarkCurve: config.benchmarkCurve ?? null,
  });
}

/**
 * Searches completed backtest results for one whose config fingerprint matches
 * the supplied config. Filters by strategy_version in the DB query when available
 * so outdated algorithm versions are never reused. Returns the full result
 * (including equity_curve) if a match is found, otherwise null.
 */
export async function findMatchingBacktestResult(config: BacktestConfig): Promise<BacktestResult | null> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("backtest_results")
    .select("id, config, strategy_version, started_at, completed_at")
    .eq("status", "completed")
    .order("started_at", { ascending: false })
    .limit(50);

  // Filter by strategy_version at the DB level when it is known, so rows from
  // other algorithm versions are excluded before any JS comparison.
  if (config.strategyVersion != null) {
    query = query.eq("strategy_version", config.strategyVersion);
  }

  const { data, error } = await query;
  if (error) {
    logger.error("findMatchingBacktestResult: DB query error", { error });
    return null;
  }
  if (!data || data.length === 0) {
    logger.info("findMatchingBacktestResult: no completed rows found in DB");
    return null;
  }

  const key = backtestConfigKey(config);
  logger.info("findMatchingBacktestResult: comparing against DB rows", {
    rowCount: data.length,
    searchKey: key,
    firstStoredKey: backtestConfigKey(data[0].config as BacktestConfig),
  });
  const match = data.find((row) => backtestConfigKey(row.config as BacktestConfig) === key);
  if (!match) {
    logger.info("findMatchingBacktestResult: no key match found");
    return null;
  }

  return getBacktestResultById(match.id as string);
}

export async function updateBacktestResultStatus(id: string, status: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("backtest_results")
    .update({ status })
    .eq("id", id);
  if (error) logger.error("updateBacktestResultStatus failed", { error: error.message, id });
}

/** Retrieves all backtest result summaries (without large equity curve payload). */
export async function getAllBacktestResults(): Promise<BacktestResult[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("backtest_results")
    .select("id, strategy_id, strategy_version, config, status, started_at, completed_at, error_message, final_portfolio, metrics, event_count, created_at")
    .order("started_at", { ascending: false });
  if (error) {
    logger.error("getAllBacktestResults failed", { error: error.message });
    return [];
  }
  return (data ?? []) as unknown as BacktestResult[];
}

/** Retrieves a single backtest result by ID, including the full equity curve. */
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
