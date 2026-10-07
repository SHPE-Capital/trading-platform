/**
 * features/performance/ReportSections.tsx
 *
 * The diagnostic sections of a performance report, shared by the run page and
 * the strategy page: where signals went, what blocked them, which symbols made
 * or lost money, what is still open, how fills compared with the price the
 * strategy acted on, and how long trades were held.
 */

"use client";

import Link from "next/link";
import type {
  OpenPosition, PerformanceReport, RoundTrip, RunSummary, RunnerEvent, SignalFunnel, SlippageSummary, SymbolBreakdown,
} from "../../types/analytics";
import { formatCurrency, formatPercent, pnlColorClass } from "../../utils/formatting";
import { formatDuration, formatTimestamp } from "../../utils/dates";

export function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">{title}</h2>
      {hint && <p className="mt-1 text-xs text-zinc-400">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-zinc-400">{children}</p>;
}

const th = "px-3 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500";
const td = "px-3 py-2 tabular-nums";

// ------------------------------------------------------------------

export function SignalFunnelCard({ funnel }: { funnel: SignalFunnel }) {
  const rows: Array<[string, number, string?]> = [
    ["Signals", funnel.signals],
    ["→ sent as orders", funnel.submitted, "text-green-600"],
    ["→ blocked by a risk check", funnel.riskRejected, funnel.riskRejected ? "text-amber-600" : undefined],
    ["→ no capital available", funnel.capitalUnavailable, funnel.capitalUnavailable ? "text-amber-600" : undefined],
    ["→ never became an order", funnel.noOrder],
    ["Orders", funnel.orders],
    ["→ filled", funnel.filledOrders, "text-green-600"],
    ["→ canceled / expired", funnel.canceledOrders],
    ["→ rejected by the broker", funnel.rejectedOrders, funnel.rejectedOrders ? "text-red-600" : undefined],
  ];
  return (
    <Section title="Signal funnel" hint="Recorded from the ledger; history before signal recording shows orders only.">
      <dl className="space-y-1.5 text-sm">
        {rows.map(([label, value, cls]) => (
          <div key={label} className="flex justify-between">
            <dt className={label.startsWith("→") ? "pl-3 text-zinc-500" : "font-medium text-zinc-700 dark:text-zinc-300"}>{label}</dt>
            <dd className={`tabular-nums font-semibold ${cls ?? "text-zinc-900 dark:text-zinc-50"}`}>{value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

export function RejectionsCard({ rejections }: { rejections: PerformanceReport["rejectionsByCheck"] }) {
  return (
    <Section title="Blocked by" hint="Risk checks that stopped this run's orders.">
      {rejections.length === 0 ? <Empty>No orders were blocked.</Empty> : (
        <ul className="space-y-1.5 text-sm">
          {rejections.map((r) => (
            <li key={r.check} className="flex justify-between">
              <code className="text-xs text-zinc-600 dark:text-zinc-300">{r.check}</code>
              <span className="font-semibold tabular-nums">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function SlippageCard({ slippage }: { slippage: SlippageSummary }) {
  return (
    <Section title="Slippage" hint="Fill price against the price the strategy acted on. Positive is worse.">
      {slippage.measuredFills === 0 ? <Empty>No fills with a recorded decision price yet.</Empty> : (
        <>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-xs text-zinc-500">Average</dt><dd className="font-semibold tabular-nums">{slippage.avgBps.toFixed(1)} bps</dd></div>
            <div><dt className="text-xs text-zinc-500">Median</dt><dd className="font-semibold tabular-nums">{slippage.medianBps.toFixed(1)} bps</dd></div>
            <div><dt className="text-xs text-zinc-500">Cost</dt><dd className={`font-semibold tabular-nums ${pnlColorClass(-slippage.totalCost)}`}>{formatCurrency(-slippage.totalCost)}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-zinc-400">{slippage.measuredFills} fills measured</p>
        </>
      )}
    </Section>
  );
}

export function HoldingTimesCard({ buckets }: { buckets: PerformanceReport["holdingTimes"] }) {
  const max = Math.max(1, ...buckets.map((b) => b.trades));
  const any = buckets.some((b) => b.trades > 0);
  return (
    <Section title="Holding time" hint="Closed trades by how long the position was held.">
      {!any ? <Empty>No closed trades yet.</Empty> : (
        <ul className="space-y-1.5 text-xs">
          {buckets.filter((b) => b.trades > 0).map((b) => (
            <li key={b.bucket} className="grid grid-cols-[6rem_1fr_5rem] items-center gap-2">
              <span className="text-zinc-500">{b.bucket}</span>
              <span className="h-2 rounded bg-zinc-200 dark:bg-zinc-800">
                <span className="block h-2 rounded bg-zinc-500" style={{ width: `${(b.trades / max) * 100}%` }} />
              </span>
              <span className={`text-right tabular-nums ${pnlColorClass(b.pnl)}`}>{b.trades} · {formatCurrency(b.pnl)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function SymbolTable({ rows }: { rows: SymbolBreakdown[] }) {
  return (
    <Section title="By symbol">
      {rows.length === 0 ? <Empty>No trades yet.</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr><th className={`${th} text-left`}>Symbol</th><th className={`${th} text-right`}>Trades</th><th className={`${th} text-right`}>Win rate</th><th className={`${th} text-right`}>Realized</th><th className={`${th} text-right`}>Unrealized</th></tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map((r) => (
                <tr key={r.symbol}>
                  <td className={`${td} font-medium`}>{r.symbol}</td>
                  <td className={`${td} text-right`}>{r.trades}</td>
                  <td className={`${td} text-right`}>{r.trades ? formatPercent(r.winRate) : "—"}</td>
                  <td className={`${td} text-right ${pnlColorClass(r.realizedPnl)}`}>{formatCurrency(r.realizedPnl)}</td>
                  <td className={`${td} text-right ${pnlColorClass(r.unrealizedPnl)}`}>{formatCurrency(r.unrealizedPnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

export function OpenPositionsTable({ positions, stopped }: { positions: OpenPosition[]; stopped?: boolean }) {
  return (
    <Section
      title="Open positions"
      hint={stopped && positions.length > 0 ? "This run is stopped but still holds these — nothing is managing them." : undefined}
    >
      {positions.length === 0 ? <Empty>Flat.</Empty> : (
        <table className="w-full text-sm">
          <thead><tr><th className={`${th} text-left`}>Symbol</th><th className={`${th} text-right`}>Qty</th><th className={`${th} text-right`}>Avg</th><th className={`${th} text-right`}>Mark</th><th className={`${th} text-right`}>Unrealized</th></tr></thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {positions.map((p, i) => (
              <tr key={`${p.symbol}-${i}`} className={stopped ? "bg-amber-50/50 dark:bg-amber-950/20" : undefined}>
                <td className={`${td} font-medium`}>{p.symbol}</td>
                <td className={`${td} text-right`}>{p.qty}</td>
                <td className={`${td} text-right`}>{formatCurrency(p.avgPrice)}</td>
                <td className={`${td} text-right`}>{formatCurrency(p.markPrice)}</td>
                <td className={`${td} text-right ${pnlColorClass(p.unrealizedPnl)}`}>{formatCurrency(p.unrealizedPnl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

export function TradesTable({ trades }: { trades: RoundTrip[] }) {
  const recent = [...trades].reverse().slice(0, 100);
  return (
    <Section title="Closed trades" hint={trades.length > 100 ? `Latest 100 of ${trades.length}` : undefined}>
      {recent.length === 0 ? <Empty>No closed trades yet.</Empty> : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white dark:bg-zinc-900"><tr>
              <th className={`${th} text-left`}>Closed</th><th className={`${th} text-left`}>Symbol</th><th className={`${th} text-left`}>Side</th>
              <th className={`${th} text-right`}>Qty</th><th className={`${th} text-right`}>Entry</th><th className={`${th} text-right`}>Exit</th>
              <th className={`${th} text-right`}>Held</th><th className={`${th} text-right`}>PnL</th>
            </tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {recent.map((t, i) => (
                <tr key={`${t.exitTs}-${t.symbol}-${i}`}>
                  <td className={`${td} text-xs text-zinc-400`}>{formatTimestamp(t.exitTs)}</td>
                  <td className={`${td} font-medium`}>{t.symbol}</td>
                  <td className={`${td} capitalize ${t.direction === "long" ? "text-green-600" : "text-red-600"}`}>{t.direction}</td>
                  <td className={`${td} text-right`}>{t.qty}</td>
                  <td className={`${td} text-right`}>{formatCurrency(t.entryPrice)}</td>
                  <td className={`${td} text-right`}>{formatCurrency(t.exitPrice)}</td>
                  <td className={`${td} text-right text-zinc-500`}>{formatDuration(t.holdingMs)}</td>
                  <td className={`${td} text-right ${pnlColorClass(t.pnl)}`}>{formatCurrency(t.pnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

export function RunsTable({ runs }: { runs: RunSummary[] }) {
  return (
    <Section title="Runs" hint="Every run of this strategy in the selected mode, newest first. Lifetime numbers above chain them by dollar PnL.">
      {runs.length === 0 ? <Empty>No runs match these filters.</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>
              <th className={`${th} text-left`}>Run</th><th className={`${th} text-left`}>Version</th><th className={`${th} text-left`}>Status</th>
              <th className={`${th} text-left`}>Started</th><th className={`${th} text-right`}>Signals</th><th className={`${th} text-right`}>Orders</th>
              <th className={`${th} text-right`}>Trades</th><th className={`${th} text-right`}>PnL</th>
            </tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {[...runs].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)).map((r) => (
                <tr key={r.runId}>
                  <td className={td}>
                    <Link href={`/runs/${r.runId}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">{r.name}</Link>
                    <div className="flex gap-1 text-[10px] uppercase tracking-wide text-zinc-400">
                      {r.sandbox && <span>sandbox</span>}{r.backfill && <span>backfilled</span>}<span>{r.runtimeOrigin}</span>
                    </div>
                  </td>
                  <td className={`${td} text-zinc-500`}>{r.versionNumber != null ? `v${r.versionNumber}` : "—"}</td>
                  <td className={`${td} capitalize text-zinc-500`}>{r.status}</td>
                  <td className={`${td} text-xs text-zinc-400`}>{r.startedAt ? formatTimestamp(r.startedAt) : "—"}</td>
                  <td className={`${td} text-right`}>{r.signals}</td>
                  <td className={`${td} text-right`}>{r.orders}</td>
                  <td className={`${td} text-right`}>{r.trades}</td>
                  <td className={`${td} text-right font-semibold ${pnlColorClass(r.pnl)}`}>{formatCurrency(r.pnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

const EVENT_TONE: Record<string, string> = {
  STARTED: "text-green-600", ADOPTED: "text-blue-600", LEASE_LOST: "text-amber-600", ERROR: "text-red-600",
  RECOVERED: "text-green-600", AUTO_DISABLED: "text-red-600", EXPIRED: "text-zinc-500", STOPPED: "text-zinc-500",
};

export function EventsTimeline({ events }: { events: RunnerEvent[] }) {
  return (
    <Section title="Runner events" hint="Which runner held the run, and anything that interrupted it.">
      {events.length === 0 ? <Empty>No events recorded.</Empty> : (
        <ol className="space-y-2 text-sm">
          {events.map((e, i) => (
            <li key={`${e.ts}-${i}`} className="grid grid-cols-[9rem_7rem_1fr] gap-2">
              <span className="text-xs text-zinc-400">{formatTimestamp(e.ts)}</span>
              <span className={`text-xs font-semibold ${EVENT_TONE[e.type] ?? "text-zinc-600"}`}>{e.type.replace(/_/g, " ")}</span>
              <span className="text-xs text-zinc-600 dark:text-zinc-300">{e.detail}</span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
