/**
 * app/contention/page.tsx
 *
 * Capital contention on the shared book. Direct P&L never shows opportunity
 * cost: a strategy blocked because another reserved the capital just looks
 * unlucky. This page counts the blocks — per member, per strategy, per check —
 * so the club can see who is being crowded out and by what.
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { useContention } from "../../hooks/useContention";
import { useAuth } from "../../context/AuthContext";
import type { ContentionRow } from "../../services/governanceService";

const WINDOWS = [7, 30, 90] as const;

/** Plain-language gloss for the checks members will actually see. */
const CHECK_LABELS: Record<string, string> = {
  CAPITAL_UNAVAILABLE: "Capital held by other orders",
  STRATEGY_BUDGET: "Hit its own capital cap",
  STRATEGY_ORDER_NOTIONAL: "Order larger than its per-order cap",
  MAX_OPEN_ORDERS: "Too many open orders",
  CASH_RESERVE: "Would dip into the cash reserve",
  ORDER_COOLDOWN: "Cooling down after a recent order",
  MAX_POSITION_SIZE: "Position size limit",
  MAX_NOTIONAL_EXPOSURE: "Club exposure limit",
  KILL_SWITCH: "Kill switch engaged",
  STALE_QUOTE: "Quote too old to price",
  NO_REFERENCE_PRICE: "No price to size against",
};

interface MemberGroup {
  key: string;
  name: string;
  total: number;
  rows: ContentionRow[];
}

function groupByMember(rows: ContentionRow[]): MemberGroup[] {
  const groups = new Map<string, MemberGroup>();
  for (const r of rows) {
    const key = r.ownerId ?? "unattributed";
    const g = groups.get(key) ?? { key, name: r.ownerName ?? "Unattributed", total: 0, rows: [] };
    g.total += r.rejections;
    g.rows.push(r);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

export default function ContentionPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [days, setDays] = useState<number>(7);
  const { rows, isLoading, error, refetch } = useContention(days);

  if (!authLoading && !user) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <Link href="/login" className="font-medium text-zinc-900 underline dark:text-zinc-50">Sign in</Link>{" "}
          to see capital contention.
        </p>
      </div>
    );
  }

  const groups = groupByMember(rows);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Contention</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Orders the live book blocked, by member and strategy — the cost that P&amp;L alone never shows.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-zinc-200 dark:border-zinc-700">
            {WINDOWS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                aria-pressed={days === d}
                className={`px-3 py-1.5 text-xs font-medium ${
                  days === d
                    ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <button
            onClick={refetch}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <p className="mt-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </p>
      )}
      {isLoading && <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>}

      {!isLoading && !error && groups.length === 0 && (
        <div className="mt-8 rounded-md border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">No blocked orders in the last {days} days</p>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-4">
        {groups.map((g) => (
          <section key={g.key} className="rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <header className="flex items-baseline justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{g.name}</h2>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {g.total.toLocaleString()} blocked order{g.total === 1 ? "" : "s"}
              </span>
            </header>
            <table className="w-full text-xs">
              <tbody>
                {g.rows.map((r) => (
                  <tr key={`${r.strategyId}-${r.failedCheck}`} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{r.strategyName ?? r.strategyId ?? "—"}</td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">
                      {CHECK_LABELS[r.failedCheck] ?? r.failedCheck}
                      <span className="ml-2 font-mono text-[10px] text-zinc-400">{r.failedCheck}</span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-zinc-900 dark:text-zinc-50">{r.rejections.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right text-zinc-400">last {new Date(r.lastAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </div>
  );
}
