/**
 * bench/paperProbe.ts
 *
 * `bench paper`: an explicitly gated, bounded Alpaca PAPER order probe. It
 * measures the real order path — orchestrator risk checks and capital
 * reservation, the Supabase order journal (fail-closed), the Alpaca REST
 * submit, and trade_updates — with a handful of tiny marketable orders that
 * alternate buy/sell so the probe ends flat.
 *
 * Gates (all must pass before any order):
 *   - --confirm-paper-orders, --symbol, --max-orders (≤ 20), --max-notional-usd (≤ 5,000)
 *   - EXECUTION_TARGET=alpaca-paper and ALPACA_TRADING_MODE≠live
 *   - paper REST and stream hosts are paper-api.alpaca.markets
 *   - the runtime's broker-account check (protected accounts, registry) passes
 *   - the account is NOT a protected shared account unless --allow-shared-account
 *   - Alpaca's clock says the market is open
 *   - every order's qty × ask ≤ --max-notional-usd
 *
 * Safety behaviour:
 *   - An ambiguous submit (no response within --order-timeout-ms) is never
 *     retried blindly: the order is looked up by client_order_id; if it still
 *     cannot be found the probe stops and reports it unresolved.
 *   - An order not filled within --update-timeout-ms is cancelled.
 *   - Cleanup flattens only the net position the probe itself created and
 *     cancels only the probe's own open orders.
 *
 * Paper fills are Alpaca's simulation: these numbers validate integration and
 * simulator behaviour, not live fill quality.
 *
 * Inputs:  Args (see above); Alpaca paper keys; Supabase (journal + account registry).
 * Outputs: Run directory with per-order observations and probe metrics.
 */

import os from "os";
import { randomUUID } from "crypto";
import { env } from "../config/env";
import { EventBus } from "../core/engine/eventBus";
import { Orchestrator } from "../core/engine/orchestrator";
import { SymbolStateManager } from "../core/state/symbolState";
import { PortfolioStateManager } from "../core/state/portfolioState";
import { OrderStateManager } from "../core/state/orderState";
import { RiskEngine } from "../core/risk/riskEngine";
import { ExecutionEngine } from "../core/execution/executionEngine";
import { JournaledExecutionSink } from "../core/execution/journaledExecution";
import { PaperExecutionSink } from "../core/execution/paperExecution";
import { AlpacaOrderExecutionAdapter, type TradeUpdateReceipt } from "../adapters/alpaca/orderExecution";
import { alpacaGet, alpacaTradingBaseUrl } from "../adapters/alpaca/rest";
import { SupabaseOrderJournal } from "../adapters/supabase/ledgerRepository";
import { findBrokerAccount, registerBrokerAccount } from "../adapters/supabase/brokerAccountRepository";
import { runBrokerPreflight } from "../core/broker/brokerPreflight";
import { AlpacaClockHours, type AlpacaClock } from "../core/market/marketHours";
import { PROTECTED_BROKER_ACCOUNTS } from "../config/protectedAccounts";
import { LatencyProbe } from "../core/telemetry/latencyProbe";
import { ResourceMonitor } from "../core/telemetry/resourceMonitor";
import { TimedExecutionSink, TimedOrderJournal, attachOrderLifecycle, errorClass } from "../core/telemetry/orderPathTiming";
import { normalizeQuote } from "../adapters/alpaca/normalizer";
import { newId } from "../utils/ids";
import { RunArtifacts, defaultArtifactsBase, newRunId } from "./artifacts";
import { buildManifest, invalidate } from "./manifest";
import { finishRun } from "./commands";
import { Args, ArgError } from "./args";
import type { IExecutionSink } from "../core/execution/IExecutionSink";
import type { Order, OrderIntent } from "../types/orders";
import type { TradingEvent } from "../types/events";
import type { MetricsFile } from "./report";

const PAPER_HOST = "paper-api.alpaca.markets";
const DATA_BASE = "https://data.alpaca.markets";

interface ProbeOrder {
  index: number;
  intentId: string;
  clientOrderId: string;
  side: "buy" | "sell";
  qty: number;
  decisionBid: number;
  decisionAsk: number;
  quoteAgeMs: number;
  submitStartNs: bigint | null;
  responseNs: bigint | null;
  headersNs: bigint | null;
  ackNs: bigint | null;
  firstFillNs: bigint | null;
  fullFillNs: bigint | null;
  terminalNs: bigint | null;
  updatesBeforeResponse: number;
  filledQty: number;
  fillNotional: number;
  status: string;
  error: string | null;
}

const ms = (a: bigint | null, b: bigint | null): number | null => (a === null || b === null ? null : Number(b - a) / 1e6);

/** Tracks submit start/response per intent for the per-order table. */
class TrackingSink implements IExecutionSink {
  constructor(private readonly inner: IExecutionSink, private readonly orders: Map<string, ProbeOrder>) {}
  async submitOrder(intent: OrderIntent): Promise<Order> {
    const o = this.orders.get(intent.id);
    if (o) o.submitStartNs = process.hrtime.bigint();
    try {
      const order = await this.inner.submitOrder(intent);
      if (o) { o.responseNs = process.hrtime.bigint(); if (o.status === "pending") o.status = "submitted"; }
      return order;
    } catch (err) {
      if (o) { o.status = "submit_failed"; o.error = `${errorClass(err)}: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`; }
      throw err;
    }
  }
  cancelOrder(id: string): Promise<void> {
    return this.inner.cancelOrder(id);
  }
}

export async function paperCommand(args: Args): Promise<string> {
  const confirm = args.bool("confirm-paper-orders");
  const symbol = args.str("symbol").toUpperCase();
  const maxOrders = args.num("max-orders", undefined, { min: 1, max: 20, integer: true });
  const maxNotional = args.num("max-notional-usd", undefined, { min: 1, max: 5_000 });
  const qty = args.num("qty", 1, { min: 1, max: 100, integer: true });
  const minIntervalMs = args.num("min-interval-ms", Math.max(6_000, env.orderCooldownMs + 1_000), { min: 2_000 });
  const orderTimeoutMs = args.num("order-timeout-ms", 15_000, { min: 2_000, max: 60_000 });
  const updateTimeoutMs = args.num("update-timeout-ms", 30_000, { min: 2_000, max: 300_000 });
  const allowShared = args.bool("allow-shared-account");
  const base = args.optStr("out") ?? defaultArtifactsBase();
  args.assertAllUsed();

  // ---------------- gates ----------------
  if (!confirm) throw new ArgError("bench paper sends real orders to an Alpaca PAPER account. Pass --confirm-paper-orders to proceed.");
  if (env.executionTarget !== "alpaca-paper") throw new ArgError(`EXECUTION_TARGET must be alpaca-paper for the paper probe (is ${env.executionTarget})`);
  if (env.alpacaTradingMode === "live") throw new ArgError("ALPACA_TRADING_MODE=live: refusing to run a benchmark against live endpoints");
  for (const [name, u] of [["ALPACA_PAPER_BASE_URL", env.alpacaPaperBaseUrl], ["ALPACA_PAPER_STREAM_URL", env.alpacaPaperStreamUrl]] as const) {
    if (new URL(u).hostname !== PAPER_HOST) throw new ArgError(`${name} must point at ${PAPER_HOST} (is ${u})`);
  }
  if (!env.alpacaApiKey || !env.alpacaApiSecret) throw new ArgError("ALPACA_API_KEY / ALPACA_API_SECRET (paper) are required");
  if (maxOrders % 2 !== 0) throw new ArgError("--max-orders must be even so buys and sells pair up and the probe ends flat");

  const tradingCreds = { key: env.alpacaApiKey, secret: env.alpacaApiSecret };
  const dataCreds = { key: env.alpacaDataKey, secret: env.alpacaDataSecret };
  const paperBase = alpacaTradingBaseUrl("paper");
  const preflight = await runBrokerPreflight({
    target: "alpaca-paper", runtimeOrigin: env.runtimeOrigin, expectedAccount: env.expectedBrokerAccount,
    hostname: os.hostname(), protectedAccounts: PROTECTED_BROKER_ACCOUNTS,
    fetchAccount: async () => {
      const a = await alpacaGet<{ account_number: string; status: string }>(paperBase, "/v2/account", tradingCreds);
      return { accountNumber: a.account_number, status: a.status };
    },
    findRegistered: findBrokerAccount, register: registerBrokerAccount,
  });
  if (!allowShared && PROTECTED_BROKER_ACCOUNTS.some((p) => p.accountNumber === preflight.brokerAccount)) {
    throw new ArgError(`${preflight.brokerAccount} is a protected shared account; use a dedicated paper account (or --allow-shared-account after review)`);
  }
  const clock = await alpacaGet<AlpacaClock>(paperBase, "/v2/clock", tradingCreds);
  if (!clock.is_open) throw new ArgError(`Market is closed (next open ${clock.next_open}); the paper probe only runs during the session`);
  const account = await alpacaGet<{ cash: string; equity: string }>(paperBase, "/v2/account", tradingCreds);
  const positionBefore = await alpacaGet<{ qty: string }>(paperBase, `/v2/positions/${symbol}`, tradingCreds)
    .then((p) => Number(p.qty))
    .catch(() => 0);

  const runId = newRunId("paper");
  const artifacts = RunArtifacts.create(runId, base);
  const manifest = await buildManifest({
    runId, command: "paper", argv: args.argv, storageDir: artifacts.dir,
    run: {
      mode: "Alpaca paper probe", feed: "REST latest quote (IEX)", symbols: [symbol], sink: "Alpaca PAPER via journaled sink",
      broker_account: preflight.brokerAccount, account_kind: preflight.kind,
      limits: { max_orders: maxOrders, max_notional_usd: maxNotional, qty, min_interval_ms: minIntervalMs, order_timeout_ms: orderTimeoutMs, update_timeout_ms: updateTimeoutMs },
      journal: "SupabaseOrderJournal (production journal, fail-closed)",
      strategy: "none — fixed alternating buy/sell market orders, TIF day",
      position_before: positionBefore, broker_orders_submitted: "yes (paper)",
    },
  });

  // ---------------- engine ----------------
  const probe = new LatencyProbe({ runId, sampleProbability: 1 });
  const orders = new Map<string, ProbeOrder>();
  const byClientId = new Map<string, ProbeOrder>();
  const bus = new EventBus();
  const onTradeUpdate = (u: TradeUpdateReceipt): void => {
    const o = u.clientOrderId ? byClientId.get(u.clientOrderId) : undefined;
    if (!o) return;
    if (o.responseNs === null) o.updatesBeforeResponse++;
    if ((u.event === "new" || u.event === "accepted") && o.ackNs === null) o.ackNs = u.rxMonoNs;
    if ((u.event === "fill" || u.event === "partial_fill") && o.firstFillNs === null) o.firstFillNs = u.rxMonoNs;
    if (u.event === "fill") o.fullFillNs = u.rxMonoNs;
    if (["fill", "canceled", "expired", "rejected"].includes(u.event)) { o.terminalNs = u.rxMonoNs; o.status = u.event; }
  };
  const onResponseHeaders = (intentId: string, ns: bigint): void => {
    const o = orders.get(intentId);
    if (o && o.headersNs === null) o.headersNs = ns;
    probe.responseHeaders(intentId, ns);
  };
  const adapter = new AlpacaOrderExecutionAdapter(bus, "paper", { onTradeUpdate, onResponseHeaders });
  const symbolState = new SymbolStateManager();
  const portfolio = new PortfolioStateManager(Number(account.cash));
  const orderState = new OrderStateManager();
  const risk = new RiskEngine();
  const clockHours = new AlpacaClockHours(() => alpacaGet<AlpacaClock>(paperBase, "/v2/clock", tradingCreds));
  await clockHours.start();
  risk.setMarketHours(clockHours);
  const riskRejections: string[] = [];
  const sink = new JournaledExecutionSink(
    new TimedExecutionSink(new TrackingSink(new PaperExecutionSink(adapter), orders), probe),
    new TimedOrderJournal(new SupabaseOrderJournal(preflight.brokerAccount, true), probe),
    (intent, err) => bus.publish({
      id: newId(), type: "RISK_REJECTED", ts: Date.now(), mode: "paper", strategyId: intent.strategyId,
      reason: err.message, failedCheck: "JOURNAL_UNAVAILABLE", rejectedIntent: intent,
    }),
  );
  const orchestrator = new Orchestrator(bus, symbolState, portfolio, orderState, risk, new ExecutionEngine(sink), "paper", { probe });
  orchestrator.start();
  attachOrderLifecycle(bus, probe);
  bus.on("RISK_REJECTED", (e) => {
    const ev = e as Extract<TradingEvent, { type: "RISK_REJECTED" }>;
    const o = orders.get(ev.rejectedIntent?.id ?? "");
    if (o) { o.status = `risk_rejected:${ev.failedCheck ?? "UNKNOWN"}`; riskRejections.push(ev.failedCheck ?? "UNKNOWN"); }
  });
  bus.on("ORDER_FILLED", (e) => {
    const ev = e as Extract<TradingEvent, { type: "ORDER_FILLED" }>;
    const o = orders.get(ev.orderId);
    if (o) { o.filledQty += ev.fill.qty; o.fillNotional += ev.fill.qty * ev.fill.price; }
  });
  bus.on("ORDER_PARTIAL_FILL", (e) => {
    const ev = e as Extract<TradingEvent, { type: "ORDER_PARTIAL_FILL" }>;
    const o = orders.get(ev.orderId);
    if (o) { o.filledQty += ev.fill.qty; o.fillNotional += ev.fill.qty * ev.fill.price; }
  });

  const monitor = new ResourceMonitor();
  monitor.start();
  const metrics: MetricsFile = {
    schema_version: 1, kind: "paper", synthetic: false, input_label: `Alpaca paper probe ${symbol}`,
    probe: null, replay_runs: [], resources: null, recorder: null, paper: null, notes: [
      "Alpaca paper fills are simulated: no queue position, market impact or latency slippage. Paper matching may use NBBO.",
      "submit_start is before DNS/TLS/client queues; 'ack' is the first trade_updates new/accepted message.",
    ],
  };
  let stopReason = "completed";
  const unresolved: string[] = [];
  const sleep = (t: number): Promise<void> => new Promise((r) => setTimeout(r, t));
  const waitFor = async (pred: () => boolean, timeout: number): Promise<boolean> => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { if (pred()) return true; await sleep(50); }
    return pred();
  };
  const lookup = async (clientOrderId: string): Promise<Record<string, unknown> | null> =>
    alpacaGet<Record<string, unknown>>(paperBase, `/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`, tradingCreds)
      .catch(() => null);
  const latestQuote = async (): Promise<{ bid: number; ask: number; t: string; raw: Record<string, unknown> }> => {
    const r = await alpacaGet<{ quote: Record<string, unknown> }>(DATA_BASE, `/v2/stocks/${symbol}/quotes/latest?feed=iex`, dataCreds);
    return { bid: Number(r.quote["bp"]), ask: Number(r.quote["ap"]), t: String(r.quote["t"]), raw: r.quote };
  };

  const sendOne = async (index: number, side: "buy" | "sell", orderQty: number): Promise<ProbeOrder | null> => {
    const q = await latestQuote();
    if (!(q.bid > 0) || !(q.ask > 0) || q.bid > q.ask) { stopReason = `unusable quote for ${symbol}`; return null; }
    if (orderQty * q.ask > maxNotional) { stopReason = `notional ${orderQty * q.ask} exceeds --max-notional-usd`; return null; }
    // The quote is published as market data so risk sees a fresh reference price.
    bus.publish({ id: newId(), type: "QUOTE_RECEIVED", ts: Date.now(), mode: "paper", payload: normalizeQuote({ S: symbol, ...q.raw } as never) });
    const intentId = newId();
    const o: ProbeOrder = {
      index, intentId, clientOrderId: intentId, side, qty: orderQty, decisionBid: q.bid, decisionAsk: q.ask,
      quoteAgeMs: Date.now() - Date.parse(q.t), submitStartNs: null, responseNs: null, headersNs: null, ackNs: null,
      firstFillNs: null, fullFillNs: null, terminalNs: null, updatesBeforeResponse: 0, filledQty: 0, fillNotional: 0,
      status: "pending", error: null,
    };
    orders.set(intentId, o);
    byClientId.set(o.clientOrderId, o);
    const intent: OrderIntent = {
      id: intentId, strategyId: "latency_probe", symbol, side, qty: orderQty, orderType: "market",
      timeInForce: "day", reason: `latency_probe:${runId}:${index}`, ts: Date.now(),
    };
    bus.publish({ id: newId(), type: "ORDER_INTENT_CREATED", ts: Date.now(), mode: "paper", strategyId: "latency_probe", payload: intent });

    // The orchestrator either rejected it synchronously or handed it to the async journal → broker path.
    if (o.status.startsWith("risk_rejected")) return o;
    const responded = await waitFor(() => o.responseNs !== null || o.status !== "pending", orderTimeoutMs);
    if (!responded) {
      o.status = "ambiguous_timeout";
      for (let attempt = 0; attempt < 5 && o.responseNs === null; attempt++) {
        const found = await lookup(o.clientOrderId);
        if (found) { o.status = `found_after_timeout:${String(found["status"])}`; break; }
        await sleep(2_000);
      }
      if (o.responseNs === null && !o.status.startsWith("found_after_timeout")) {
        unresolved.push(o.clientOrderId);
        stopReason = `unresolved submission ${o.clientOrderId}; not retried`;
        return o;
      }
    }
    // Refused before reaching the broker (risk, journal) or the broker refused the request.
    if (o.status.startsWith("risk_rejected") || o.status === "submit_failed") return o;
    const filled = await waitFor(() => o.terminalNs !== null, updateTimeoutMs);
    if (!filled) {
      const remote = await lookup(o.clientOrderId);
      if (remote && typeof remote["id"] === "string") {
        await adapter.cancelOrder(remote["id"]).catch((err) => { o.error = `cancel failed: ${String(err)}`; });
        await waitFor(() => o.terminalNs !== null, 10_000);
      }
      if (o.terminalNs === null) { o.status = "no_terminal_update"; unresolved.push(o.clientOrderId); }
    }
    return o;
  };

  try {
    await adapter.connectTradeStream();
    for (let i = 0; i < maxOrders; i++) {
      // Buy when flat, sell when long: exposure never exceeds --qty and never goes short.
      const held = [...orders.values()].reduce((s, x) => s + (x.side === "buy" ? x.filledQty : -x.filledQty), 0);
      const o = await sendOne(i, held > 0 ? "sell" : "buy", held > 0 ? held : qty);
      if (!o || unresolved.length) break;
      if (i < maxOrders - 1) await sleep(minIntervalMs);
    }

    // Cleanup: flatten only what this probe created.
    const net = [...orders.values()].reduce((s, o) => s + (o.side === "buy" ? o.filledQty : -o.filledQty), 0);
    manifest.run["probe_net_position_before_cleanup"] = net;
    if (net !== 0 && unresolved.length === 0) {
      await sleep(minIntervalMs);
      const flat = await sendOne(maxOrders, net > 0 ? "sell" : "buy", Math.abs(net));
      manifest.run["cleanup_order"] = flat ? flat.status : "not sent";
    }
    // Cancel any of the probe's own orders still open at the broker.
    const open = await alpacaGet<Array<Record<string, unknown>>>(paperBase, "/v2/orders?status=open&limit=500", tradingCreds).catch(() => []);
    const mine = open.filter((x) => byClientId.has(String(x["client_order_id"])));
    for (const x of mine) await adapter.cancelOrder(String(x["id"])).catch(() => undefined);
    manifest.run["cleanup_canceled_open_orders"] = mine.length;
  } catch (err) {
    stopReason = `error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    adapter.disconnect();
    orchestrator.stop();
    clockHours.stop();
    monitor.stop();
  }

  const positionAfter = await alpacaGet<{ qty: string }>(paperBase, `/v2/positions/${symbol}`, tradingCreds).then((p) => Number(p.qty)).catch(() => 0);
  const rows = [...orders.values()].map((o) => {
    const avg = o.filledQty > 0 ? o.fillNotional / o.filledQty : null;
    const mid = (o.decisionBid + o.decisionAsk) / 2;
    return {
      index: o.index, client_order_id: o.clientOrderId, side: o.side, qty: o.qty, status: o.status, error: o.error,
      quote_age_ms: o.quoteAgeMs, spread_bps: ((o.decisionAsk - o.decisionBid) / mid) * 10_000,
      submit_to_response_headers_ms: ms(o.submitStartNs, o.headersNs),
      submit_to_response_ms: ms(o.submitStartNs, o.responseNs), submit_to_ack_ms: ms(o.submitStartNs, o.ackNs),
      submit_to_first_fill_ms: ms(o.submitStartNs, o.firstFillNs), submit_to_full_fill_ms: ms(o.submitStartNs, o.fullFillNs),
      updates_before_response: o.updatesBeforeResponse, filled_qty: o.filledQty, avg_fill_price: avg,
      signed_slippage_vs_mid_bps: avg === null ? null : ((avg - mid) / mid) * 10_000 * (o.side === "buy" ? 1 : -1),
    };
  });
  artifacts.writeCsv("paper-orders.csv", rows);
  metrics.paper = {
    stop_reason: stopReason,
    orders_attempted: rows.length,
    filled: rows.filter((r) => r.status === "fill").length,
    canceled: rows.filter((r) => r.status === "canceled").length,
    rejected: rows.filter((r) => r.status === "rejected").length,
    risk_rejected: riskRejections,
    submit_failed: rows.filter((r) => r.status === "submit_failed").length,
    unresolved,
    updates_before_response: rows.reduce((s, r) => s + r.updates_before_response, 0),
    position_before: positionBefore,
    position_after: positionAfter,
    position_change: positionAfter - positionBefore,
    note: "Fill-latency figures exclude unfilled orders; see paper-orders.csv for every order and its terminal state.",
  };
  if (unresolved.length) invalidate(manifest, `unresolved orders at cutoff: ${unresolved.join(", ")}`);
  if (positionAfter - positionBefore !== 0) invalidate(manifest, `position changed by ${positionAfter - positionBefore} during the probe`);
  manifest.run["stop_reason"] = stopReason;
  manifest.run["probe_run_tag"] = randomUUID();
  finishRun(artifacts, manifest, metrics, probe, monitor);
  console.log(`[bench paper] ${stopReason}; ${rows.length} order(s); position change ${positionAfter - positionBefore}`);
  return artifacts.dir;
}
