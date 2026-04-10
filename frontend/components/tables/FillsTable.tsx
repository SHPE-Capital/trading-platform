/**
 * components/tables/FillsTable.tsx
 *
 * Table displaying trade fill history.
 * Used on the Portfolio page under the fills tab.
 *
 * Inputs:  Fill[] array from order fill data.
 * Outputs: Rendered table with symbol, side, qty, price, notional, and timestamp.
 */

import type { Fill } from "../../types/portfolio";
import { formatCurrency } from "../../utils/formatting";
import { formatTimestamp } from "../../utils/dates";

interface Props {
  fills: Fill[];
}

export default function FillsTable({ fills }: Props) {
  if (fills.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
        No fills
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50">
            <Th>Symbol</Th>
            <Th>Side</Th>
            <Th align="right">Qty</Th>
            <Th align="right">Price</Th>
            <Th align="right">Notional</Th>
            <Th align="right">Commission</Th>
            <Th>Time</Th>
          </tr>
        </thead>
        <tbody>
          {fills.map((fill) => (
            <tr
              key={fill.id}
              className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40"
            >
              <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-50">{fill.symbol}</td>
              <td className={`px-4 py-3 font-medium capitalize ${fill.side === "buy" ? "text-green-600" : "text-red-600"}`}>
                {fill.side}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{fill.qty}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(fill.price)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(fill.notional)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-zinc-500">{formatCurrency(fill.commission)}</td>
              <td className="px-4 py-3 text-xs text-zinc-400">{formatTimestamp(fill.ts)}</td>
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
