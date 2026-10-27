/**
 * utils/marketData.ts
 *
 * Plain-language labels for where the trading runtime's data comes from and
 * where its orders fill, shown in the navbar and on run pages.
 */

import type { ExecutionInfo, MarketDataState, MarketDataStatus } from "../types/api";

export type DataTone = "ok" | "neutral" | "warn" | "error";

export interface DataBadge {
  label: string;
  tone: DataTone;
  /** Tooltip: the backend's explanation, plus the IEX caveat on the free feed. */
  title: string;
}

const IEX_NOTE =
  "Free Alpaca keys stream IEX only, a few percent of market volume. Backtests use the full SIP feed, " +
  "so paper and backtest results will differ somewhat.";

const STATES: Record<MarketDataState, { label: (feed: string) => string; tone: DataTone }> = {
  live:          { label: (feed) => `Live · ${feed}`, tone: "ok" },
  idle:          { label: (feed) => `Idle · ${feed}`, tone: "neutral" },
  market_closed: { label: () => "Market closed",      tone: "neutral" },
  stale:         { label: () => "Stale data",         tone: "warn" },
  disconnected:  { label: () => "Disconnected",       tone: "error" },
  no_data:       { label: () => "No data",            tone: "error" },
};

export function describeMarketData(status: MarketDataStatus | null | undefined): DataBadge | null {
  if (!status) return null;
  const spec = STATES[status.state] ?? STATES.no_data;
  const feed = (status.feed ?? "").toUpperCase();
  const title = status.feed === "iex" ? `${status.message} ${IEX_NOTE}` : status.message;
  return { label: spec.label(feed), tone: spec.tone, title };
}

/** `withAccount: false` drops the account number, for tight spaces like the navbar. */
export function describeFills(execution: ExecutionInfo | undefined, withAccount = true): string | null {
  if (!execution?.target) return null;
  if (execution.target === "sim") return "Fills: simulator";
  const account = withAccount && execution.brokerAccount ? ` (${execution.brokerAccount})` : "";
  if (execution.target === "alpaca-paper") return `Fills: Alpaca paper${account}`;
  if (execution.target === "alpaca-live") return `Fills: Alpaca LIVE${account}`;
  return `Fills: ${execution.target}${account}`;
}

/** A run's recorded data source, or null for runs started before it was recorded. */
export function runDataLabel(meta: Record<string, unknown> | undefined): string | null {
  const data = meta?.marketData as { source?: string; feed?: string | null } | undefined;
  if (!data?.source) return null;
  if (data.source === "none") return "data: none";
  return `data: Alpaca ${(data.feed ?? "").toUpperCase()}`.trimEnd();
}
