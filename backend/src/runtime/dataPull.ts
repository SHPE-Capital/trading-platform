/**
 * runtime/dataPull.ts
 *
 * Seeds the local bar cache from the club's hosted bar cache, so a sim runtime
 * with no Alpaca data keys has something to replay. Reads go through the hosted
 * API's GET /api/market-data/bars, which serves cached bars only and never
 * calls Alpaca.
 *
 *   npm run data:pull -- --symbols SPY,QQQ --from 2026-10-01 --to 2026-10-07
 *
 * Needs HOSTED_API_URL (e.g. https://<host>/api) and a club login, either as
 * HOSTED_API_TOKEN (a session access token) or as HOSTED_SUPABASE_URL +
 * HOSTED_SUPABASE_ANON_KEY + HOSTED_EMAIL + HOSTED_PASSWORD. Bars are written to
 * the Supabase in SUPABASE_URL — your local one.
 */

import { createClient } from "@supabase/supabase-js";
import { SupabaseBarCache } from "../adapters/supabase/barCacheRepository";
import { utcDay } from "../core/backtest/barCache";
import { logger } from "../utils/logger";
import type { Bar } from "../types/market";

const CHUNK_MS = 7 * 86_400_000;

interface Args {
  symbols: string[];
  fromMs: number;
  toMs: number;
  timeframe: string;
}

export function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const symbols = (get("--symbols") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const fromMs = Date.parse(get("--from") ?? "");
  const toMs = Date.parse(get("--to") ?? "");
  if (symbols.length === 0 || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
    throw new Error("Usage: npm run data:pull -- --symbols SPY,QQQ --from YYYY-MM-DD --to YYYY-MM-DD [--timeframe 1Min]");
  }
  return { symbols, fromMs, toMs, timeframe: get("--timeframe") ?? "1Min" };
}

async function accessToken(): Promise<string> {
  if (process.env.HOSTED_API_TOKEN) return process.env.HOSTED_API_TOKEN;
  const { HOSTED_SUPABASE_URL, HOSTED_SUPABASE_ANON_KEY, HOSTED_EMAIL, HOSTED_PASSWORD } = process.env;
  if (!HOSTED_SUPABASE_URL || !HOSTED_SUPABASE_ANON_KEY || !HOSTED_EMAIL || !HOSTED_PASSWORD) {
    throw new Error("Set HOSTED_API_TOKEN, or HOSTED_SUPABASE_URL, HOSTED_SUPABASE_ANON_KEY, HOSTED_EMAIL and HOSTED_PASSWORD");
  }
  const client = createClient(HOSTED_SUPABASE_URL, HOSTED_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email: HOSTED_EMAIL, password: HOSTED_PASSWORD });
  if (error || !data.session) throw new Error(`Sign-in to the hosted project failed: ${error?.message ?? "no session"}`);
  return data.session.access_token;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const api = process.env.HOSTED_API_URL;
  if (!api) throw new Error("Set HOSTED_API_URL to the hosted API base, e.g. https://<host>/api");
  const token = await accessToken();
  const cache = new SupabaseBarCache();

  for (const symbol of args.symbols) {
    let total = 0;
    for (let from = args.fromMs; from < args.toMs; from += CHUNK_MS) {
      const to = Math.min(from + CHUNK_MS, args.toMs);
      const qs = new URLSearchParams({
        symbol, timeframe: args.timeframe, from: new Date(from).toISOString(), to: new Date(to).toISOString(),
      });
      const res = await fetch(`${api}/market-data/bars?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`GET bars ${symbol} failed (${res.status}): ${await res.text()}`);
      const body = (await res.json()) as { bars: Bar[]; completeDays: string[] };
      if (body.bars.length > 0) await cache.writeBars(symbol, args.timeframe, body.bars);
      const perDay = new Map<string, number>();
      for (const bar of body.bars) perDay.set(utcDay(bar.ts), (perDay.get(utcDay(bar.ts)) ?? 0) + 1);
      await cache.markComplete(symbol, args.timeframe, body.completeDays.map((day) => ({ day, barCount: perDay.get(day) ?? 0 })));
      total += body.bars.length;
    }
    logger.info(`data:pull: ${symbol} — ${total} bars cached locally`);
    if (total === 0) logger.warn(`data:pull: the hosted cache has no ${symbol} bars in that range — run a backtest over it there first`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    logger.error("data:pull failed", { err: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}
