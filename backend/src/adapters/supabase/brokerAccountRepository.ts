/**
 * adapters/supabase/brokerAccountRepository.ts
 *
 * Broker accounts a runtime origin has claimed (table from 0015). The startup
 * account check reads and registers them; runs and orders reference them.
 */

import { getSupabaseClient } from "./client";
import type { BrokerAccountRecord } from "../../core/broker/brokerPreflight";

export async function findBrokerAccount(id: string): Promise<BrokerAccountRecord | null> {
  const { data, error } = await getSupabaseClient()
    .from("broker_accounts")
    .select("id, kind, label, allowed_runtime_origin")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`findBrokerAccount failed: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id as string,
    kind: data.kind as BrokerAccountRecord["kind"],
    label: (data.label as string | null) ?? null,
    allowedRuntimeOrigin: data.allowed_runtime_origin as string,
  };
}

export async function registerBrokerAccount(record: BrokerAccountRecord): Promise<void> {
  const { error } = await getSupabaseClient().from("broker_accounts").insert({
    id: record.id,
    kind: record.kind,
    label: record.label ?? null,
    allowed_runtime_origin: record.allowedRuntimeOrigin,
  });
  if (error) throw new Error(`registerBrokerAccount failed: ${error.message}`);
}
