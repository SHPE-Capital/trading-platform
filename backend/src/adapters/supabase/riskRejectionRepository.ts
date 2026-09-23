/**
 * adapters/supabase/riskRejectionRepository.ts
 *
 * Persisted order rejections from the live book (Part 06, table from 0005) and
 * the contention aggregates built on them. Direct P&L never shows opportunity
 * cost — a strategy blocked by capital another strategy reserved just looks
 * unlucky. Counting the blocks per member turns that into a number.
 */

import { getSupabaseClient } from "./client";
import type { UUID } from "../../types/common";

export interface RiskRejectionRow {
  ts: string;
  strategy_id: string | null;
  owner_id: UUID | null;
  symbol: string | null;
  failed_check: string;
  reason: string | null;
  intent: unknown;
}

export async function insertRiskRejections(rows: RiskRejectionRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await getSupabaseClient().from("risk_rejections").insert(rows);
  if (error) throw new Error(`insertRiskRejections failed: ${error.message}`);
}

/**
 * The member accountable for a strategy's live run: the run's owner (set at
 * approval), falling back to the strategy config's owner. Null when neither is
 * known — e.g. a run started before identity existed.
 */
export async function resolveStrategyOwner(strategyId: string): Promise<UUID | null> {
  const supabase = getSupabaseClient();
  const { data: run } = await supabase
    .from("strategy_runs")
    .select("owner_id")
    .eq("strategy_id", strategyId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (run?.owner_id) return run.owner_id as UUID;

  const { data: strategy } = await supabase
    .from("strategies")
    .select("owner_id")
    .eq("id", strategyId)
    .maybeSingle();
  return (strategy?.owner_id as UUID | null | undefined) ?? null;
}

export interface ContentionRow {
  ownerId: UUID | null;
  ownerName: string | null;
  strategyId: string | null;
  strategyName: string | null;
  failedCheck: string;
  rejections: number;
  lastAt: number;
}

/**
 * Rejection counts over the last `days`, grouped by member, strategy, and check.
 * Aggregated here rather than in SQL because the window is small (days, not
 * the table's lifetime) and the names come from two other tables.
 */
export async function getContentionSummary(days: number): Promise<ContentionRow[]> {
  const supabase = getSupabaseClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const counts = new Map<string, ContentionRow>();
  const PAGE = 1_000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("risk_rejections")
      .select("ts, owner_id, strategy_id, failed_check")
      .gte("ts", since)
      .order("ts", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`getContentionSummary failed: ${error.message}`);
    for (const r of data ?? []) {
      const key = `${r.owner_id ?? ""}|${r.strategy_id ?? ""}|${r.failed_check}`;
      const ts = new Date(r.ts as string).getTime();
      const row = counts.get(key);
      if (row) {
        row.rejections++;
        row.lastAt = Math.max(row.lastAt, ts);
      } else {
        counts.set(key, {
          ownerId: (r.owner_id as UUID | null) ?? null,
          ownerName: null,
          strategyId: (r.strategy_id as string | null) ?? null,
          strategyName: null,
          failedCheck: r.failed_check as string,
          rejections: 1,
          lastAt: ts,
        });
      }
    }
    if (!data || data.length < PAGE) break;
  }

  const rows = [...counts.values()];
  const ownerIds = [...new Set(rows.map((r) => r.ownerId).filter((v): v is string => !!v))];
  const strategyIds = [...new Set(rows.map((r) => r.strategyId).filter((v): v is string => !!v))];

  const [owners, strategies] = await Promise.all([
    ownerIds.length > 0
      ? supabase.from("app_users").select("id, display_name, email").in("id", ownerIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    strategyIds.length > 0
      ? supabase.from("strategies").select("id, name").in("id", strategyIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const ownerName = new Map(
    (owners.data ?? []).map((u) => [u.id as string, ((u.display_name ?? u.email) as string) ?? null]),
  );
  const strategyName = new Map((strategies.data ?? []).map((s) => [s.id as string, s.name as string]));

  for (const r of rows) {
    r.ownerName = r.ownerId ? ownerName.get(r.ownerId) ?? null : null;
    r.strategyName = r.strategyId ? strategyName.get(r.strategyId) ?? null : null;
  }
  return rows.sort((a, b) => b.rejections - a.rejections);
}
