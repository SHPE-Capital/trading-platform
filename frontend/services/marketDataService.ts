/**
 * services/marketDataService.ts
 *
 * Frontend service for market data API calls.
 *
 * Inputs:  Symbol strings.
 * Outputs: Quote snapshots and symbol lists from the backend API.
 */

import { apiGet } from "./api";
import type { Quote } from "../types/market";

/**
 * Fetches the list of symbols currently tracked by the engine.
 * @returns Array of ticker symbol strings
 */
export async function fetchTrackedSymbols(): Promise<string[]> {
  return apiGet<string[]>("/market-data/symbols");
}

/**
 * Fetches the latest quote snapshot for a symbol.
 * @param symbol - Ticker symbol
 * @returns Quote object
 */
export async function fetchSymbolSnapshot(symbol: string): Promise<Quote> {
  return apiGet<Quote>(`/market-data/snapshot/${symbol}`);
}
