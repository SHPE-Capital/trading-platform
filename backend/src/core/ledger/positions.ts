/**
 * core/ledger/positions.ts
 *
 * Net position and average cost per symbol from a list of fills, oldest first.
 * Average-cost accounting, matching how brokers report avg_entry_price.
 */

export interface FillLike {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  commission?: number;
}

export interface NetPosition {
  symbol: string;
  /** Signed: negative for a short. */
  qty: number;
  avgPrice: number;
  realizedPnl: number;
}

const EPS = 1e-9;

export function positionsFromFills(fills: FillLike[]): Map<string, NetPosition> {
  const out = new Map<string, NetPosition>();
  for (const f of fills) {
    const p = out.get(f.symbol) ?? { symbol: f.symbol, qty: 0, avgPrice: 0, realizedPnl: 0 };
    const signed = f.side === "buy" ? f.qty : -f.qty;
    p.realizedPnl -= f.commission ?? 0;
    if (p.qty === 0 || Math.sign(p.qty) === Math.sign(signed)) {
      // Opening or adding: blend the average.
      const total = Math.abs(p.qty) + f.qty;
      p.avgPrice = (p.avgPrice * Math.abs(p.qty) + f.price * f.qty) / total;
      p.qty += signed;
    } else {
      // Reducing, possibly flipping through flat.
      const closing = Math.min(Math.abs(p.qty), f.qty);
      p.realizedPnl += closing * (f.price - p.avgPrice) * Math.sign(p.qty);
      p.qty += signed;
      if (Math.abs(p.qty) < EPS) {
        p.qty = 0;
        p.avgPrice = 0;
      } else if (f.qty > closing) {
        p.avgPrice = f.price; // flipped: the remainder opened at this fill's price
      }
    }
    out.set(f.symbol, p);
  }
  return out;
}
