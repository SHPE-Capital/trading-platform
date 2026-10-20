/**
 * services/portfolioService.ts
 *
 * Frontend service for portfolio API calls.
 * All backend portfolio endpoint interactions go through this module.
 *
 * Inputs:  Optional query parameters (strategyRunId, limit).
 * Outputs: the live snapshot and equity curve from the trading runtime; orders
 *          and fills straight from Supabase (services/db.ts).
 */

import { apiGet } from "./api";
import { queryOrders, queryRecentFills } from "./db";
import type { EquityPoint, Fill, Order, PortfolioSnapshot } from "../types/portfolio";

/**
 * Fetches the current portfolio snapshot from the backend.
 * @returns Latest PortfolioSnapshot
 */
export async function fetchPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  return apiGet<PortfolioSnapshot>("/portfolio/snapshot");
}

/**
 * Fetches the equity curve for charting: the runtime's book, downsampled in the
 * database to about `points` points from its first snapshot to now. Served by
 * the trading process because only it knows which broker account it books.
 */
export async function fetchEquityCurve(points = 500): Promise<EquityPoint[]> {
  return apiGet<EquityPoint[]>(`/portfolio/equity-curve?limit=${points}`);
}

/**
 * Fetches order history. Pass a strategyRunId to filter by run,
 * or omit it to fetch all orders (newest first, up to 500).
 */
/** The most recent fills across every run, newest first. */
export async function fetchRecentFills(): Promise<Fill[]> {
  return queryRecentFills();
}

export async function fetchOrders(strategyRunId?: string): Promise<Order[]> {
  return queryOrders(strategyRunId);
}
