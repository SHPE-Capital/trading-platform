/**
 * features/momentum/MomentumLiveView.tsx
 *
 * Presentational view of the momentum live snapshot. `now` is a prop so the
 * time-left and freshness numbers are deterministic in tests.
 */

import type { MomentumLiveSnapshot } from "./types";
import { artifactAgeHours, describeConfig, haltUsage, isArtifactStale, minutesLeft, money, pct } from "./format";

const card = "rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";
const h2 = "text-sm font-semibold text-zinc-900 dark:text-zinc-50";
const muted = "text-xs text-zinc-500 dark:text-zinc-400";

export function MomentumLiveView({ snapshot, now }: { snapshot: MomentumLiveSnapshot; now: Date }) {
  const { config, universe, entries, halt, positions, orders } = snapshot;
  const stale = isArtifactStale(config, now);
  const usage = haltUsage(halt.dayPnlPct, halt.haltPct);

  return (
    <div className="flex flex-col gap-4">
      <section className={card} aria-label="Active configuration">
        <h2 className={h2}>Active weekly configuration</h2>
        {config.noDeploymentReason ? (
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
            No deployment this week: {config.noDeploymentReason}
          </p>
        ) : (
          <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{describeConfig(config)}</p>
        )}
        <p className={`mt-2 ${muted}`}>
          Config <span className="font-mono">{config.configId}</span> · active since week of {config.activationWeek} · exits after{" "}
          {config.exit.maxHoldMinutes} min, initial stop {config.exit.initialStopAtr} ATR
        </p>
        <p className={`mt-1 text-xs ${stale ? "font-medium text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"}`}>
          {stale ? "Stale artifact" : "Artifact fresh"}: {artifactAgeHours(config, now).toFixed(1)}h old (limit {config.freshnessLimitHours}h)
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <section className={card} aria-label="Entries">
          <h2 className={h2}>Entries</h2>
          <p className={`mt-2 text-sm font-medium ${entries.enabled ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
            {entries.enabled ? "Enabled" : "Disabled"}
          </p>
          {entries.reason && <p className={`mt-1 ${muted}`}>{entries.reason}</p>}
          <p className={`mt-2 ${muted}`}>
            Last bar {snapshot.lastBarAt ? new Date(snapshot.lastBarAt).toLocaleTimeString() : "—"}
          </p>
        </section>

        <section className={card} aria-label="Daily PnL">
          <h2 className={h2}>Today&apos;s PnL</h2>
          <p className="mt-2 font-mono text-sm text-zinc-900 dark:text-zinc-50">
            {money(halt.dayPnl)} ({pct(halt.dayPnlPct)})
          </p>
          <div
            role="progressbar"
            aria-label="Share of daily halt line used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(usage * 100)}
            className="mt-2 h-2 w-full rounded bg-zinc-100 dark:bg-zinc-800"
          >
            <div className={`h-2 rounded ${halt.halted ? "bg-red-600" : "bg-amber-500"}`} style={{ width: `${usage * 100}%` }} />
          </div>
          <p className={`mt-1 ${muted}`}>
            {halt.halted ? "HALTED" : "Trading"} · halt line -{pct(halt.haltPct)}
          </p>
        </section>

        <section className={card} aria-label="Universe">
          <h2 className={h2}>Universe</h2>
          <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{universe.size.toLocaleString()} stocks</p>
          <p className={`mt-1 font-mono ${muted}`}>
            {universe.sample.join(", ")}
            {universe.size > universe.sample.length ? ", …" : ""}
          </p>
        </section>
      </div>

      <section className={card} aria-label="Open positions">
        <h2 className={h2}>Open positions ({positions.length})</h2>
        {positions.length === 0 ? (
          <p className={`mt-2 ${muted}`}>No open positions.</p>
        ) : (
          <table className="mt-2 w-full text-xs">
            <thead>
              <tr className="text-left text-zinc-500 dark:text-zinc-400">
                <th className="py-1">Symbol</th><th>Qty</th><th>Entry</th><th>Last</th><th>Stop</th><th>Time left</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const left = minutesLeft(p, config.exit.maxHoldMinutes, now);
                return (
                  <tr key={p.symbol} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1 font-medium">{p.symbol}</td>
                    <td>{p.qty}</td>
                    <td>{p.entryPrice.toFixed(2)}</td>
                    <td>{p.lastPrice.toFixed(2)}</td>
                    <td>{p.stopPrice.toFixed(2)}</td>
                    <td>{left > 0 ? `${left} min` : "exit due"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className={card} aria-label="Recent orders">
        <h2 className={h2}>Recent orders</h2>
        {orders.length === 0 ? (
          <p className={`mt-2 ${muted}`}>No orders yet today.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {orders.map((o) => (
              <li key={o.id}>
                <details>
                  <summary className="cursor-pointer text-xs text-zinc-800 dark:text-zinc-200">
                    {new Date(o.at).toLocaleTimeString()} · {o.side.toUpperCase()} {o.qty} {o.symbol} · {o.status}
                  </summary>
                  <ol className="mt-1 ml-4 list-decimal text-xs text-zinc-600 dark:text-zinc-400">
                    {o.audit.map((s, i) => (
                      <li key={i}>
                        <span className="font-mono">{s.stage}</span>: {s.detail}
                      </li>
                    ))}
                  </ol>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
