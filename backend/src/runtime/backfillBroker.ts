/**
 * runtime/backfillBroker.ts
 *
 * Copies an Alpaca account's entire history into the ledger, then attributes
 * the orders that predate run-tagged client order ids to recreated runs
 * (core/ledger/backfillPlan.ts). Reads Alpaca only — it never sends or cancels
 * an order.
 *
 *   npm run broker:backfill -- --dry-run          # prints the plan, writes nothing
 *   npm run broker:backfill                       # local database
 *   npm run broker:backfill -- --confirm-hosted   # any non-local SUPABASE_URL
 *   [--since 2026-04-12]                          # default: the account's creation
 *
 * Uses ALPACA_API_KEY/SECRET (read-only calls) and SUPABASE_URL. Safe to re-run:
 * every write is keyed on broker ids, and recreated runs are found by their
 * backfill key rather than created again.
 */

import { env } from "../config/env";
import { PROTECTED_BROKER_ACCOUNTS } from "../config/protectedAccounts";
import { STRATEGY_DEFINITIONS } from "../config/strategyDefaults";
import { alpacaGet, alpacaTradingBaseUrl } from "../adapters/alpaca/rest";
import { AlpacaBroker } from "../adapters/alpaca/alpacaBroker";
import { getSupabaseClient } from "../adapters/supabase/client";
import { findBrokerAccount, registerBrokerAccount } from "../adapters/supabase/brokerAccountRepository";
import { SupabaseLedgerStore } from "../adapters/supabase/ledgerRepository";
import { BrokerSyncService, type LedgerFillRow, type LedgerOrderRow, type LedgerStore } from "../core/ledger/brokerSync";
import { planBackfill, type PlannedRun } from "../core/ledger/backfillPlan";
import { computeDrift, checkDrift } from "../core/ledger/driftCheck";
import { positionsFromFills } from "../core/ledger/positions";
import { newId } from "../utils/ids";

const IN_CHUNK = 150;

/** Passes reads through and records every write; in a dry run, writes go nowhere. */
class CapturingStore implements LedgerStore {
  readonly orders = new Map<string, LedgerOrderRow>();
  readonly fills = new Map<string, LedgerFillRow>();
  feeCount = 0;

  constructor(private readonly inner: SupabaseLedgerStore, private readonly dryRun: boolean) {}

  getSyncState = (a: string) => this.inner.getSyncState(a);
  oldestOpenOrderMs = (a: string) => this.inner.oldestOpenOrderMs(a);
  findOrders = (a: string, ids: string[], b: string[]) => this.inner.findOrders(a, ids, b);
  strategyIdsForRuns = (ids: string[]) => this.inner.strategyIdsForRuns(ids);

  async saveSyncState(...args: Parameters<LedgerStore["saveSyncState"]>): Promise<void> {
    if (!this.dryRun) await this.inner.saveSyncState(...args);
  }
  async recordSyncError(a: string, m: string): Promise<void> {
    if (!this.dryRun) await this.inner.recordSyncError(a, m);
  }
  async upsertOrders(rows: LedgerOrderRow[]): Promise<void> {
    for (const r of rows) this.orders.set(r.id, r);
    if (!this.dryRun) await this.inner.upsertOrders(rows);
  }
  async upsertFills(rows: LedgerFillRow[]): Promise<void> {
    for (const r of rows) this.fills.set(r.broker_fill_id, r);
    if (!this.dryRun) await this.inner.upsertFills(rows);
  }
  async upsertFees(...args: Parameters<LedgerStore["upsertFees"]>): Promise<void> {
    this.feeCount += args[1].length;
    if (!this.dryRun) await this.inner.upsertFees(...args);
  }
}

function parseArgs(argv: string[]) {
  const i = argv.indexOf("--since");
  return {
    dryRun: argv.includes("--dry-run"),
    confirmHosted: argv.includes("--confirm-hosted"),
    since: i >= 0 ? Date.parse(argv[i + 1]) : null,
  };
}

async function findOrCreateStrategy(planned: PlannedRun): Promise<{ id: string; created: boolean }> {
  const supabase = getSupabaseClient();
  const { template } = planned;
  const { data: found, error } = await supabase.from("strategies").select("id")
    .eq("name", template.strategyName).eq("strategy_type", template.strategyType)
    .order("created_at", { ascending: true }).limit(1);
  if (error) throw new Error(`strategy lookup failed: ${error.message}`);
  if (found && found.length > 0) return { id: found[0].id as string, created: false };
  const config = { ...STRATEGY_DEFINITIONS[template.strategyType].defaultConfig, ...template.config };
  delete (config as { id?: string }).id;
  const { data, error: insertError } = await supabase.from("strategies")
    .insert({ strategy_type: template.strategyType, name: template.strategyName, config })
    .select("id").single();
  if (insertError) throw new Error(`strategy insert failed: ${insertError.message}`);
  return { id: data.id as string, created: true };
}

async function applyPlannedRun(planned: PlannedRun, account: string, mode: "paper" | "live"): Promise<string> {
  const supabase = getSupabaseClient();
  const { template } = planned;
  const { data: existing, error } = await supabase.from("strategy_runs").select("id")
    .eq("meta->>backfillKey", template.backfillKey).limit(1);
  if (error) throw new Error(`backfill run lookup failed: ${error.message}`);

  let runId: string;
  let strategyKey: string;
  if (existing && existing.length > 0) {
    runId = existing[0].id as string;
    const { data: run } = await supabase.from("strategy_runs").select("strategy_id, config").eq("id", runId).single();
    strategyKey = ((run?.config as { id?: string } | null)?.id ?? run?.strategy_id) as string;
  } else {
    const strategy = await findOrCreateStrategy(planned);
    let versionId: string | null = null;
    if (strategy.created) {
      const { data: version, error: vErr } = await supabase.from("strategy_versions").insert({
        strategy_id: strategy.id,
        config: { ...STRATEGY_DEFINITIONS[template.strategyType].defaultConfig, ...template.config },
        change_summary: "Recorded by the broker backfill from Alpaca history",
      }).select("id").single();
      if (vErr) throw new Error(`version insert failed: ${vErr.message}`);
      versionId = version.id as string;
    }
    runId = newId();
    strategyKey = (template.config.id as string | undefined) ?? strategy.id;
    const { error: runErr } = await supabase.from("strategy_runs").insert({
      id: runId,
      strategy_id: strategy.id,
      strategy_type: template.strategyType,
      strategy_version: STRATEGY_DEFINITIONS[template.strategyType].algorithmVersion,
      config: { ...template.config, id: strategyKey },
      status: "stopped",
      execution_mode: mode,
      runtime_origin: template.runtimeOrigin,
      broker_account: account,
      started_at: new Date(planned.startedAt).toISOString(),
      stopped_at: new Date(planned.stoppedAt).toISOString(),
      version_id: versionId,
      meta: { backfillKey: template.backfillKey, backfill: true, note: template.note, displayName: template.name },
    });
    if (runErr) throw new Error(`run insert failed: ${runErr.message}`);
  }

  for (let i = 0; i < planned.orderIds.length; i += IN_CHUNK) {
    const ids = planned.orderIds.slice(i, i + IN_CHUNK);
    const { error: oErr } = await supabase.from("orders").update({ run_id: runId }).in("id", ids).is("run_id", null);
    if (oErr) throw new Error(`order attribution failed: ${oErr.message}`);
    const { error: sErr } = await supabase.from("orders").update({ strategy_id: strategyKey })
      .in("id", ids).eq("strategy_id", "unattributed");
    if (sErr) throw new Error(`order strategy fill-in failed: ${sErr.message}`);
    const { error: fErr } = await supabase.from("fills").update({ run_id: runId }).in("order_id", ids).is("run_id", null);
    if (fErr) throw new Error(`fill attribution failed: ${fErr.message}`);
  }
  return runId;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mode: "paper" | "live" = env.alpacaTradingMode === "live" ? "live" : "paper";
  const creds = { key: env.alpacaApiKey, secret: env.alpacaApiSecret };
  if (!creds.key || !creds.secret) throw new Error("ALPACA_API_KEY and ALPACA_API_SECRET are required (read-only use)");
  const local = /\/\/(localhost|127\.0\.0\.1)[:/]/.test(env.supabaseUrl);
  if (!args.dryRun && !local && !args.confirmHosted) {
    throw new Error(`SUPABASE_URL is not local (${new URL(env.supabaseUrl).host}); pass --confirm-hosted to write to it, or --dry-run`);
  }

  const baseUrl = alpacaTradingBaseUrl(mode);
  const raw = await alpacaGet<{ account_number: string; created_at: string }>(baseUrl, "/v2/account", creds);
  const account = raw.account_number;
  const since = args.since ?? Date.parse(raw.created_at);
  console.log(`\nAccount ${account} (${mode}) — history since ${new Date(since).toISOString()}`);
  console.log(`Ledger: ${new URL(env.supabaseUrl).host}${args.dryRun ? "  [DRY RUN — nothing is written]" : ""}\n`);

  if (!args.dryRun && !(await findBrokerAccount(account))) {
    const prot = PROTECTED_BROKER_ACCOUNTS.find((p) => p.accountNumber === account);
    await registerBrokerAccount({
      id: account,
      kind: mode === "live" ? "alpaca_live" : "alpaca_paper",
      allowedRuntimeOrigin: prot?.allowedRuntimeOrigin ?? env.runtimeOrigin,
      label: prot?.label ?? null,
    });
    console.log(`Registered broker account ${account} for origin "${prot?.allowedRuntimeOrigin ?? env.runtimeOrigin}"`);
  }

  const ledger = new SupabaseLedgerStore();
  const store = new CapturingStore(ledger, args.dryRun);
  const broker = new AlpacaBroker(account, baseUrl, creds);
  const result = await new BrokerSyncService(broker, store, { isPaper: mode === "paper" }).syncOnce(since);

  const orders = [...store.orders.values()];
  const byStatus: Record<string, number> = {};
  for (const o of orders) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
  console.log(`Synced ${result.orders} orders ${JSON.stringify(byStatus)}, ${result.fills} fills, ${result.fees} fees`);
  console.log(`  already attributed to a run: ${orders.filter((o) => o.run_id).length}`);

  const plan = planBackfill(orders.map((o) => ({
    id: o.id, symbol: o.symbol, strategyId: o.strategy_id, submittedAt: Date.parse(o.submitted_at), runId: o.run_id,
  })));
  console.log(`\nRuns to recreate (${plan.length}):`);
  const runOfOrder = new Map<string, string>();
  for (const p of plan) {
    const runId = args.dryRun ? `(new) ${p.template.backfillKey}` : await applyPlannedRun(p, account, mode);
    for (const id of p.orderIds) runOfOrder.set(id, runId);
    console.log(`  ${p.template.name}: ${p.orderIds.length} orders, ${p.symbols.join(",")}, `
      + `${new Date(p.startedAt).toISOString()} → ${new Date(p.stoppedAt).toISOString()}  [${runId}]`);
  }
  const stillUnattributed = orders.filter((o) => !o.run_id && !runOfOrder.has(o.id));
  console.log(`  left unattributed: ${stillUnattributed.length} ${stillUnattributed.map((o) => `${o.symbol} ${o.side} ${o.status}`).join("; ")}`);

  // Does the ledger reproduce what Alpaca holds?
  const brokerPositions = await broker.getPositions();
  const fills = [...store.fills.values()].sort((a, b) => a.ts.localeCompare(b.ts));
  const ledgerNet = positionsFromFills(fills.map((f) => ({ symbol: f.symbol, side: f.side, qty: Number(f.qty), price: Number(f.price) })));
  const symbols = new Set([...brokerPositions.map((p) => p.symbol), ...[...ledgerNet.values()].filter((p) => p.qty !== 0).map((p) => p.symbol)]);
  const mismatched = [...symbols].filter((s) =>
    Math.abs((brokerPositions.find((p) => p.symbol === s)?.qty ?? 0) - (ledgerNet.get(s)?.qty ?? 0)) > 1e-6);
  console.log(`\nAlpaca positions: ${brokerPositions.map((p) => `${p.symbol} ${p.qty}`).join(", ") || "none"}`);
  console.log(mismatched.length === 0
    ? "Ledger fills reproduce every Alpaca position."
    : `Ledger does NOT reproduce: ${mismatched.join(", ")} — some fills are missing from the sync window.`);

  const drift = args.dryRun
    ? computeDrift(
      brokerPositions,
      fills.map((f) => ({ symbol: f.symbol, qty: f.side === "buy" ? Number(f.qty) : -Number(f.qty), runId: f.run_id ?? runOfOrder.get(f.order_id) ?? null })),
      new Set(),
    )
    : await checkDrift(account, brokerPositions, ledger);
  console.log("\nDrift (positions not held by a running run):");
  for (const r of drift) {
    console.log(`  ${r.symbol}: broker ${r.brokerQty}, stopped runs ${r.stoppedQty}, unattributed ${r.unattributedQty}`);
  }
  if (drift.length === 0) console.log("  none");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`broker:backfill failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
