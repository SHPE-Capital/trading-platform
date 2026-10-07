/**
 * core/ledger/backfillPlan.ts
 *
 * Decides which unattributed broker orders belong to which recreated run, for
 * history that predates run-tagged client order ids. Pure: the backfill CLI
 * feeds it the synced orders and applies (or, in a dry run, prints) the plan.
 *
 * The club's account had two such episodes, found by auditing Alpaca against
 * the ledger on 2026-10-07:
 *
 *   - 2026-10-06/07: the minute-reversal test, run from another machine's local
 *     Docker stack against its own local database, so the hosted ledger never
 *     saw its 494 orders.
 *   - 2026-05-08/11: early SPY/QQQ pairs runs whose orders carry in-memory
 *     strategy ids that match no run row.
 */

import { DEFAULT_MINUTE_REVERSAL_SYMBOLS } from "../../strategies/minuteReversal/minuteReversalConfig";

export interface PlanOrder {
  id: string;
  symbol: string;
  strategyId: string;
  submittedAt: number;
  runId: string | null;
}

export interface RunTemplate {
  /** Stored in strategy_runs.meta.backfillKey — a re-run finds the run instead of duplicating it. */
  backfillKey: string;
  name: string;
  strategyType: "pairs_trading" | "minute_reversal";
  /** Attach to an existing saved strategy with this name, or create one. */
  strategyName: string;
  /** Config recorded on the run; `id` is the strategy id the orders carry. */
  config: Record<string, unknown>;
  runtimeOrigin: string;
  note: string;
}

export interface AttributionRule {
  /** Group key for an unattributed order this rule claims, or null. One run per group. */
  group(order: PlanOrder): string | null;
  template(groupKey: string, orders: PlanOrder[]): RunTemplate;
}

export interface PlannedRun {
  template: RunTemplate;
  orderIds: string[];
  startedAt: number;
  stoppedAt: number;
  symbols: string[];
}

const MINUTE_REVERSAL_SYMBOLS = new Set<string>(DEFAULT_MINUTE_REVERSAL_SYMBOLS);
const OCT_TEST_FROM = Date.parse("2026-10-06T00:00:00Z");
const OCT_TEST_TO = Date.parse("2026-10-08T00:00:00Z");
const MAY_FROM = Date.parse("2026-05-01T00:00:00Z");
const MAY_TO = Date.parse("2026-06-01T00:00:00Z");

export const CLUB_BACKFILL_RULES: AttributionRule[] = [
  {
    group: (o) =>
      o.submittedAt >= OCT_TEST_FROM && o.submittedAt < OCT_TEST_TO && MINUTE_REVERSAL_SYMBOLS.has(o.symbol)
        ? "minute-reversal-2026-10-06"
        : null,
    template: (key) => ({
      backfillKey: key,
      name: "Minute Reversal (Oct 6–7 local test)",
      strategyType: "minute_reversal",
      strategyName: "Minute Reversal: large caps",
      config: { name: "Minute Reversal: large caps", symbols: [...DEFAULT_MINUTE_REVERSAL_SYMBOLS] },
      runtimeOrigin: "local-docker",
      note: "Recreated from Alpaca history: run from another machine's local Docker stack, which recorded it in its own local database.",
    }),
  },
  {
    group: (o) =>
      o.submittedAt >= MAY_FROM && o.submittedAt < MAY_TO && (o.symbol === "SPY" || o.symbol === "QQQ")
        ? `pairs-spy-qqq-2026-05:${o.strategyId}`
        : null,
    template: (key, orders) => {
      const strategyId = key.slice(key.indexOf(":") + 1);
      const day = new Date(Math.min(...orders.map((o) => o.submittedAt))).toISOString().slice(0, 10);
      return {
        backfillKey: key,
        name: `Pairs: SPY/QQQ (legacy ${day})`,
        strategyType: "pairs_trading",
        strategyName: "Pairs: SPY/QQQ",
        config: {
          name: "Pairs: SPY/QQQ",
          leg1Symbol: "SPY",
          leg2Symbol: "QQQ",
          symbols: ["SPY", "QQQ"],
          ...(strategyId !== "unattributed" ? { id: strategyId } : {}),
        },
        runtimeOrigin: "legacy",
        note: "Recreated from Alpaca history: an early run whose orders carry an in-memory strategy id with no run row.",
      };
    },
  },
];

/** Groups the unattributed orders by rule; orders no rule claims are left alone. */
export function planBackfill(orders: PlanOrder[], rules: AttributionRule[] = CLUB_BACKFILL_RULES): PlannedRun[] {
  const groups = new Map<string, { rule: AttributionRule; orders: PlanOrder[] }>();
  for (const o of orders) {
    if (o.runId) continue;
    for (const rule of rules) {
      const key = rule.group(o);
      if (!key) continue;
      const g = groups.get(key) ?? { rule, orders: [] };
      g.orders.push(o);
      groups.set(key, g);
      break;
    }
  }
  return [...groups.entries()]
    .map(([key, g]) => ({
      template: g.rule.template(key, g.orders),
      orderIds: g.orders.map((o) => o.id),
      startedAt: Math.min(...g.orders.map((o) => o.submittedAt)),
      stoppedAt: Math.max(...g.orders.map((o) => o.submittedAt)),
      symbols: [...new Set(g.orders.map((o) => o.symbol))].sort(),
    }))
    .sort((a, b) => a.startedAt - b.startedAt);
}
