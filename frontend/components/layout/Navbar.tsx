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

const NAV_LINKS = [
  { href: "/dashboard",  label: "Dashboard"   },
  { href: "/strategies", label: "Strategies"  },
  { href: "/portfolio",  label: "Portfolio"   },
  { href: "/backtest",   label: "Backtest"    },
  { href: "/replay",     label: "Replay"      },
] as const;

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-6 dark:border-zinc-800 dark:bg-zinc-950">
      {/* Brand */}
      <Link href="/dashboard" className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
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
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
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

      {/* Status indicator — placeholder; wire to systemStore */}
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <span className="h-2 w-2 rounded-full bg-zinc-300" />
        <span>Idle</span>
      </div>
    </nav>
  );
}
