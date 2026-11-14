/**
 * strategies/momentum/shadowRun.ts
 *
 * Shadow policies (P2-8). The paper account can run only one policy live (shared
 * cash and capital reservations would let policies distort each other). The other
 * policies run here as signal-only instances: each owns a BreakoutMomentumStrategy
 * built from its own weekly artifact and decides on the same completed bars as the
 * live instance, and every entry it would have made is recorded (what, when,
 * price, hypothetical size, indicators, exit plan) so research can rebuild a
 * forward account per policy.
 *
 * Shadow instances never reach the orchestrator: no engine registration, no
 * signal emission, no order intent, no capital reservation, no broker call. This
 * file imports none of those. A shadow tracks only a hypothetical position per
 * symbol (to keep the strategy's holding / one-entry-per-session / flat-to-switch
 * rules faithful); it releases on max-hold time or the session exit time. Stop
 * and trail exits are research's job when it rebuilds the forward account.
 *
 * One data stream per account (free plan): whoever owns the stream calls
 * `onBar()` once per completed bar and it fans out to every shadow. The live
 * instance consumes the same bar through the engine as before.
 *
 * Inputs:  completed minute bars; one config per shadow policy (policy name,
 *          strategy config carrying that policy's weekly artifact).
 * Outputs: ShadowSignalRecord to a sink (in-memory log; optional adapter onto
 *          core/live/signalRecorder.ts).
 */

import { BreakoutMomentumStrategy } from "./breakoutMomentumStrategy";
import type { BreakoutMomentumConfig, EntryIntent, EntrySizer } from "./breakoutMomentumTypes";
import type { Bar } from "../../types/market";
import type { StrategySignal } from "../../types/strategy";
import type { SignalRecorder } from "../../core/live/signalRecorder";
import { newId } from "../../utils/ids";
import { logger } from "../../utils/logger";

const MIN_MS = 60_000;

const NY_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
function minuteOfDay(ts: number): number {
  const p = Object.fromEntries(NY_CLOCK.formatToParts(ts).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
}

export interface ShadowPolicyConfig {
  /** Policy name, from config (for example the research policy id). Unique, and not the live policy's. */
  policyId: string;
  /** Strategy config with this policy's weekly artifact in `weeklyConfigArtifact`. */
  strategyConfig: BreakoutMomentumConfig;
  /** Hypothetical sizing; default is the artifact's per_stock_pct x starting_cash, whole shares. */
  sizer?: EntrySizer;
}

/** One entry a shadow policy would have made. Enough to rebuild its forward account. */
export interface ShadowSignalRecord {
  /** Always true: marks the record as signal-only, never an order. */
  shadow: true;
  id: string;
  policyId: string;
  livePolicyId: string;
  runId: string;
  configId: string;
  symbol: string;
  assetId: string;
  /** Decision bar (period start, Unix ms) and session date. */
  barTs: number;
  sessionDate: string;
  /** When the shadow recorded it (the bar's end: the earliest a live order could be sent). */
  decidedAtTs: number;
  referenceClose: number;
  limitPrice: number | null;
  /** Hypothetical whole shares. */
  qty: number;
  intent: EntryIntent;
}

export interface ShadowSignalSink {
  write(record: ShadowSignalRecord): void;
}

/** In-memory log, exportable as JSON lines for the research forward accounts. */
export class ShadowSignalLog implements ShadowSignalSink {
  private readonly rows: ShadowSignalRecord[] = [];

  write(record: ShadowSignalRecord): void {
    this.rows.push(record);
  }

  records(policyId?: string): ShadowSignalRecord[] {
    return policyId === undefined ? [...this.rows] : this.rows.filter((r) => r.policyId === policyId);
  }

  /** One JSON object per line, in decision order. */
  exportJsonl(policyId?: string): string {
    return this.records(policyId).map((r) => JSON.stringify(r)).join("\n");
  }
}

/**
 * Sink that also stores each shadow record through the existing SignalRecorder
 * (no change to that file). The row gets outcome "dropped" with reason
 * "shadow_signal_only", and the payload carries `meta.shadow = true`, so live
 * diagnostics and exports can tell it from a real signal. strategy_id is the policy id.
 */
export function signalRecorderSink(
  recorder: SignalRecorder,
  runId: string | null,
  inner?: ShadowSignalSink,
): ShadowSignalSink {
  return {
    write(r) {
      inner?.write(r);
      const signal: StrategySignal = {
        id: r.id,
        strategyId: r.policyId,
        strategyType: "momentum",
        symbol: r.symbol,
        direction: "long",
        qty: r.qty,
        triggerValue: r.intent.indicators.breakoutThreshold,
        triggerLabel: "breakout_momentum_entry",
        ts: r.decidedAtTs,
        meta: { ...(r as unknown as Record<string, unknown>), shadow: true },
      };
      recorder.record(r.id, runId, r.decidedAtTs, signal);
      recorder.outcome(r.id, "dropped", "shadow_signal_only");
    },
  };
}

export interface ShadowRunConfig {
  /** The one policy that trades live (registered with the orchestrator by the caller). */
  livePolicyId: string;
  shadows: ShadowPolicyConfig[];
  sink: ShadowSignalSink;
}

interface Shadow {
  policyId: string;
  strategy: BreakoutMomentumStrategy;
  sizer: EntrySizer;
  /** Hypothetical open positions: symbol -> release time. */
  held: Map<string, number>;
}

export interface ShadowStats {
  bars: number;
  signals: number;
  /** Candidates dropped because the hypothetical size was under one share. */
  unsized: number;
  errors: number;
}

export class ShadowPolicyRunner {
  private readonly shadows: Shadow[] = [];
  private readonly stats = new Map<string, ShadowStats>();
  readonly livePolicyId: string;
  private readonly sink: ShadowSignalSink;

  constructor(config: ShadowRunConfig) {
    this.livePolicyId = config.livePolicyId;
    this.sink = config.sink;
    if (!config.livePolicyId) throw new Error("shadowRun: livePolicyId is required");
    const seen = new Set<string>([config.livePolicyId]);
    for (const p of config.shadows) {
      if (!p.policyId) throw new Error("shadowRun: every shadow needs a policyId");
      if (seen.has(p.policyId)) {
        throw new Error(`shadowRun: policy '${p.policyId}' is duplicated or is the live policy`);
      }
      seen.add(p.policyId);
      const strategy = new BreakoutMomentumStrategy(p.strategyConfig);
      this.shadows.push({
        policyId: p.policyId, strategy, held: new Map(),
        sizer: p.sizer ?? ((i) => ShadowPolicyRunner.defaultQty(strategy, i)),
      });
      this.stats.set(p.policyId, { bars: 0, signals: 0, unsized: 0, errors: 0 });
    }
  }

  get policyIds(): string[] {
    return this.shadows.map((s) => s.policyId);
  }

  statsFor(policyId: string): ShadowStats | null {
    const s = this.stats.get(policyId);
    return s ? { ...s } : null;
  }

  /** Records a newer weekly artifact for one shadow policy (null: none available). */
  submitArtifact(policyId: string, raw: unknown): void {
    const s = this.shadows.find((x) => x.policyId === policyId);
    if (!s) throw new Error(`shadowRun: unknown shadow policy '${policyId}'`);
    s.strategy.submitArtifact(raw);
  }

  /** Primes every shadow's bar history (the same bars the live instance is warmed with). */
  warmUp(bars: Bar[]): void {
    for (const s of this.shadows) {
      try {
        s.strategy.warmUp(bars);
      } catch (err) {
        this.fail(s, "warmUp", err);
      }
    }
  }

  /**
   * Fans one completed bar out to every shadow, in time order. Returns the
   * records written. A failing shadow is logged and skipped; it never affects
   * the others or the caller.
   */
  onBar(bar: Bar): ShadowSignalRecord[] {
    const out: ShadowSignalRecord[] = [];
    for (const s of this.shadows) {
      try {
        const rec = this.step(s, bar);
        if (rec) out.push(rec);
      } catch (err) {
        this.fail(s, "onBar", err);
      }
    }
    return out;
  }

  private step(s: Shadow, bar: Bar): ShadowSignalRecord | null {
    const stats = this.stats.get(s.policyId) as ShadowStats;
    stats.bars++;
    for (const [sym, releaseTs] of s.held) if (bar.ts >= releaseTs) s.held.delete(sym);

    const decision = s.strategy.decideBar(bar, s.held.has(bar.symbol) ? 1 : 0, s.held.size === 0);
    const intent = decision.intent;
    if (intent === null) return null;

    const qty = Math.floor(s.sizer(intent));
    if (!(qty >= 1)) {
      stats.unsized++;
      return null;
    }
    // Hypothetical position until max hold or the session exit time.
    const sessionExitTs = intent.barTs + (intent.exitPlan.sessionExitMinuteOfDay - minuteOfDay(intent.barTs)) * MIN_MS;
    s.held.set(bar.symbol, Math.min(intent.barTs + intent.exitPlan.maxHoldMinutes * MIN_MS, sessionExitTs));
    s.strategy.markEntrySubmitted(bar.symbol, bar.ts);

    const record: ShadowSignalRecord = {
      shadow: true,
      id: newId(),
      policyId: s.policyId,
      livePolicyId: this.livePolicyId,
      runId: intent.runId,
      configId: intent.configId,
      symbol: intent.symbol,
      assetId: intent.assetId,
      barTs: intent.barTs,
      sessionDate: intent.sessionDate,
      decidedAtTs: bar.ts + MIN_MS,
      referenceClose: intent.referenceClose,
      limitPrice: intent.limitPrice,
      qty,
      intent,
    };
    this.sink.write(record);
    stats.signals++;
    return record;
  }

  private fail(s: Shadow, where: string, err: unknown): void {
    (this.stats.get(s.policyId) as ShadowStats).errors++;
    logger.warn(`shadowRun: ${where} failed; shadow '${s.policyId}' skipped for this call`, { err: String(err) });
  }

  /** Provisional shadow size until P1-5's sizer: per_stock_pct x starting_cash, whole shares. */
  private static defaultQty(strategy: BreakoutMomentumStrategy, intent: EntryIntent): number {
    const account = strategy.activeWeeklyConfig?.account;
    if (!account) return 0;
    return (account.per_stock_pct * account.starting_cash) / (intent.limitPrice ?? intent.referenceClose);
  }
}
