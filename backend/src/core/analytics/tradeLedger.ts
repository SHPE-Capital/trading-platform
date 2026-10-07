/**
 * core/analytics/tradeLedger.ts
 *
 * Turns fills into closed trades with FIFO lot accounting, per symbol, long and
 * short. Shared by the backtest engine and the live run reports so a strategy's
 * live numbers are computed exactly the way its backtest's were.
 *
 * One RoundTrip per lot slice closed: a fill that closes parts of two lots is
 * two trades. Commissions are allocated per share to both the opening and the
 * closing slice.
 */

export interface LedgerFill {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  commission: number;
  ts: number;
}

export interface RoundTrip {
  symbol: string;
  direction: "long" | "short";
  qty: number;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  /** After allocated commission. */
  pnl: number;
  commission: number;
  holdingMs: number;
}

export interface OpenLot {
  symbol: string;
  direction: "long" | "short";
  qty: number;
  price: number;
  ts: number;
}

export interface TradeLedger {
  trades: RoundTrip[];
  openLots: OpenLot[];
  realizedBySymbol: Map<string, number>;
}

interface Lot { price: number; qty: number; commissionPerShare: number; ts: number; }

export function buildTradeLedger(fills: LedgerFill[]): TradeLedger {
  const longLots = new Map<string, Lot[]>();
  const shortLots = new Map<string, Lot[]>();
  const trades: RoundTrip[] = [];

  const consume = (
    symbol: string,
    lots: Lot[],
    closer: LedgerFill,
    closerCommissionPerShare: number,
    direction: "long" | "short",
  ): number => {
    let remaining = closer.qty;
    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0];
      const slice = Math.min(lot.qty, remaining);
      const gross = direction === "long" ? (closer.price - lot.price) * slice : (lot.price - closer.price) * slice;
      const commission = slice * lot.commissionPerShare + slice * closerCommissionPerShare;
      trades.push({
        symbol,
        direction,
        qty: slice,
        entryTs: lot.ts,
        exitTs: closer.ts,
        entryPrice: lot.price,
        exitPrice: closer.price,
        pnl: gross - commission,
        commission,
        holdingMs: closer.ts - lot.ts,
      });
      lot.qty -= slice;
      remaining -= slice;
      if (lot.qty === 0) lots.shift();
    }
    return closer.qty - remaining;
  };

  for (const fill of fills) {
    const commissionPerShare = fill.qty > 0 ? fill.commission / fill.qty : 0;
    const [closing, opening, direction] = fill.side === "buy"
      ? [shortLots, longLots, "short" as const]
      : [longLots, shortLots, "long" as const];
    const toClose = closing.get(fill.symbol) ?? [];
    const closedQty = toClose.length > 0 ? consume(fill.symbol, toClose, fill, commissionPerShare, direction) : 0;
    if (toClose.length > 0 || closedQty > 0) closing.set(fill.symbol, toClose);
    const residual = fill.qty - closedQty;
    if (residual > 0) {
      const lots = opening.get(fill.symbol) ?? [];
      lots.push({ price: fill.price, qty: residual, commissionPerShare, ts: fill.ts });
      opening.set(fill.symbol, lots);
    }
  }

  const openLots: OpenLot[] = [];
  for (const [symbol, lots] of longLots) for (const l of lots) openLots.push({ symbol, direction: "long", qty: l.qty, price: l.price, ts: l.ts });
  for (const [symbol, lots] of shortLots) for (const l of lots) openLots.push({ symbol, direction: "short", qty: l.qty, price: l.price, ts: l.ts });

  const realizedBySymbol = new Map<string, number>();
  for (const t of trades) realizedBySymbol.set(t.symbol, (realizedBySymbol.get(t.symbol) ?? 0) + t.pnl);

  return { trades, openLots, realizedBySymbol };
}

/** Win rate, average win and loss over a list of trade PnLs (a loss includes breakeven). */
export function tradeStats(pnls: number[]): { totalTrades: number; winRate: number; avgWin: number; avgLoss: number } {
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p <= 0);
  return {
    totalTrades: pnls.length,
    winRate: pnls.length > 0 ? wins.length / pnls.length : 0,
    avgWin: wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0,
    avgLoss: losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0,
  };
}
