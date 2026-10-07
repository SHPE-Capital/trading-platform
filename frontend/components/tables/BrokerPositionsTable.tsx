/**
 * components/tables/BrokerPositionsTable.tsx
 *
 * The broker's open positions, flagging any share count no running run
 * accounts for.
 *
 * Inputs:  BrokerPosition[], DriftRow[].
 */

import type { BrokerPosition, DriftRow } from "../../types/analytics";
import { formatCurrency, pnlColorClass } from "../../utils/formatting";

const th = "px-3 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500";
const td = "px-3 py-2 tabular-nums";

export default function BrokerPositionsTable({ positions, drift }: { positions: BrokerPosition[]; drift: DriftRow[] }) {
  if (positions.length === 0) {
    return <p className="text-sm text-zinc-400">No open positions.</p>;
  }
  const driftBySymbol = new Map(drift.map((d) => [d.symbol, d]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr>
          <th className={`${th} text-left`}>Symbol</th><th className={`${th} text-right`}>Qty</th><th className={`${th} text-right`}>Avg</th>
          <th className={`${th} text-right`}>Price</th><th className={`${th} text-right`}>Value</th><th className={`${th} text-right`}>Unrealized</th>
          <th className={`${th} text-left`}>Managed by</th>
        </tr></thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {positions.map((p) => {
            const d = driftBySymbol.get(p.symbol);
            const note = !d ? "running runs"
              : d.unattributedQty !== 0 && d.stoppedQty !== 0 ? `stopped runs (${d.stoppedQty}) + none (${d.unattributedQty})`
              : d.stoppedQty !== 0 ? `stopped runs (${d.stoppedQty})`
              : `none (${d.unattributedQty})`;
            return (
              <tr key={p.symbol} className={d ? "bg-amber-50/60 dark:bg-amber-950/20" : undefined}>
                <td className={`${td} font-medium`}>{p.symbol}</td>
                <td className={`${td} text-right`}>{p.qty}</td>
                <td className={`${td} text-right`}>{formatCurrency(p.avgEntryPrice)}</td>
                <td className={`${td} text-right`}>{formatCurrency(p.currentPrice)}</td>
                <td className={`${td} text-right`}>{formatCurrency(p.marketValue)}</td>
                <td className={`${td} text-right ${pnlColorClass(p.unrealizedPnl)}`}>{formatCurrency(p.unrealizedPnl)}</td>
                <td className={`${td} text-xs ${d ? "text-amber-700 dark:text-amber-400" : "text-zinc-400"}`}>{note}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
