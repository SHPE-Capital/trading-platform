/**
 * db/seed/instruments.ts
 *
 * Seed data: inserts a starting set of common instruments into the
 * instruments table. Run this once after the initial migration to
 * populate the instrument metadata used by strategy configuration UIs.
 *
 * Inputs:  Supabase client from getSupabaseClient().
 * Outputs: Inserted instrument rows; logs results.
 */

import { getSupabaseClient } from "../../adapters/supabase/client";
import { logger } from "../../utils/logger";
import type { InstrumentsRow } from "../schema/tables";

const SEED_INSTRUMENTS: Omit<InstrumentsRow, "id" | "created_at">[] = [
  { symbol: "SPY",  name: "SPDR S&P 500 ETF Trust",          asset_class: "us_equity", exchange: "NYSE",   is_active: true },
  { symbol: "QQQ",  name: "Invesco QQQ Trust",                asset_class: "us_equity", exchange: "NASDAQ", is_active: true },
  { symbol: "IWM",  name: "iShares Russell 2000 ETF",         asset_class: "us_equity", exchange: "NYSE",   is_active: true },
  { symbol: "GLD",  name: "SPDR Gold Shares",                 asset_class: "us_equity", exchange: "NYSE",   is_active: true },
  { symbol: "TLT",  name: "iShares 20+ Year Treasury Bond",   asset_class: "us_equity", exchange: "NASDAQ", is_active: true },
  { symbol: "AAPL", name: "Apple Inc.",                       asset_class: "us_equity", exchange: "NASDAQ", is_active: true },
  { symbol: "MSFT", name: "Microsoft Corporation",            asset_class: "us_equity", exchange: "NASDAQ", is_active: true },
  { symbol: "GOOG", name: "Alphabet Inc. Class C",            asset_class: "us_equity", exchange: "NASDAQ", is_active: true },
  { symbol: "AMZN", name: "Amazon.com Inc.",                  asset_class: "us_equity", exchange: "NASDAQ", is_active: true },
  { symbol: "META", name: "Meta Platforms Inc.",              asset_class: "us_equity", exchange: "NASDAQ", is_active: true },
  { symbol: "NVDA", name: "NVIDIA Corporation",               asset_class: "us_equity", exchange: "NASDAQ", is_active: true },
  { symbol: "XOM",  name: "Exxon Mobil Corporation",          asset_class: "us_equity", exchange: "NYSE",   is_active: true },
  { symbol: "JPM",  name: "JPMorgan Chase & Co.",             asset_class: "us_equity", exchange: "NYSE",   is_active: true },
  { symbol: "BAC",  name: "Bank of America Corporation",      asset_class: "us_equity", exchange: "NYSE",   is_active: true },
  { symbol: "GS",   name: "The Goldman Sachs Group Inc.",     asset_class: "us_equity", exchange: "NYSE",   is_active: true },
];

/**
 * Seeds the instruments table with a starting set of common instruments.
 * Uses upsert (INSERT ... ON CONFLICT DO NOTHING) to be idempotent.
 */
export async function seedInstruments(): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("instruments")
    .upsert(SEED_INSTRUMENTS, { onConflict: "symbol", ignoreDuplicates: true });

  if (error) {
    logger.error("seedInstruments: failed", { error: error.message });
  } else {
    logger.info("seedInstruments: complete", { count: SEED_INSTRUMENTS.length });
  }
}

// Allow direct execution: ts-node src/db/seed/instruments.ts
if (require.main === module) {
  seedInstruments().then(() => process.exit(0)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
