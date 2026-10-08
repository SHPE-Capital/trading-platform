/**
 * components/cards/BrokerAccountCard.tsx
 *
 * The account as the broker reports it — equity, cash, the day's change, and
 * buying power — with which account and execution target the runtime trades.
 * The broker is the source of truth for these; the ledger only explains them.
 *
 * Inputs:  BrokerAccount.
 */

import type { BrokerAccount } from "../../types/analytics";
import { formatCurrency, formatPercent, pnlColorClass } from "../../utils/formatting";

const TARGET_LABEL: Record<string, string> = {
  "alpaca-paper": "Alpaca paper",
  "alpaca-live": "Alpaca live",
  sim: "Simulated book",
};

export default function BrokerAccountCard({ account }: { account: BrokerAccount }) {
  const dayChange = account.equity - account.lastEquity;
  const dayPct = account.lastEquity > 0 ? dayChange / account.lastEquity : 0;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Account</h2>
        <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {TARGET_LABEL[account.executionTarget ?? ""] ?? "Broker"} · {account.accountId}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Equity" value={formatCurrency(account.equity)} />
        <Metric label="Cash" value={formatCurrency(account.cash)} />
        <Metric label="Today" value={`${formatCurrency(dayChange)} (${formatPercent(dayPct)})`} className={pnlColorClass(dayChange)} />
        <Metric label="Buying power" value={formatCurrency(account.buyingPower)} />
      </dl>
    </div>
  );
}

function Metric({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={`mt-1 text-lg font-semibold tabular-nums ${className ?? "text-zinc-900 dark:text-zinc-50"}`}>{value}</dd>
    </div>
  );
}
