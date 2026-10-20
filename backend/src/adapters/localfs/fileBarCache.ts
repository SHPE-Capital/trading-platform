/**
 * adapters/localfs/fileBarCache.ts
 *
 * BarCache on local disk, under MARKET_DATA_DIR. Keeps the minute-bar cache out
 * of Postgres, where one symbol-year of minute bars costs 15–35 MB of the
 * database and every read is billed egress. Layout, one UTC day per file:
 *
 *   {root}/sip/bars/{timeframe}/{SYMBOL}/{YYYY-MM-DD}.json.gz           bars
 *   {root}/sip/bars/{timeframe}/{SYMBOL}/{YYYY-MM-DD}.complete.json     {"barCount": n}
 *
 * A day file is a gzipped JSON array of [ts, open, high, low, close, volume,
 * tradeCount, vwap] tuples, ascending by ts. Bar files can exist without a
 * marker: the loader writes recent days it does not yet trust as settled, and
 * replay reads them anyway. Only markComplete() creates a marker, so a day file
 * alone never reads as complete; a marker alone is a known-empty day.
 *
 * Files are written under a temporary name and renamed into place. Merges of
 * the same day within this process are serialized; across processes the last
 * rename wins, which is safe because a day is only marked complete after its
 * full-day write and a lost merge only means a re-fetch.
 *
 * Inputs:  Bars to upsert, days to mark complete, ranges to read.
 * Outputs: Bars in [startMs, endMs) and the complete days in a range.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { utcDay, utcDaysInRange, type BarCache } from "../../core/backtest/barCache";
import type { Bar } from "../../types/market";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** The cache has no feed column (see BAR_FEED): every cached bar is SIP. */
const FEED_DIR = "sip";
const COMPLETE_FILE = /^(\d{4}-\d{2}-\d{2})\.complete\.json$/;

type BarTuple = [number, number, number, number, number, number, number | null, number | null];

export class FileBarCache implements BarCache {
  private readonly root: string;
  /** Day file → the merge in flight for it, so two writes in this process never interleave. */
  private readonly writing = new Map<string, Promise<void>>();

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  async getCompleteDays(symbol: string, timeframe: string, fromDay: string, toDay: string): Promise<Set<string>> {
    let names: string[] = [];
    try {
      names = await fs.readdir(this._dir(symbol, timeframe));
    } catch {
      // No directory yet: nothing cached for this symbol.
    }
    const days = new Set<string>();
    for (const name of names) {
      const match = COMPLETE_FILE.exec(name);
      if (match && match[1] >= fromDay && match[1] <= toDay) days.add(match[1]);
    }
    return days;
  }

  async readBars(symbol: string, timeframe: string, startMs: number, endMs: number): Promise<Bar[]> {
    const bars: Bar[] = [];
    for (const day of utcDaysInRange(startMs, endMs)) {
      const tuples = await this._readDay(this._dayFile(symbol, timeframe, day));
      for (const tuple of tuples ?? []) {
        if (tuple[0] >= startMs && tuple[0] < endMs) bars.push(toBar(symbol, timeframe, tuple));
      }
    }
    return bars;
  }

  async writeBars(symbol: string, timeframe: string, bars: Bar[]): Promise<void> {
    const byDay = new Map<string, Bar[]>();
    for (const bar of bars) {
      const day = utcDay(bar.ts);
      const list = byDay.get(day);
      if (list) list.push(bar);
      else byDay.set(day, [bar]);
    }
    if (byDay.size === 0) return;
    await fs.mkdir(this._dir(symbol, timeframe), { recursive: true });
    for (const [day, dayBars] of byDay) {
      await this._serialized(this._dayFile(symbol, timeframe, day), (file) => this._mergeDay(file, dayBars));
    }
  }

  async markComplete(symbol: string, timeframe: string, days: { day: string; barCount: number }[]): Promise<void> {
    if (days.length === 0) return;
    const dir = this._dir(symbol, timeframe);
    await fs.mkdir(dir, { recursive: true });
    for (const { day, barCount } of days) {
      await writeAtomic(path.join(dir, `${day}.complete.json`), JSON.stringify({ barCount }));
    }
  }

  private async _mergeDay(file: string, bars: Bar[]): Promise<void> {
    // An unreadable existing file is replaced rather than merged into.
    const existing = (await this._readDay(file).catch(() => null)) ?? [];
    const byTs = new Map<number, BarTuple>();
    for (const tuple of existing) byTs.set(tuple[0], tuple);
    for (const bar of bars) byTs.set(bar.ts, toTuple(bar));
    const merged = [...byTs.values()].sort((a, b) => a[0] - b[0]);
    await writeAtomic(file, await gzipAsync(JSON.stringify(merged)));
  }

  /** Bars stored for one day, or null when there is no file. Throws on a corrupt file. */
  private async _readDay(file: string): Promise<BarTuple[] | null> {
    let raw: Buffer;
    try {
      raw = await fs.readFile(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    const parsed: unknown = JSON.parse((await gunzipAsync(raw)).toString("utf8"));
    if (!Array.isArray(parsed)) throw new Error(`FileBarCache: ${file} is not a bar array`);
    return parsed as BarTuple[];
  }

  private async _serialized(file: string, task: (file: string) => Promise<void>): Promise<void> {
    const previous = this.writing.get(file) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => task(file));
    this.writing.set(file, next);
    try {
      await next;
    } finally {
      if (this.writing.get(file) === next) this.writing.delete(file);
    }
  }

  private _dir(symbol: string, timeframe: string): string {
    const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_");
    return path.join(this.root, FEED_DIR, "bars", safe(timeframe), safe(symbol));
  }

  private _dayFile(symbol: string, timeframe: string, day: string): string {
    return path.join(this._dir(symbol, timeframe), `${day}.json.gz`);
  }
}

async function writeAtomic(file: string, data: string | Buffer): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

function toTuple(bar: Bar): BarTuple {
  return [bar.ts, bar.open, bar.high, bar.low, bar.close, bar.volume, bar.tradeCount ?? null, bar.vwap ?? null];
}

function toBar(symbol: string, timeframe: string, [ts, open, high, low, close, volume, tradeCount, vwap]: BarTuple): Bar {
  return {
    symbol,
    ts,
    isoTs: new Date(ts).toISOString(),
    open,
    high,
    low,
    close,
    volume,
    tradeCount: tradeCount ?? undefined,
    vwap: vwap ?? undefined,
    timeframe,
  };
}
