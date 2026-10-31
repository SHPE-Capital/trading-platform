/**
 * components/layout/Navbar.tsx
 *
 * Top navigation bar. Displays the app name, current page links, and
 * a system health indicator showing whether the engine is connected.
 *
 * Inputs:  N/A — reads system status from the systemStore context.
 * Outputs: Rendered navigation bar with links and status badge.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { config } from "../../config";
import { useSystemHealthData } from "../../context/DataContext";
import { useAuth } from "../../context/AuthContext";
import { describeFills, describeMarketData, type DataTone } from "../../utils/marketData";

const TONE_CLASSES: Record<DataTone, string> = {
  ok:      "border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300",
  neutral: "border-zinc-300 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
  warn:    "border-yellow-300 bg-yellow-50 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
  error:   "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
};

const NAV_LINKS = [
  { href: "/dashboard",  label: "Dashboard"   },
  { href: "/strategies", label: "Strategies"  },
  { href: "/portfolio",  label: "Portfolio"   },
  { href: "/approvals",  label: "Approvals"   },
  { href: "/contention", label: "Contention"  },
  { href: "/backtest",   label: "Backtest"    },
  { href: "/replay",     label: "Replay"      },
] as const;

export default function Navbar() {
  const pathname = usePathname();
  const { status, isLoading } = useSystemHealthData();
  const { user, signOut, isConfigured } = useAuth();

  const dotColor =
    isLoading || !status ? "bg-zinc-300" :
    status.status === "healthy"  ? "bg-green-500" :
    status.status === "degraded" ? "bg-yellow-400" :
                                    "bg-red-500";
  const label =
    isLoading || !status ? "Connecting…" :
    status.status === "healthy"  ? status.mode :
    status.status === "degraded" ? "Degraded" :
                                    "Unhealthy";
  const data = describeMarketData(status?.marketData);
  const fills = describeFills(status?.execution, false);
  const fillsWithAccount = describeFills(status?.execution);

  return (
    <nav className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-6 dark:border-zinc-800 dark:bg-zinc-950">
      {/* Brand */}
      <Link href="/dashboard" className="shrink-0 whitespace-nowrap text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {config.appName}
      </Link>

      {/* Nav links */}
      <ul className="flex gap-1">
        {NAV_LINKS.map(({ href, label }) => {
          const isActive = pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                className={[
                  "whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors 2xl:px-3",
                  isActive
                    ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50",
                ].join(" ")}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* System health + account. Below 2xl the fills target and the user's name
          move into tooltips so the bar stays on one line at 1280px. */}
      <div className="flex shrink-0 items-center gap-3 whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400 2xl:gap-4">
        {data && (
          <div className="flex items-center gap-2 whitespace-nowrap" title={fillsWithAccount ? `${data.title} ${fillsWithAccount}.` : data.title}>
            <span
              data-testid="market-data-badge"
              className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TONE_CLASSES[data.tone]}`}
            >
              {data.label}
            </span>
            {fills && <span className="hidden 2xl:inline">{fills}</span>}
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${dotColor}`} />
          <span className="capitalize">{label}</span>
        </div>

        {isConfigured && (
          user ? (
            <div className="flex items-center gap-2" title={user.displayName ?? user.email}>
              <span className="hidden text-zinc-600 dark:text-zinc-300 2xl:inline">
                {user.displayName ?? user.email}
              </span>
              {user.role === "lead" && (
                <span className="rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] uppercase tracking-wide dark:border-zinc-600">
                  lead
                </span>
              )}
              <button
                onClick={() => void signOut()}
                className="text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link href="/login" className="font-medium text-zinc-700 hover:underline dark:text-zinc-300">
              Sign in
            </Link>
          )
        )}
      </div>
    </nav>
  );
}
