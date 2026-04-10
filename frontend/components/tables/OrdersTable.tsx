/**
 * components/tables/OrdersTable.tsx
 *
 * Table displaying order history with lifecycle status.
 * Used on the Portfolio page.
 *
 * Inputs:  Order[] array from the portfolio orders endpoint.
 * Outputs: Rendered table with symbol, side, qty, price, status, and timestamp.
 */

import type { Order } from "../../types/portfolio";
import { formatCurrency } from "../../utils/formatting";
import { formatTimestamp } from "../../utils/dates";

interface Props {
  orders: Order[];
}

const STATUS_COLORS: Record<string, string> = {
  filled:       "text-green-600",
  partial_fill: "text-yellow-600",
  submitted:    "text-blue-600",
  acknowledged: "text-blue-500",
  canceled:     "text-zinc-400",
  rejected:     "text-red-600",
  expired:      "text-zinc-400",
};

export default function OrdersTable({ orders }: Props) {
  if (orders.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
        No orders
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
            <Th align="right">Filled</Th>
            <Th align="right">Avg Price</Th>
            <Th>Type</Th>
            <Th>Status</Th>
            <Th>Submitted</Th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr
              key={order.id}
              className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40"
            >
              <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-50">{order.symbol}</td>
              <td className={`px-4 py-3 font-medium capitalize ${order.side === "buy" ? "text-green-600" : "text-red-600"}`}>
                {order.side}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{order.qty}</td>
              <td className="px-4 py-3 text-right tabular-nums">{order.filledQty}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {order.avgFillPrice ? formatCurrency(order.avgFillPrice) : "—"}
              </td>
              <td className="px-4 py-3 capitalize text-zinc-500">{order.orderType}</td>
              <td className={`px-4 py-3 capitalize ${STATUS_COLORS[order.status] ?? "text-zinc-500"}`}>
                {order.status.replace("_", " ")}
              </td>
              <td className="px-4 py-3 text-xs text-zinc-400">{formatTimestamp(order.submittedAt)}</td>
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
