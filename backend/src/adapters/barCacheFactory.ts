/**
 * adapters/barCacheFactory.ts
 *
 * The bar cache this process uses, chosen by BAR_CACHE:
 *   file     (default) gzipped day files under MARKET_DATA_DIR — no database
 *            space or egress; each machine fills its own cache from Alpaca
 *   supabase the shared bars / bar_coverage tables (0002), for setups that
 *            want one cache across machines
 *
 * One instance per process, so file merges of the same day are serialized.
 */

import { env } from "../config/env";
import { FileBarCache } from "./localfs/fileBarCache";
import { SupabaseBarCache } from "./supabase/barCacheRepository";
import type { BarCache } from "../core/backtest/barCache";

let shared: BarCache | null = null;

export function getBarCache(): BarCache {
  shared ??= env.barCache === "supabase" ? new SupabaseBarCache() : new FileBarCache(env.marketDataDir);
  return shared;
}
