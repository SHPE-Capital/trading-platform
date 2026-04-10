/**
 * services/portfolioService.ts
 *
 * Frontend service for portfolio API calls.
 * All backend portfolio endpoint interactions go through this module.
 *
 * Inputs:  Optional query parameters (strategyRunId, limit).
 * Outputs: PortfolioSnapshot, PortfolioSnapshot[], Order[] from the backend API.
 */

import { apiGet } from "./api";
import type { PortfolioSnapshot, Order } from "../types/portfolio";

/**
 * Fetches the current portfolio snapshot from the backend.
 * @returns Latest PortfolioSnapshot
 */
export async function fetchPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  return apiGet<PortfolioSnapshot>("/portfolio/snapshot");
}

/**
 * Fetches the equity curve (historical snapshots) for charting.
 * @param limit - Max number of snapshots to return (default 500)
 * @returns Array of PortfolioSnapshot objects
 */
export async function fetchEquityCurve(limit = 500): Promise<PortfolioSnapshot[]> {
  return apiGet<PortfolioSnapshot[]>(`/portfolio/equity-curve?limit=${limit}`);
}

/**
 * Fetches order history for a specific strategy run.
 * @param strategyRunId - Strategy run UUID
 * @returns Array of Order objects
 */
export async function fetchOrders(strategyRunId: string): Promise<Order[]> {
  return apiGet<Order[]>(`/portfolio/orders?strategyRunId=${strategyRunId}`);
}
