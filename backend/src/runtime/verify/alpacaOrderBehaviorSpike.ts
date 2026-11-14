/**
 * runtime/verify/alpacaOrderBehaviorSpike.ts
 *
 * THROWAWAY spike (task P2-1). Observes how Alpaca PAPER handles protective
 * stops, replace, held-quantity conflicts, partial fills, cancel/fill races,
 * bracket/OTO classes and rejections, and writes a timestamped JSON log. The
 * findings go into docs/guides/alpaca-order-behavior.md. Not wired into any
 * runtime, package script or test; delete once P2-2/P2-3 land.
 *
 * It PLACES REAL ORDERS in the paper account. Nothing happens unless
 * --confirm-paper is passed. It refuses to run when ALPACA_TRADING_MODE is not
 * "paper", when the market is closed (unless --allow-closed), or when the
 * paper base URL is not a paper host. Every tunable is a CLI flag.
 *
 * Usage (from backend/, with paper keys in the environment):
 *   npx ts-node src/runtime/verify/alpacaOrderBehaviorSpike.ts \
 *     --confirm-paper --symbol SPY --qty 10 --scenarios all
 *
 * Flags (defaults in parentheses):
 *   --symbol <S>          liquid symbol to probe (SPY)
 *   --qty <n>             whole shares per probe, >= 4 so resizes are visible (10)
 *   --scenarios <list>    comma list of: stop-replace, held-sell, cancel-then-sell,
 *                         partial-resize, limit-cancel-race, bracket-oto, rejections, or all (all)
 *   --stop-offset-pct <x> stop distance below last trade, in percent (1.0)
 *   --limit-cancel-ms <n> delay between a near-touch limit and its cancel (2000)
 *   --race-trials <n>     repeats of the limit/cancel race (5)
 *   --settle-ms <n>       wait for the stream after each action (3000)
 *   --out <file>          log path (alpaca-order-behavior-<timestamp>.json in cwd)
 *   --allow-closed        run while the market is closed (stops will not trigger)
 *   --confirm-paper       required; without it the script only prints the plan
 *
 * Exit code: 0 when the run completed (observations are not pass/fail), 1 on a
 * guard refusal or an unexpected crash.
 */

import "dotenv/config";
import WebSocket from "ws";
import { writeFileSync } from "node:fs";
import { env } from "../../config/env";

// ---------------------------------------------------------------- arguments

const SCENARIO_NAMES = [
  "stop-replace",
  "held-sell",
  "cancel-then-sell",
  "partial-resize",
  "limit-cancel-race",
  "bracket-oto",
  "rejections",
] as const;
type Scenario = (typeof SCENARIO_NAMES)[number];

interface Args {
  symbol: string;
  qty: number;
  scenarios: Scenario[];
  stopOffsetPct: number;
  limitCancelMs: number;
  raceTrials: number;
  settleMs: number;
  out: string;
  allowClosed: boolean;
  confirmPaper: boolean;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
    const name = a.slice(2);
    if (name === "allow-closed" || name === "confirm-paper") bools.add(name);
    else {
      const v = argv[++i];
      if (v === undefined) throw new Error(`--${name} needs a value`);
      flags.set(name, v);
    }
  }
  const num = (name: string, dflt: number, min: number): number => {
    const v = Number(flags.get(name) ?? dflt);
    if (!Number.isFinite(v) || v < min) throw new Error(`--${name} must be a number >= ${min}`);
    return v;
  };
  const list = (flags.get("scenarios") ?? "all").split(",").map((s) => s.trim());
  const scenarios = list.includes("all")
    ? [...SCENARIO_NAMES]
    : list.map((s) => {
        if (!(SCENARIO_NAMES as readonly string[]).includes(s)) throw new Error(`unknown scenario: ${s}`);
        return s as Scenario;
      });
  return {
    symbol: (flags.get("symbol") ?? "SPY").toUpperCase(),
    qty: Math.floor(num("qty", 10, 4)),
    scenarios,
    stopOffsetPct: num("stop-offset-pct", 1.0, 0.01),
    limitCancelMs: num("limit-cancel-ms", 2000, 0),
    raceTrials: Math.floor(num("race-trials", 5, 1)),
    settleMs: num("settle-ms", 3000, 100),
    out: flags.get("out") ?? `alpaca-order-behavior-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    allowClosed: bools.has("allow-closed"),
    confirmPaper: bools.has("confirm-paper"),
  };
}

// ---------------------------------------------------------------- logging

type Json = Record<string, unknown>;
interface LogEntry {
  tMs: number; // ms since script start
  iso: string;
  scenario: string;
  kind: "http" | "stream" | "note";
  label: string;
  data: Json;
}
const startedAt = Date.now();
const log: LogEntry[] = [];
let currentScenario = "setup";

function record(kind: LogEntry["kind"], label: string, data: Json = {}): void {
  const now = Date.now();
  log.push({ tMs: now - startedAt, iso: new Date(now).toISOString(), scenario: currentScenario, kind, label, data });
  console.log(`  +${String(now - startedAt).padStart(6)}ms [${kind}] ${label} ${JSON.stringify(data).slice(0, 220)}`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- REST

const BASE = env.alpacaPaperBaseUrl;
const HEADERS = {
  "APCA-API-KEY-ID": env.alpacaApiKey,
  "APCA-API-SECRET-KEY": env.alpacaApiSecret,
  "Content-Type": "application/json",
};

interface HttpResult {
  status: number;
  ms: number;
  body: Json;
  list: Json[];
}

function summarizeOrder(o: Json): Json {
  const keys = ["id", "client_order_id", "status", "type", "side", "qty", "filled_qty", "limit_price",
    "stop_price", "order_class", "time_in_force", "replaced_by", "replaces", "filled_avg_price"];
  const out: Json = {};
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) out[k] = o[k];
  return out;
}

/** One REST call with no retries: rejections and codes are the data. */
async function api(method: string, path: string, body?: Json, label?: string): Promise<HttpResult> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: HEADERS,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  const list = Array.isArray(parsed) ? (parsed as Json[]) : [];
  const obj = Array.isArray(parsed) ? {} : (parsed as Json);
  const result: HttpResult = { status: res.status, ms: Date.now() - t0, body: obj, list };
  record("http", label ?? `${method} ${path}`, {
    status: res.status,
    ms: result.ms,
    ...(Array.isArray(parsed) ? { count: list.length } : summarizeOrder(obj)),
    ...(res.ok ? {} : { error: obj }),
  });
  return result;
}

const getOrder = (id: string) => api("GET", `/v2/orders/${id}?nested=true`, undefined, `GET order ${id.slice(0, 8)}`);
const cancel = (id: string) => api("DELETE", `/v2/orders/${id}`, undefined, `DELETE order ${id.slice(0, 8)}`);

async function lastTrade(symbol: string): Promise<number> {
  const url = `https://data.alpaca.markets/v2/stocks/${symbol}/trades/latest?feed=iex`;
  const res = await fetch(url, {
    headers: { "APCA-API-KEY-ID": env.alpacaDataKey, "APCA-API-SECRET-KEY": env.alpacaDataSecret },
  });
  if (!res.ok) throw new Error(`latest trade failed (${res.status}): ${await res.text()}`);
  const j = (await res.json()) as { trade?: { p?: number } };
  const p = j.trade?.p;
  if (!p || !Number.isFinite(p)) throw new Error("latest trade had no price");
  return p;
}

const round2 = (x: number): string => x.toFixed(2);

function newOrderBody(a: Args, o: Json): Json {
  return { symbol: a.symbol, qty: String(a.qty), time_in_force: "day", ...o };
}

/** Polls until the order leaves the listed statuses or the deadline passes. */
async function waitStatus(id: string, whileIn: string[], timeoutMs: number): Promise<Json> {
  const deadline = Date.now() + timeoutMs;
  let last: Json = {};
  while (Date.now() < deadline) {
    const r = await api("GET", `/v2/orders/${id}`, undefined, `poll ${id.slice(0, 8)}`);
    last = r.body;
    if (!whileIn.includes(String(last["status"]))) break;
    await sleep(250);
  }
  return last;
}

// ---------------------------------------------------------------- trade stream

function openTradeStream(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(env.alpacaPaperStreamUrl);
    ws.on("open", () => ws.send(JSON.stringify({ action: "auth", key: env.alpacaApiKey, secret: env.alpacaApiSecret })));
    ws.on("message", (raw) => {
      let m: Json;
      try {
        m = JSON.parse(raw.toString()) as Json;
      } catch {
        return;
      }
      if (m["stream"] === "authorization") {
        const status = (m["data"] as Json | undefined)?.["status"];
        if (status === "authorized") {
          ws.send(JSON.stringify({ action: "listen", data: { streams: ["trade_updates"] } }));
        } else reject(new Error("trade stream auth failed"));
      } else if (m["stream"] === "listening") {
        resolve(ws);
      } else if (m["stream"] === "trade_updates") {
        const d = m["data"] as Json;
        const order = (d["order"] ?? {}) as Json;
        record("stream", String(d["event"]), {
          ...summarizeOrder(order),
          qty: d["qty"],
          price: d["price"],
          position_qty: d["position_qty"],
          timestamp: d["timestamp"],
        });
      }
    });
    ws.on("error", reject);
  });
}

// ---------------------------------------------------------------- helpers

async function position(symbol: string): Promise<number> {
  const r = await api("GET", `/v2/positions/${symbol}`, undefined, "GET position");
  return r.status === 200 ? Number(r.body["qty"]) : 0;
}

/** Market buy and wait for the fill; returns filled qty. */
async function buyMarket(a: Args, qty = a.qty): Promise<number> {
  const r = await api("POST", "/v2/orders", newOrderBody(a, { side: "buy", type: "market", qty: String(qty) }), "POST market buy");
  if (r.status !== 200) return 0;
  const o = await waitStatus(String(r.body["id"]), ["new", "accepted", "pending_new", "partially_filled"], 15_000);
  return Number(o["filled_qty"] ?? 0);
}

/** Cancels everything open and flattens the symbol. Used between scenarios. */
async function cleanup(a: Args): Promise<void> {
  const prior = currentScenario;
  currentScenario = `${prior}:cleanup`;
  await api("DELETE", "/v2/orders", undefined, "DELETE all open orders");
  await sleep(a.settleMs);
  if ((await position(a.symbol)) !== 0) {
    await api("DELETE", `/v2/positions/${a.symbol}`, undefined, "close position");
    await sleep(a.settleMs);
  }
  currentScenario = prior;
}

function stopBody(a: Args, qty: number, px: number, extra: Json = {}): Json {
  return newOrderBody(a, {
    side: "sell", type: "stop", qty: String(qty),
    stop_price: round2(px * (1 - a.stopOffsetPct / 100)), time_in_force: "gtc", ...extra,
  });
}

// ---------------------------------------------------------------- scenarios

async function stopReplace(a: Args): Promise<void> {
  const got = await buyMarket(a);
  record("note", "entry filled", { got });
  if (got <= 0) return;
  const px = await lastTrade(a.symbol);
  const stop = px * (1 - a.stopOffsetPct / 100);
  const created = await api("POST", "/v2/orders", stopBody(a, got, px), "POST stop sell (gtc)");
  // Second stop for the same shares while the first rests (see held-sell).
  await api("POST", "/v2/orders", stopBody(a, got, px - 0.5, { time_in_force: "day" }), "POST second stop sell while first rests");
  if (created.status !== 200) return;
  let id = String(created.body["id"]);
  // Trail: raise the stop in steps. Each PATCH may mint a new order id.
  for (let i = 1; i <= 3; i++) {
    const r = await api("PATCH", `/v2/orders/${id}`, { stop_price: round2(stop + i * 0.05) }, `PATCH stop_price +${i * 5}c`);
    await sleep(a.settleMs);
    if (r.status === 200) id = String(r.body["id"]);
  }
  // Lowering: the broker may allow it (our code must forbid it regardless).
  await api("PATCH", `/v2/orders/${id}`, { stop_price: round2(stop - 0.1) }, "PATCH stop_price lower");
  await getOrder(id);
  await api("PATCH", `/v2/orders/${id}`, { stop_price: round2(stop + 0.15) }, "PATCH stop_price again");
}

async function heldSell(a: Args): Promise<void> {
  const got = await buyMarket(a);
  if (got <= 0) return;
  const px = await lastTrade(a.symbol);
  await api("POST", "/v2/orders", stopBody(a, got, px), "POST resting stop");
  await sleep(a.settleMs);
  await api("GET", `/v2/positions/${a.symbol}`, undefined, "GET position while stop rests (qty_available?)");
  await api("POST", "/v2/orders", newOrderBody(a, { side: "sell", type: "market", qty: String(got) }), "POST market sell of full qty while stop holds all");
  await api("POST", "/v2/orders", newOrderBody(a, { side: "sell", type: "market", qty: "1" }), "POST market sell 1 share while stop holds all");
  await api("DELETE", `/v2/positions/${a.symbol}`, undefined, "DELETE position while stop rests");
}

async function cancelThenSell(a: Args): Promise<void> {
  const trials = 3;
  for (let t = 1; t <= trials; t++) {
    const got = await buyMarket(a);
    if (got <= 0) return;
    const px = await lastTrade(a.symbol);
    const stop = await api("POST", "/v2/orders", stopBody(a, got, px), `trial ${t} POST stop`);
    await sleep(a.settleMs);
    const id = String(stop.body["id"]);
    const tCancel = Date.now();
    await cancel(id);
    // Sell with no wait: is the held qty released before the cancel is confirmed?
    const immediate = await api("POST", "/v2/orders", newOrderBody(a, { side: "sell", type: "market", qty: String(got) }), `trial ${t} market sell immediately after DELETE`);
    if (immediate.status === 200) {
      record("note", "immediate sell accepted", { afterCancelMs: Date.now() - tCancel });
    } else {
      const o = await waitStatus(id, ["pending_cancel", "new", "accepted", "held"], 10_000);
      record("note", "stop terminal status", { status: o["status"], afterCancelMs: Date.now() - tCancel });
      await api("POST", "/v2/orders", newOrderBody(a, { side: "sell", type: "market", qty: String(got) }), `trial ${t} market sell after confirmed cancel`);
    }
    await sleep(a.settleMs);
    await cleanup(a);
  }
}

async function partialResize(a: Args): Promise<void> {
  // Partial fills cannot be forced. Platform notes say multi-share marketable IOC limits
  // partially fill on paper; try that and size a stop to whatever filled.
  const px = await lastTrade(a.symbol);
  for (let t = 1; t <= 3; t++) {
    const r = await api("POST", "/v2/orders", newOrderBody(a, { side: "buy", type: "limit", limit_price: round2(px * 1.0005), time_in_force: "ioc" }), `trial ${t} IOC buy limit`);
    if (r.status !== 200) continue;
    const o = await waitStatus(String(r.body["id"]), ["new", "accepted", "pending_new", "partially_filled"], 8000);
    const filled = Number(o["filled_qty"] ?? 0);
    record("note", "IOC result", { status: o["status"], filled, requested: a.qty });
    if (filled <= 0) continue;
    const stop = await api("POST", "/v2/orders", stopBody(a, filled, px), `trial ${t} POST stop sized to filled`);
    if (stop.status === 200 && filled > 1) {
      const sid = String(stop.body["id"]);
      await api("PATCH", `/v2/orders/${sid}`, { qty: String(filled - 1) }, `trial ${t} PATCH stop qty down by 1`);
      await api("PATCH", `/v2/orders/${sid}`, { qty: String(filled + 1) }, `trial ${t} PATCH stop qty above position`);
    }
    await cleanup(a);
  }
  record("note", "partial fill on a resting limit is not forced; see checklist R4", {});
}

async function limitCancelRace(a: Args): Promise<void> {
  for (let t = 1; t <= a.raceTrials; t++) {
    const px = await lastTrade(a.symbol);
    const lim = round2(px * 1.0005);
    const r = await api("POST", "/v2/orders", newOrderBody(a, { side: "buy", type: "limit", limit_price: lim }), `trial ${t} POST buy limit ${lim}`);
    if (r.status !== 200) continue;
    const id = String(r.body["id"]);
    await sleep(a.limitCancelMs);
    const c = await cancel(id);
    const o = await waitStatus(id, ["new", "accepted", "pending_new", "pending_cancel", "partially_filled"], 8000);
    record("note", "race outcome", { cancelHttp: c.status, finalStatus: o["status"], filled: o["filled_qty"], of: o["qty"] });
    await sleep(a.settleMs);
    await cleanup(a);
  }
}

async function bracketOto(a: Args): Promise<void> {
  const px = await lastTrade(a.symbol);
  const stop = round2(px * (1 - a.stopOffsetPct / 100));
  const oto = await api("POST", "/v2/orders", newOrderBody(a, { side: "buy", type: "market", order_class: "oto", stop_loss: { stop_price: stop } }), "POST OTO market buy + stop_loss");
  await sleep(a.settleMs);
  if (oto.status === 200) {
    const g = await getOrder(String(oto.body["id"]));
    const legs = (g.body["legs"] as Json[] | undefined) ?? [];
    record("note", "OTO legs", { legs: legs.map(summarizeOrder) });
    for (const leg of legs) {
      await api("PATCH", `/v2/orders/${String(leg["id"])}`, { stop_price: round2(Number(stop) + 0.1) }, "PATCH OTO stop leg");
    }
  }
  await cleanup(a);
  const br = await api("POST", "/v2/orders", newOrderBody(a, { side: "buy", type: "market", order_class: "bracket", take_profit: { limit_price: round2(px * 1.05) }, stop_loss: { stop_price: stop } }), "POST bracket market buy");
  await sleep(a.settleMs);
  if (br.status === 200) {
    await api("POST", "/v2/orders", newOrderBody(a, { side: "sell", type: "market" }), "POST market sell while bracket legs rest");
    await sleep(a.settleMs);
    await api("GET", `/v2/orders?status=all&nested=true&symbols=${a.symbol}&limit=5`, undefined, "GET recent orders nested");
  }
}

async function rejections(a: Args): Promise<void> {
  const px = await lastTrade(a.symbol);
  const dup = `p2-1-dup-${startedAt}`;
  const probes: Array<[string, Json]> = [
    ["sell stop above market, no position", { side: "sell", type: "stop", stop_price: round2(px * 1.05), time_in_force: "gtc" }],
    ["buy limit sub-penny tick", { side: "buy", type: "limit", limit_price: (px * 0.9).toFixed(4) }],
    ["buy qty 0", { side: "buy", type: "market", qty: "0" }],
    ["buy fractional qty with stop type", { side: "buy", type: "stop", qty: "1.5", stop_price: round2(px * 1.05) }],
    ["buy huge qty (buying power)", { side: "buy", type: "market", qty: "100000000" }],
    ["unknown symbol", { symbol: "ZZZZNOTREAL", side: "buy", type: "market" }],
    ["client_order_id first use", { side: "buy", type: "limit", limit_price: round2(px * 0.5), client_order_id: dup }],
    ["client_order_id duplicate", { side: "buy", type: "limit", limit_price: round2(px * 0.5), client_order_id: dup }],
    ["market order with ioc", { side: "buy", type: "market", time_in_force: "ioc" }],
    ["stop order with ioc", { side: "buy", type: "stop", stop_price: round2(px * 1.05), time_in_force: "ioc" }],
    ["extended_hours with stop", { side: "buy", type: "stop", stop_price: round2(px * 1.05), extended_hours: true }],
  ];
  for (const [name, extra] of probes) {
    await api("POST", "/v2/orders", newOrderBody(a, { qty: "1", ...extra }), `reject probe: ${name}`);
  }
  await api("PATCH", "/v2/orders/00000000-0000-0000-0000-000000000000", { stop_price: "1.00" }, "reject probe: PATCH unknown order");
  await api("DELETE", "/v2/orders/00000000-0000-0000-0000-000000000000", undefined, "reject probe: DELETE unknown order");
  // Cancel an already-filled order.
  if ((await buyMarket(a, 1)) > 0) {
    const closed = await api("GET", `/v2/orders?status=closed&symbols=${a.symbol}&limit=1`, undefined, "GET latest closed order");
    if (closed.list[0]) await cancel(String(closed.list[0]["id"]));
  }
}

const RUNNERS: Record<Scenario, (a: Args) => Promise<void>> = {
  "stop-replace": stopReplace,
  "held-sell": heldSell,
  "cancel-then-sell": cancelThenSell,
  "partial-resize": partialResize,
  "limit-cancel-race": limitCancelRace,
  "bracket-oto": bracketOto,
  rejections,
};

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  console.log("\n=== Alpaca order-behavior spike (PAPER, places orders) ===");
  console.log(`symbol=${a.symbol} qty=${a.qty} scenarios=${a.scenarios.join(",")} out=${a.out}\n`);

  if (env.alpacaTradingMode !== "paper" || !/paper-api\.alpaca\.markets/.test(BASE)) {
    console.error(`Refusing: ALPACA_TRADING_MODE="${env.alpacaTradingMode}", base URL="${BASE}". Paper only.`);
    process.exit(1);
  }
  if (!env.alpacaApiKey || !env.alpacaApiSecret) {
    console.error("Refusing: ALPACA_API_KEY / ALPACA_API_SECRET not set.");
    process.exit(1);
  }
  if (!a.confirmPaper) {
    console.log("Dry plan only. Re-run with --confirm-paper to place paper orders.");
    return;
  }

  const acct = await api("GET", "/v2/account", undefined, "GET account");
  if (acct.status !== 200) throw new Error("account check failed");
  const clock = await api("GET", "/v2/clock", undefined, "GET clock");
  if (clock.body["is_open"] !== true && !a.allowClosed) {
    console.error("Refusing: market is closed (pass --allow-closed to run anyway).");
    process.exit(1);
  }
  if ((await position(a.symbol)) !== 0) {
    console.error(`Refusing: paper account already holds ${a.symbol}; flatten it first.`);
    process.exit(1);
  }

  const ws = await openTradeStream();
  try {
    for (const s of a.scenarios) {
      currentScenario = s;
      console.log(`\n--- ${s} ---`);
      try {
        await RUNNERS[s](a);
      } catch (err) {
        record("note", "scenario threw", { error: String(err) });
      } finally {
        await cleanup(a);
      }
    }
  } finally {
    currentScenario = "teardown";
    await cleanup(a);
    ws.close();
    writeFileSync(a.out, JSON.stringify({ args: a, startedAt: new Date(startedAt).toISOString(), log }, null, 2));
    console.log(`\nWrote ${log.length} entries to ${a.out}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
