/**
 * components/layout/Sidebar.tsx
 *
 * Optional collapsible sidebar for secondary navigation within a section.
 * Currently used by the Strategy and Backtest pages to show a list of runs.
 *
 * Inputs:  items (title + href array), optional title.
 * Outputs: Rendered sidebar with navigable items.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface SidebarItem {
  href: string;
  label: string;
  badge?: string;
}

interface SidebarProps {
  title?: string;
  items: SidebarItem[];
}

export default function Sidebar({ title, items }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-1 border-r border-zinc-200 bg-zinc-50 px-3 py-4 dark:border-zinc-800 dark:bg-zinc-900">
      {title && (
        <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          {title}
        </p>
      )}
      <nav>
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => {
            const isActive = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={[
                    "flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-zinc-200 font-medium text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50",
                  ].join(" ")}
                >
                  <span className="truncate">{item.label}</span>
                  {item.badge && (
                    <span className="ml-1 rounded-full bg-zinc-200 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                      {item.badge}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
