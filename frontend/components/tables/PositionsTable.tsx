/**
 * components/tables/PositionsTable.tsx
 *
 * Table displaying current open positions with key metrics.
 * Used on the Portfolio page and Dashboard.
 *
 * Inputs:  Position[] array from the portfolio snapshot.
 * Outputs: Rendered table with symbol, qty, entry price, current price, and PnL.
 */

import type { Position } from "../../types/portfolio";
import { formatCurrency, formatPercent, pnlColorClass } from "../../utils/formatting";

interface Props {
  positions: Position[];
}

export default function PositionsTable({ positions }: Props) {
  if (positions.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
        No open positions
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50">
            <Th>Symbol</Th>
            <Th align="right">Qty</Th>
            <Th align="right">Avg Entry</Th>
            <Th align="right">Current</Th>
            <Th align="right">Market Value</Th>
            <Th align="right">Unrealized PnL</Th>
            <Th align="right">Return %</Th>
          </tr>
        </thead>
        <tbody>
          {positions.map((pos) => (
            <tr
              key={pos.id}
              className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40"
            >
              <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-50">{pos.symbol}</td>
              <td className="px-4 py-3 text-right tabular-nums">{pos.qty.toFixed(2)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(pos.avgEntryPrice)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(pos.currentPrice)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(pos.marketValue)}</td>
              <td className={`px-4 py-3 text-right tabular-nums font-medium ${pnlColorClass(pos.unrealizedPnl)}`}>
                {formatCurrency(pos.unrealizedPnl)}
              </td>
              <td className={`px-4 py-3 text-right tabular-nums ${pnlColorClass(pos.unrealizedPnlPct)}`}>
                {formatPercent(pos.unrealizedPnlPct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th className={`px-4 py-2.5 text-${align} text-xs font-semibold uppercase tracking-wider text-zinc-500`}>
      {children}
    </th>
  );
}
