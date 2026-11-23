/**
 * runtime/verify/barArrival.ts
 *
 * Standalone, read-only recorder for minute-bar arrival timing on the Alpaca
 * market-data WebSocket (task P2-7). It subscribes to bars and updatedBars
 * only, never touches the trading API, the EventBus or any runtime, and writes
 * a summary plus a per-bar CSV to its own output directory.
 *
 * It answers: how long after a minute ends does its bar arrive (percentiles),
 * what fraction arrive later than a deadline (default 1 s), which expected
 * bars never arrive, and how often a delivered bar is later corrected.
 *
 * The statistics live in BarArrivalRecorder, which takes raw frame text and a
 * receive time, so tests drive it with a fake feed and no socket.
 *
 * Usage (needs YOUR data keys; see docs/guides/bar-arrival-timing.md):
 *   npx ts-node src/runtime/verify/barArrival.ts --symbols SPY,QQQ \
 *     --duration-min 390 --confirm-stream-owner
 */

import fs from "fs";
import path from "path";

const MINUTE_MS = 60_000;

export interface BarArrivalOptions {
  /** Symbols the subscription asked for; the basis for "missing" bars. */
  symbols: string[];
  /** A bar later than this after its minute ends counts as late. */
  lateThresholdMs: number;
  /**
   * Minutes (epoch ms of minute start) expected to carry a bar, inclusive
   * start and exclusive end. When absent, the window is the first to the last
   * minute observed on any symbol, which hides outages at the edges.
   */
  windowStartMs?: number;
  windowEndMs?: number;
}

export interface Percentiles {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
}

export interface BarArrivalReport {
  symbols: number;
  bars: number;
  /** Latency after the minute END, ms; negative values mean a skewed local clock. */
  latencyMs: Percentiles | null;
  lateThresholdMs: number;
  lateCount: number;
  lateFraction: number;
  /** Bars whose arrival preceded the minute end (clock skew or bad timestamp). */
  negativeLatencyCount: number;
  /** Same bar (symbol, minute) delivered more than once as a new bar. */
  duplicateBars: number;
  missing: {
    windowStartMs: number;
    windowEndMs: number;
    expected: number;
    missing: number;
    missingFraction: number;
    /** Per symbol, only symbols with at least one gap. */
    bySymbol: Record<string, number>;
  };
  corrections: {
    updates: number;
    barsCorrected: number;
    /** Corrected bars over delivered bars. */
    fractionOfBarsCorrected: number;
    /** Delay of the correction after the minute END, ms. */
    lagMs: Percentiles | null;
    /** Corrections for a bar that never arrived as "b". */
    withoutOriginal: number;
  };
  /** Server `error` frames, e.g. 405 symbol limit exceeded, 406 connection limit exceeded. */
  errors: Array<{ code: unknown; msg: unknown }>;
  /** Subscription acks as the server reported them (not the requested set). */
  subscriptionAcks: Array<{ bars: number; updatedBars: number }>;
  unparseableFrames: number;
}

export interface BarRow {
  symbol: string;
  minuteStartMs: number;
  rxMs: number;
  latencyMs: number;
}

/** Nearest-rank percentile on an ascending-sorted array. */
function rank(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

export function percentiles(values: number[]): Percentiles | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return { p50: rank(s, 50), p90: rank(s, 90), p95: rank(s, 95), p99: rank(s, 99), max: s[s.length - 1] };
}

export class BarArrivalRecorder {
  private readonly rows: BarRow[] = [];
  private readonly seen = new Set<string>();
  private readonly corrected = new Set<string>();
  private readonly correctionLags: number[] = [];
  private updates = 0;
  private correctionsWithoutOriginal = 0;
  private duplicates = 0;
  private unparseable = 0;
  private readonly errors: Array<{ code: unknown; msg: unknown }> = [];
  private readonly acks: Array<{ bars: number; updatedBars: number }> = [];

  constructor(private readonly options: BarArrivalOptions) {}

  /** Feeds one raw WebSocket frame (a JSON array of messages) received at rxMs. */
  onFrame(text: string, rxMs: number): void {
    let messages: unknown;
    try {
      messages = JSON.parse(text);
    } catch {
      this.unparseable++;
      return;
    }
    if (!Array.isArray(messages)) {
      this.unparseable++;
      return;
    }
    for (const raw of messages) {
      const m = (raw ?? {}) as Record<string, unknown>;
      switch (m["T"]) {
        case "b":
          this.onBar(m, rxMs);
          break;
        case "u":
          this.onUpdate(m, rxMs);
          break;
        case "error":
          this.errors.push({ code: m["code"], msg: m["msg"] });
          break;
        case "subscription":
          this.acks.push({ bars: lengthOf(m["bars"]), updatedBars: lengthOf(m["updatedBars"]) });
          break;
        default:
          break;
      }
    }
  }

  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  /** Bars delivered so far, in arrival order. */
  barRows(): readonly BarRow[] {
    return this.rows;
  }

  report(): BarArrivalReport {
    const { symbols, lateThresholdMs } = this.options;
    const latencies = this.rows.map((r) => r.latencyMs);
    const lateCount = latencies.filter((l) => l > lateThresholdMs).length;

    const missing = this.missing();
    const lagSorted = this.correctionLags;
    return {
      symbols: symbols.length,
      bars: this.rows.length,
      latencyMs: percentiles(latencies),
      lateThresholdMs,
      lateCount,
      lateFraction: this.rows.length === 0 ? 0 : lateCount / this.rows.length,
      negativeLatencyCount: latencies.filter((l) => l < 0).length,
      duplicateBars: this.duplicates,
      missing,
      corrections: {
        updates: this.updates,
        barsCorrected: this.corrected.size,
        fractionOfBarsCorrected: this.rows.length === 0 ? 0 : this.corrected.size / this.rows.length,
        lagMs: percentiles(lagSorted),
        withoutOriginal: this.correctionsWithoutOriginal,
      },
      errors: [...this.errors],
      subscriptionAcks: [...this.acks],
      unparseableFrames: this.unparseable,
    };
  }

  private onBar(m: Record<string, unknown>, rxMs: number): void {
    const parsed = parseBar(m);
    if (!parsed) return;
    const key = `${parsed.symbol}|${parsed.minuteStartMs}`;
    if (this.seen.has(key)) {
      this.duplicates++;
      return;
    }
    this.seen.add(key);
    this.rows.push({
      symbol: parsed.symbol,
      minuteStartMs: parsed.minuteStartMs,
      rxMs,
      latencyMs: rxMs - (parsed.minuteStartMs + MINUTE_MS),
    });
  }

  private onUpdate(m: Record<string, unknown>, rxMs: number): void {
    const parsed = parseBar(m);
    if (!parsed) return;
    this.updates++;
    const key = `${parsed.symbol}|${parsed.minuteStartMs}`;
    if (this.seen.has(key)) this.corrected.add(key);
    else this.correctionsWithoutOriginal++;
    this.correctionLags.push(rxMs - (parsed.minuteStartMs + MINUTE_MS));
  }

  private missing(): BarArrivalReport["missing"] {
    const { symbols } = this.options;
    const starts = this.rows.map((r) => r.minuteStartMs);
    const windowStartMs = this.options.windowStartMs ?? (starts.length ? Math.min(...starts) : 0);
    const windowEndMs = this.options.windowEndMs ?? (starts.length ? Math.max(...starts) + MINUTE_MS : 0);
    const minutes = Math.max(0, Math.floor((windowEndMs - windowStartMs) / MINUTE_MS));
    const bySymbol: Record<string, number> = {};
    let missing = 0;
    for (const symbol of symbols) {
      let have = 0;
      for (let t = windowStartMs; t < windowEndMs; t += MINUTE_MS) {
        if (this.seen.has(`${symbol}|${t}`)) have++;
      }
      const gap = minutes - have;
      if (gap > 0) {
        bySymbol[symbol] = gap;
        missing += gap;
      }
    }
    const expected = minutes * symbols.length;
    return {
      windowStartMs,
      windowEndMs,
      expected,
      missing,
      missingFraction: expected === 0 ? 0 : missing / expected,
      bySymbol,
    };
  }
}

function lengthOf(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

function parseBar(m: Record<string, unknown>): { symbol: string; minuteStartMs: number } | null {
  const symbol = m["S"];
  const t = m["t"];
  if (typeof symbol !== "string" || typeof t !== "string") return null;
  const minuteStartMs = Date.parse(t);
  return Number.isFinite(minuteStartMs) ? { symbol, minuteStartMs } : null;
}

// ---------------------------------------------------------------------------
// CLI (live; read-only market data stream with the user's own keys)
// ---------------------------------------------------------------------------

interface CliArgs {
  symbols: string[];
  durationMin: number;
  lateMs: number;
  out: string;
  url: string;
  confirm: boolean;
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): CliArgs {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument ${a}`);
    const name = a.slice(2);
    if (name === "confirm-stream-owner") {
      flags.set(name, "1");
      continue;
    }
    const v = argv[++i];
    if (v === undefined) throw new Error(`--${name} needs a value`);
    flags.set(name, v);
  }
  const known = ["symbols", "symbols-file", "duration-min", "late-ms", "out", "url", "confirm-stream-owner"];
  for (const k of flags.keys()) if (!known.includes(k)) throw new Error(`unknown flag --${k}`);

  const fromFile = flags.get("symbols-file");
  const raw = flags.get("symbols") ?? (fromFile ? fs.readFileSync(fromFile, "utf8") : "");
  const symbols = [...new Set(raw.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (symbols.length === 0) throw new Error("--symbols or --symbols-file is required");
  const durationMin = Number(flags.get("duration-min") ?? "390");
  const lateMs = Number(flags.get("late-ms") ?? "1000");
  if (!(durationMin > 0) || !(lateMs >= 0)) throw new Error("--duration-min must be > 0 and --late-ms >= 0");
  return {
    symbols,
    durationMin,
    lateMs,
    out: flags.get("out") ?? path.join("bar-arrival-runs", new Date().toISOString().replace(/[:.]/g, "-")),
    url: flags.get("url") ?? env["ALPACA_DATA_STREAM_URL"] ?? "wss://stream.data.alpaca.markets/v2/iex",
    confirm: flags.has("confirm-stream-owner"),
  };
}

export function barRowsCsv(rows: readonly BarRow[]): string {
  const lines = rows.map((r) => `${r.symbol},${new Date(r.minuteStartMs).toISOString()},${r.rxMs},${r.latencyMs}`);
  return ["symbol,minute_start,rx_epoch_ms,latency_after_minute_end_ms", ...lines].join("\n") + "\n";
}

async function main(): Promise<void> {
  // Lazy imports keep the unit tests free of sockets and env loading.
  await import("dotenv/config");
  const { default: WebSocket } = await import("ws");
  const args = parseArgs(process.argv.slice(2), process.env);
  const key = process.env["ALPACA_DATA_KEY"] ?? process.env["ALPACA_API_KEY"];
  const secret = process.env["ALPACA_DATA_SECRET"] ?? process.env["ALPACA_API_SECRET"];
  if (!args.confirm) {
    throw new Error("refusing to open a data stream without --confirm-stream-owner (free plan: one stream per account; stop other streamers first)");
  }
  if (!key || !secret) throw new Error("ALPACA_DATA_KEY / ALPACA_DATA_SECRET are not set");

  const recorder = new BarArrivalRecorder({ symbols: args.symbols, lateThresholdMs: args.lateMs });
  fs.mkdirSync(args.out, { recursive: true });
  const ws = new WebSocket(args.url);
  let finished = false;

  const finish = (why: string): void => {
    if (finished) return;
    finished = true;
    const report = recorder.report();
    fs.writeFileSync(path.join(args.out, "summary.json"), JSON.stringify({ stoppedBecause: why, url: args.url, requestedSymbols: args.symbols.length, ...report }, null, 2));
    fs.writeFileSync(path.join(args.out, "bars.csv"), barRowsCsv(recorder.barRows()));
    console.log(`stopped (${why}); wrote ${args.out}/summary.json and bars.csv`);
    console.log(JSON.stringify({ bars: report.bars, latencyMs: report.latencyMs, lateFraction: report.lateFraction, missing: report.missing.missing, errors: report.errors, subscriptionAcks: report.subscriptionAcks }, null, 2));
    ws.close();
    setTimeout(() => process.exit(report.errors.length > 0 ? 1 : 0), 200);
  };

  ws.on("open", () => ws.send(JSON.stringify({ action: "auth", key, secret })));
  ws.on("message", (data) => {
    const rxMs = Date.now();
    const text = data.toString();
    recorder.onFrame(text, rxMs);
    if (text.includes('"authenticated"')) {
      ws.send(JSON.stringify({ action: "subscribe", bars: args.symbols, updatedBars: args.symbols }));
    }
    // 4xx errors (405 symbol limit, 406 connection limit) are fatal for this probe.
    if (recorder.hasErrors()) finish("server error frame");
  });
  ws.on("error", (e) => {
    console.error(`websocket error: ${e.message}`);
    finish("websocket error");
  });
  ws.on("close", () => finish("socket closed"));
  process.on("SIGINT", () => finish("SIGINT"));
  setTimeout(() => finish("duration elapsed"), args.durationMin * MINUTE_MS);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
