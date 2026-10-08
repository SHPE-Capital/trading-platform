/**
 * core/analytics/runPerformance.ts
 *
 * Builds run stats and performance reports from what a run actually did: its
 * fills, orders, signals and rejections in the ledger, plus its sampled book
 * where one exists. Pure — the repository loads the inputs.
 *
 * A strategy's lifetime report chains its runs by dollar PnL: each run's curve
 * continues from where the previous one ended, so runs that were given
 * different capital still add up. Returns are over the largest capital base
 * any of them had.
 */

import { buildTradeLedger, tradeStats, type LedgerFill, type RoundTrip } from "./tradeLedger";
import { computeAnalytics } from "../backtest/performanceAnalytics";
import type {
  EquityCurvePoint, LiveMetrics, OpenPosition, PerformanceReport, RunSummary, SignalFunnel,
  SlippageSummary, StrategyRunStats, SymbolBreakdown,
} from "../../types/analytics";

export interface RunFill extends LedgerFill {
  orderId: string;
}

export interface RunOrderRow {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  status: string;
  decisionPrice: number | null;
}

export interface RunSnapshotRow {
  ts: number;
  realizedPnl: number;
  unrealizedPnl: number;
  grossExposure?: number;
  netExposure?: number;
}

export interface RunLedger {
  runId: string;
  name: string;
  strategyType: string;
  status: string;
  startedAt: number | null;
  stoppedAt: number | null;
  capitalBase: number;
  fills: RunFill[];
  orders: RunOrderRow[];
  signalOutcomes: Record<string, number>;
  rejectionsByCheck: Record<string, number>;
  snapshots: RunSnapshotRow[];
}

const TRADES_IN_REPORT = 500;

/**
 * Capital set aside for a run when it starts: its budget's share of the book's
 * equity (the whole book when it has no budget). The denominator of its returns.
 */
export function allocatedCapital(config: { riskBudget?: { maxCapitalPct?: number } } | undefined, equity: number | undefined): number | null {
  if (!equity || !(equity > 0)) return null;
  const pct = config?.riskBudget?.maxCapitalPct;
  return equity * (pct && pct > 0 ? Math.min(pct, 1) : 1);
}

// ------------------------------------------------------------------
// Positions and stats
// ------------------------------------------------------------------

/** Open positions from FIFO open lots, marked at `marks` (else the last fill price). */
export function openPositions(fills: LedgerFill[], marks: Map<string, number>): OpenPosition[] {
  const { openLots } = buildTradeLedger(fills);
  const last = new Map<string, number>();
  for (const f of fills) last.set(f.symbol, f.price);
  const bySymbol = new Map<string, { qty: number; cost: number }>();
  for (const lot of openLots) {
    const signed = lot.direction === "long" ? lot.qty : -lot.qty;
    const p = bySymbol.get(lot.symbol) ?? { qty: 0, cost: 0 };
    p.qty += signed;
    p.cost += signed * lot.price;
    bySymbol.set(lot.symbol, p);
  }
  const out: OpenPosition[] = [];
  for (const [symbol, p] of bySymbol) {
    if (Math.abs(p.qty) < 1e-9) continue;
    const avgPrice = p.cost / p.qty;
    const markPrice = marks.get(symbol) ?? last.get(symbol) ?? avgPrice;
    out.push({ symbol, qty: p.qty, avgPrice, markPrice, unrealizedPnl: (markPrice - avgPrice) * p.qty || 0 });
  }
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function computeRunStats(ledger: RunLedger, marks: Map<string, number>, now: number): StrategyRunStats {
  const { trades } = buildTradeLedger(ledger.fills);
  const positions = openPositions(ledger.fills, marks);
  const filledOrderIds = new Set(ledger.fills.map((f) => f.orderId));
  return {
    runId: ledger.runId,
    signals: Object.values(ledger.signalOutcomes).reduce((a, b) => a + b, 0),
    orders: ledger.orders.length,
    filledOrders: ledger.orders.filter((o) => filledOrderIds.has(o.id)).length,
    fills: ledger.fills.length,
    rejections: Object.values(ledger.rejectionsByCheck).reduce((a, b) => a + b, 0),
    closedTrades: trades.length,
    realizedPnl: trades.reduce((s, t) => s + t.pnl, 0),
    unrealizedPnl: positions.reduce((s, p) => s + p.unrealizedPnl, 0),
    fees: ledger.fills.reduce((s, f) => s + f.commission, 0),
    openPositions: positions,
    lastFillAt: ledger.fills.length > 0 ? ledger.fills[ledger.fills.length - 1].ts : null,
    updatedAt: now,
  };
}

// ------------------------------------------------------------------
// Curves
// ------------------------------------------------------------------

/**
 * The run's PnL over time: its sampled book when it has one, otherwise
 * reconstructed at each fill — the only option for runs that predate
 * snapshots. Total PnL (realized + unrealized) does not depend on the lot
 * method, so the reconstruction is just net cash flow plus open quantity marked
 * at each symbol's latest fill price.
 */
export function runPnlCurve(ledger: RunLedger, finalPnl: number, endTs: number): { ts: number; pnl: number }[] {
  const start = ledger.startedAt ?? ledger.fills[0]?.ts ?? endTs;
  const points: { ts: number; pnl: number }[] = [{ ts: start, pnl: 0 }];
  if (ledger.snapshots.length >= 2) {
    for (const s of ledger.snapshots) points.push({ ts: s.ts, pnl: s.realizedPnl + s.unrealizedPnl });
  } else {
    let cash = 0;
    let marked = 0;
    const qty = new Map<string, number>();
    const mark = new Map<string, number>();
    for (const f of ledger.fills) {
      const signed = f.side === "buy" ? f.qty : -f.qty;
      const prevQty = qty.get(f.symbol) ?? 0;
      marked -= prevQty * (mark.get(f.symbol) ?? 0);
      cash += -signed * f.price - f.commission;
      qty.set(f.symbol, prevQty + signed);
      mark.set(f.symbol, f.price);
      marked += (prevQty + signed) * f.price;
      points.push({ ts: f.ts, pnl: cash + marked });
    }
  }
  if (endTs > points[points.length - 1].ts) points.push({ ts: endTs, pnl: finalPnl });
  return points;
}

function maxDrawdown(curve: EquityCurvePoint[]): number {
  let peak = curve[0]?.equity ?? 0;
  let worst = 0;
  for (const p of curve) {
    if (p.equity > peak) peak = p.equity;
    if (peak > 0) worst = Math.max(worst, (peak - p.equity) / peak);
  }
  return worst;
}

// ------------------------------------------------------------------
// Breakdowns
// ------------------------------------------------------------------

export function slippageSummary(fills: RunFill[], orders: RunOrderRow[]): SlippageSummary {
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const samples: { symbol: string; bps: number; cost: number }[] = [];
  for (const f of fills) {
    const o = orderById.get(f.orderId);
    if (!o?.decisionPrice) continue;
    // Positive = worse for us: paid up on a buy, sold lower on a sell.
    const sign = f.side === "buy" ? 1 : -1;
    const diff = sign * (f.price - o.decisionPrice);
    samples.push({ symbol: f.symbol, bps: (diff / o.decisionPrice) * 10_000, cost: diff * f.qty });
  }
  const sorted = samples.map((s) => s.bps).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const bySymbol = new Map<string, { fills: number; bps: number; cost: number }>();
  for (const s of samples) {
    const b = bySymbol.get(s.symbol) ?? { fills: 0, bps: 0, cost: 0 };
    b.fills++;
    b.bps += s.bps;
    b.cost += s.cost;
    bySymbol.set(s.symbol, b);
  }
  return {
    measuredFills: samples.length,
    avgBps: samples.length ? samples.reduce((a, s) => a + s.bps, 0) / samples.length : 0,
    medianBps: sorted.length === 0 ? 0 : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    totalCost: samples.reduce((a, s) => a + s.cost, 0),
    bySymbol: [...bySymbol].map(([symbol, b]) => ({ symbol, fills: b.fills, avgBps: b.bps / b.fills, totalCost: b.cost }))
      .sort((a, b) => b.totalCost - a.totalCost),
  };
}

const HOLDING_BUCKETS: Array<[string, number]> = [
  ["< 1 min", 60_000], ["1–5 min", 5 * 60_000], ["5–30 min", 30 * 60_000], ["30 min–2 h", 2 * 3_600_000],
  ["2 h–1 day", 86_400_000], ["1–5 days", 5 * 86_400_000], ["> 5 days", Infinity],
];

export function holdingTimes(trades: RoundTrip[]): Array<{ bucket: string; trades: number; pnl: number }> {
  const out = HOLDING_BUCKETS.map(([bucket]) => ({ bucket, trades: 0, pnl: 0 }));
  for (const t of trades) {
    const i = HOLDING_BUCKETS.findIndex(([, max]) => t.holdingMs < max);
    out[i].trades++;
    out[i].pnl += t.pnl;
  }
  return out;
}

function symbolBreakdown(trades: RoundTrip[], positions: OpenPosition[]): SymbolBreakdown[] {
  const rows = new Map<string, SymbolBreakdown & { wins: number }>();
  const row = (symbol: string) => {
    let r = rows.get(symbol);
    if (!r) rows.set(symbol, (r = { symbol, realizedPnl: 0, unrealizedPnl: 0, trades: 0, winRate: 0, wins: 0 }));
    return r;
  };
  for (const t of trades) {
    const r = row(t.symbol);
    r.realizedPnl += t.pnl;
    r.trades++;
    if (t.pnl > 0) r.wins++;
  }
  for (const p of positions) row(p.symbol).unrealizedPnl += p.unrealizedPnl;
  return [...rows.values()]
    .map(({ wins, ...r }) => ({ ...r, winRate: r.trades ? wins / r.trades : 0 }))
    .sort((a, b) => (b.realizedPnl + b.unrealizedPnl) - (a.realizedPnl + a.unrealizedPnl));
}

function funnelOf(ledgers: RunLedger[]): SignalFunnel {
  const f: SignalFunnel = {
    signals: 0, submitted: 0, riskRejected: 0, capitalUnavailable: 0, noOrder: 0,
    orders: 0, filledOrders: 0, canceledOrders: 0, rejectedOrders: 0, fills: 0,
  };
  for (const l of ledgers) {
    const o = l.signalOutcomes;
    f.submitted += o.submitted ?? 0;
    f.riskRejected += o.risk_rejected ?? 0;
    f.capitalUnavailable += o.capital_unavailable ?? 0;
    f.noOrder += (o.pending ?? 0) + (o.dropped ?? 0);
    f.signals += Object.values(o).reduce((a, b) => a + b, 0);
    const filled = new Set(l.fills.map((x) => x.orderId));
    f.orders += l.orders.length;
    f.filledOrders += l.orders.filter((x) => filled.has(x.id)).length;
    f.canceledOrders += l.orders.filter((x) => x.status === "canceled" || x.status === "expired").length;
    f.rejectedOrders += l.orders.filter((x) => x.status === "rejected").length;
    f.fills += l.fills.length;
  }
  return f;
}

// ------------------------------------------------------------------
// Reports
// ------------------------------------------------------------------

export interface ReportOptions {
  marks: Map<string, number>;
  now: number;
  benchmarkCurve?: { ts: number; value: number }[];
}

function buildReport(
  scope: PerformanceReport["scope"],
  id: string,
  name: string,
  strategyType: string,
  ledgers: RunLedger[],
  opts: ReportOptions,
): PerformanceReport {
  const capitalBase = Math.max(1, ...ledgers.map((l) => l.capitalBase));
  const allFills = ledgers.flatMap((l) => l.fills);
  const allOrders = ledgers.flatMap((l) => l.orders);

  // Each run's trades and positions come from its own fills — runs never net
  // against each other, even on the same symbol.
  const trades: RoundTrip[] = [];
  const positions: OpenPosition[] = [];
  const curve: EquityCurvePoint[] = [];
  let carried = 0;
  for (const l of ledgers) {
    const runTrades = buildTradeLedger(l.fills).trades;
    const runPositions = openPositions(l.fills, opts.marks);
    trades.push(...runTrades);
    positions.push(...runPositions);
    const finalPnl = runTrades.reduce((s, t) => s + t.pnl, 0) + runPositions.reduce((s, p) => s + p.unrealizedPnl, 0);
    const end = l.status === "running" ? opts.now : (l.stoppedAt ?? l.fills[l.fills.length - 1]?.ts ?? opts.now);
    for (const p of runPnlCurve(l, finalPnl, end)) {
      curve.push({ ts: p.ts, pnl: carried + p.pnl, equity: capitalBase + carried + p.pnl, runId: l.runId });
    }
    carried += finalPnl;
  }
  curve.sort((a, b) => a.ts - b.ts);

  const pnls = trades.map((t) => t.pnl);
  const realizedPnl = pnls.reduce((a, b) => a + b, 0);
  const unrealizedPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
  const periodStart = curve[0]?.ts ?? opts.now;
  const periodEnd = curve[curve.length - 1]?.ts ?? opts.now;
  const analytics = computeAnalytics(curve, pnls, periodStart, periodEnd, 0, opts.benchmarkCurve);
  const stats = tradeStats(pnls);

  const metrics: LiveMetrics = {
    totalReturn: realizedPnl + unrealizedPnl,
    totalReturnPct: (realizedPnl + unrealizedPnl) / capitalBase,
    maxDrawdown: maxDrawdown(curve),
    winRate: stats.winRate,
    totalTrades: stats.totalTrades,
    avgWin: stats.avgWin,
    avgLoss: stats.avgLoss,
    // Runs shorter than a few trading days have too few daily returns for the
    // daily ratios; fall back to the per-observation ones.
    sharpeRatio: analytics.sharpeRatio ?? analytics.intradaySharpeRatio,
    sortinoRatio: analytics.sortinoRatio ?? analytics.intradaySortinoRatio,
    calmarRatio: analytics.calmarRatio,
    profitFactor: analytics.profitFactor,
    annualizedReturn: analytics.annualizedReturn,
    benchmarkReturn: analytics.benchmarkReturn,
    realizedPnl,
    unrealizedPnl,
    fees: allFills.reduce((s, f) => s + f.commission, 0),
  };

  const rejections = new Map<string, number>();
  for (const l of ledgers) for (const [k, v] of Object.entries(l.rejectionsByCheck)) rejections.set(k, (rejections.get(k) ?? 0) + v);

  return {
    scope,
    id,
    name,
    strategyType,
    capitalBase,
    periodStart,
    periodEnd,
    metrics,
    equityCurve: curve,
    trades: trades.sort((a, b) => a.exitTs - b.exitTs).slice(-TRADES_IN_REPORT),
    bySymbol: symbolBreakdown(trades, positions),
    openPositions: positions,
    funnel: funnelOf(ledgers),
    rejectionsByCheck: [...rejections].map(([check, count]) => ({ check, count })).sort((a, b) => b.count - a.count),
    slippage: slippageSummary(allFills, allOrders),
    holdingTimes: holdingTimes(trades),
    exposureCurve: ledgers
      .flatMap((l) => l.snapshots)
      .filter((s) => s.grossExposure !== undefined)
      .sort((a, b) => a.ts - b.ts)
      .map((s) => ({ ts: s.ts, gross: s.grossExposure!, net: s.netExposure ?? 0 })),
  };
}

export function buildRunReport(ledger: RunLedger, opts: ReportOptions): PerformanceReport {
  return buildReport("run", ledger.runId, ledger.name, ledger.strategyType, [ledger], opts);
}

export function buildStrategyReport(
  strategyId: string,
  name: string,
  strategyType: string,
  ledgers: RunLedger[],
  summaries: Omit<RunSummary, "pnl" | "trades" | "orders" | "signals">[],
  opts: ReportOptions,
): PerformanceReport {
  const ordered = [...ledgers].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  const report = buildReport("strategy", strategyId, name, strategyType, ordered, opts);
  const byRun = new Map(ordered.map((l) => [l.runId, l]));
  report.runs = summaries.map((s) => {
    const l = byRun.get(s.runId);
    const st = l ? computeRunStats(l, opts.marks, opts.now) : null;
    return {
      ...s,
      pnl: st ? st.realizedPnl + st.unrealizedPnl : 0,
      trades: st?.closedTrades ?? 0,
      orders: st?.orders ?? 0,
      signals: st?.signals ?? 0,
    };
  });
  return report;
}
