/**
 * strategies/momentum/breakoutMomentumStrategy.ts
 *
 * Breakout momentum (guide §2, §3): on every completed regular-session minute
 * bar, update each symbol's indicators once, apply the readiness rules, and
 * evaluate the week's active group (breakout AND the selected confirmations).
 * A symbol that qualifies, is in the artifact's universe, is not held, was not
 * already entered today, and is inside the entry window becomes an entry
 * candidate carrying its indicator values.
 *
 * Everything tunable comes from the weekly artifact (see weeklyConfigLoader.ts):
 * a missing, stale, invalid, unknown-version or no_deployment artifact opens no
 * new entries, open positions keep the config they were opened under, and the
 * config only switches while the strategy is flat.
 *
 * The strategy is deterministic and in order, and calls nothing external. Two
 * surfaces: `decideBar()` is the per-bar decision record that the minute batch
 * and allocator (P1-4) and the golden parity test (P1-6) consume;
 * `evaluate()` is the engine's one-signal-per-context adapter around it.
 *
 * Inputs:  EvaluationContext (latest bar, positions); the weekly artifact.
 * Outputs: BarDecision per bar; StrategySignal (long, limit) for a candidate.
 */

import { BaseStrategy } from "../base/strategy";
import type { EvaluationContext } from "../base/strategy";
import type { StrategySignal, StrategyType } from "../../types/strategy";
import type { Bar } from "../../types/market";
import { nowMs } from "../../utils/time";
import {
  BAR_MS,
  MomentumIndicatorBank,
  type BankBar,
  type BankStep,
} from "./breakoutMomentumIndicators";
import { resolveBreakoutParams, validateBreakoutMomentumConfig } from "./breakoutMomentumConfig";
import type {
  BarDecision,
  BarSkipReason,
  BreakoutMomentumConfig,
  BreakoutParams,
  EntryIntent,
  EntrySizer,
  ExitPlan,
} from "./breakoutMomentumTypes";
import type { WeeklyConfig } from "./weeklyConfig";
import { WeeklyConfigManager, type ConfigResolution } from "./weeklyConfigLoader";

const NEW_YORK_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const DAY_MS = 86_400_000;

interface LocalTime {
  /** "YYYY-MM-DD" in America/New_York. */
  date: string;
  minuteOfDay: number;
  weekend: boolean;
}

function localTime(ts: number): LocalTime {
  const p = Object.fromEntries(NEW_YORK_CLOCK.formatToParts(ts).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minuteOfDay: Number(p.hour) * 60 + Number(p.minute),
    weekend: p.weekday === "Sat" || p.weekday === "Sun",
  };
}

/** Fixed-capacity history of one symbol's accepted bars, for rebuilding a bank. */
class BarRing {
  private readonly ts: Float64Array;
  private readonly hi: Float64Array;
  private readonly lo: Float64Array;
  private readonly cl: Float64Array;
  private readonly vol: Float64Array;
  private readonly day: Float64Array;
  private readonly minute: Float64Array;
  private head = 0;
  private size = 0;

  constructor(private readonly capacity: number) {
    this.ts = new Float64Array(capacity);
    this.hi = new Float64Array(capacity);
    this.lo = new Float64Array(capacity);
    this.cl = new Float64Array(capacity);
    this.vol = new Float64Array(capacity);
    this.day = new Float64Array(capacity);
    this.minute = new Float64Array(capacity);
  }

  push(b: BankBar): void {
    const i = this.head;
    this.ts[i] = b.ts; this.hi[i] = b.high; this.lo[i] = b.low; this.cl[i] = b.close; this.vol[i] = b.volume;
    this.day[i] = Date.parse(`${b.sessionId}T00:00:00Z`) / DAY_MS;
    this.minute[i] = b.minuteOfDay;
    this.head = (i + 1) % this.capacity;
    if (this.size < this.capacity) this.size += 1;
  }

  /** Oldest first. */
  *bars(): Generator<BankBar> {
    const start = (this.head - this.size + this.capacity) % this.capacity;
    for (let k = 0; k < this.size; k++) {
      const i = (start + k) % this.capacity;
      yield {
        ts: this.ts[i], high: this.hi[i], low: this.lo[i], close: this.cl[i], volume: this.vol[i],
        sessionId: new Date(this.day[i] * DAY_MS).toISOString().slice(0, 10), minuteOfDay: this.minute[i],
      };
    }
  }
}

interface SymbolState {
  ring: BarRing;
  lastTs: number | null;
  bank: MomentumIndicatorBank | null;
  /** Identity of the (artifact, params) the bank was built for. */
  bankKey: string | null;
  enteredSession: string | null;
  pending: { barTs: number } | null;
}

export class BreakoutMomentumStrategy extends BaseStrategy {
  readonly type: StrategyType = "momentum";
  // v1: first release (P1-3).
  static readonly VERSION = 1;
  readonly version = BreakoutMomentumStrategy.VERSION;
  readonly triggers = ["bar"] as const;

  private readonly manager = new WeeklyConfigManager();
  private readonly states = new Map<string, SymbolState>();
  private readonly decisions = new Map<string, BarDecision>();
  /** Latest bar timestamp offered to evaluate(), accepted or not. */
  private readonly seenTs = new Map<string, number>();
  private resolvedParams: { key: string; params: BreakoutParams | null } | null = null;

  /**
   * @param momentumConfig - Full config (use createBreakoutMomentumConfig()).
   * @param sizer - Quantity for an intent. P1-5 replaces the default, which is a
   *   provisional per-stock allocation from the artifact (per_stock_pct x starting_cash).
   */
  constructor(
    readonly momentumConfig: BreakoutMomentumConfig,
    private sizer: EntrySizer | null = null,
  ) {
    super(momentumConfig);
    validateBreakoutMomentumConfig(momentumConfig);
    this.manager.submit(momentumConfig.weeklyConfigArtifact);
  }

  /** Replaces the sizer (P1-5 hook). */
  setSizer(sizer: EntrySizer | null): void {
    this.sizer = sizer;
  }

  /** Records a newer weekly artifact (null: none available). It takes effect only while flat. */
  submitArtifact(raw: unknown): void {
    this.manager.submit(raw);
  }

  /** The config currently in force (what open positions are managed under). */
  get activeWeeklyConfig(): WeeklyConfig | null {
    return this.manager.activeConfig;
  }

  /** The decision recorded for a symbol's most recent bar. */
  lastDecision(symbol: string): BarDecision | null {
    return this.decisions.get(symbol) ?? null;
  }

  // ------------------------------------------------------------------
  // Per-bar decision
  // ------------------------------------------------------------------

  /**
   * Updates the symbol's indicators with one completed bar and decides whether
   * it is an entry candidate. Call once per bar, in time order.
   *
   * @param positionQty - net shares held in this symbol
   * @param flat - true when the strategy holds no position in any symbol
   *   (the only time the weekly config may switch)
   */
  decideBar(bar: Bar, positionQty: number, flat: boolean): BarDecision {
    const local = localTime(bar.ts);
    const base = (skip: BarSkipReason, res?: ConfigResolution): BarDecision => ({
      symbol: bar.symbol, assetId: null, barTs: bar.ts, sessionDate: local.date,
      runId: res?.protectionConfig?.run_id ?? null,
      configId: res?.protectionConfig?.selected?.config_id ?? null,
      entriesAllowed: false, components: {}, indicators: null, signal: false, intent: null, skipReason: skip,
    });
    const record = (d: BarDecision): BarDecision => {
      this.decisions.set(bar.symbol, d);
      return d;
    };

    if (!this.validBar(bar)) return record(base("bad_bar"));
    const { openMinute, closeMinute } = this.momentumConfig.session;
    if (local.weekend || local.minuteOfDay < openMinute || local.minuteOfDay >= closeMinute) {
      return record(base("outside_session"));
    }
    const st = this.stateOf(bar.symbol);
    if (st.lastTs !== null && bar.ts <= st.lastTs) return record(base("out_of_order"));
    st.lastTs = bar.ts;

    const res = this.manager.resolve(local.date, flat);
    const step = this.advance(st, bar, local, res);
    const d = base("no_signal", res);
    d.signal = step?.signal ?? false;
    d.components = step?.components ?? {};
    d.indicators = step?.indicators ?? null;

    // Open-position and one-entry-per-session bookkeeping.
    if (positionQty > 0) st.enteredSession = local.date;
    if (st.pending !== null && bar.ts > st.pending.barTs) st.pending = null;

    const skip = this.entryBlock(bar, local, positionQty, res, st, step);
    if (skip !== null) {
      d.skipReason = skip;
      return record(d);
    }
    const cfg = res.entryConfig as WeeklyConfig;
    const member = cfg.universe.find((u) => u.symbol === bar.symbol) as { asset_id: string };
    d.entriesAllowed = true;
    d.assetId = member.asset_id;
    d.runId = cfg.run_id;
    d.configId = (cfg.selected as { config_id: string }).config_id;
    d.intent = this.buildIntent(bar, local, cfg, member.asset_id, step as BankStep);
    d.skipReason = null;
    return record(d);
  }

  /** First rule that stops this bar from becoming an entry, or null. Order matters for the log only. */
  private entryBlock(
    bar: Bar, local: LocalTime, positionQty: number, res: ConfigResolution, st: SymbolState, step: BankStep | null,
  ): BarSkipReason | null {
    if (!res.entriesAllowed || res.entryConfig === null) return res.reason ?? "missing";
    const cfg = res.entryConfig;
    if (!cfg.universe.some((u) => u.symbol === bar.symbol)) return "symbol_not_in_universe";
    // The platform has no entry score and cannot honour a threshold: fail closed rather than ignore it.
    if (cfg.account.entry_score_threshold !== null || step === null) return "params_unsupported";
    if (positionQty > 0) return "holding";
    if (st.enteredSession === local.date) return "already_entered_today";
    if (st.pending !== null) return "entry_pending";
    // Research: no new entry once m + 1 >= length - session_exit_minutes_before_close.
    const { openMinute, closeMinute } = this.momentumConfig.session;
    const m = local.minuteOfDay - openMinute;
    const exitM = closeMinute - openMinute - cfg.account.exit.session_exit_minutes_before_close;
    if (m + 1 >= exitM) return "entry_window_closed";
    if (!step.signal) {
      return Object.values(step.components).every((c) => c!.ready) ? "no_signal" : "indicators_not_ready";
    }
    return null;
  }

  private buildIntent(bar: Bar, local: LocalTime, cfg: WeeklyConfig, assetId: string, step: BankStep): EntryIntent {
    const ex = cfg.account.exit;
    const { closeMinute } = this.momentumConfig.session;
    const exitPlan: ExitPlan = {
      entryAtr: step.indicators.atr,
      initialStopAtr: ex.initial_stop_atr,
      trailActivationAtr: ex.trail_activation_atr,
      trailDistanceAtr: ex.trail_distance_atr,
      maxHoldMinutes: ex.max_hold_minutes,
      sessionExitMinutesBeforeClose: ex.session_exit_minutes_before_close,
      sessionExitMinuteOfDay: closeMinute - ex.session_exit_minutes_before_close,
    };
    return {
      symbol: bar.symbol,
      assetId,
      runId: cfg.run_id,
      configId: (cfg.selected as { config_id: string }).config_id,
      barTs: bar.ts,
      sessionDate: local.date,
      referenceClose: bar.close,
      limitPrice: cfg.account.fill.kind === "limit_markup" ? bar.close * (1 + cfg.account.fill.limit_markup) : null,
      atr: step.indicators.atr,
      indicators: step.indicators,
      exitPlan,
    };
  }

  /**
   * Tells the strategy an entry for this bar was actually sent, so it will not
   * propose the same symbol again until the next bar resolves it. Not called by
   * decideBar(): a batch allocator may drop candidates it does not fund.
   */
  markEntrySubmitted(symbol: string, barTs: number): void {
    const st = this.states.get(symbol);
    if (st) st.pending = { barTs };
  }

  // ------------------------------------------------------------------
  // Indicators
  // ------------------------------------------------------------------

  private validBar(bar: Bar): boolean {
    const f = Number.isFinite;
    return (
      bar.timeframe === "1m" && typeof bar.symbol === "string" && bar.symbol !== "" &&
      f(bar.ts) && f(bar.open) && f(bar.high) && f(bar.low) && f(bar.close) && f(bar.volume) &&
      bar.high >= bar.low && bar.volume >= 0
    );
  }

  private stateOf(symbol: string): SymbolState {
    let st = this.states.get(symbol);
    if (!st) {
      st = {
        ring: new BarRing(this.momentumConfig.historyBars), lastTs: null, bank: null, bankKey: null,
        enteredSession: null, pending: null,
      };
      this.states.set(symbol, st);
    }
    return st;
  }

  /** Params of the config in force, resolved once per artifact. */
  private paramsFor(cfg: WeeklyConfig | null): BreakoutParams | null {
    if (cfg === null || cfg.selected === null) return null;
    const key = cfg.run_id + "|" + cfg.selected.config_id;
    if (this.resolvedParams?.key !== key) {
      const r = resolveBreakoutParams(cfg.selected);
      this.resolvedParams = { key, params: r.ok ? r.params : null };
    }
    return this.resolvedParams.params;
  }

  /**
   * Records the bar in the history and updates (or, after a week change,
   * rebuilds from history) the symbol's bank. Returns null when no usable
   * parameters are in force.
   */
  private advance(st: SymbolState, bar: Bar, local: LocalTime, res: ConfigResolution): BankStep | null {
    const bb: BankBar = {
      ts: bar.ts, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
      sessionId: local.date, minuteOfDay: local.minuteOfDay,
    };
    st.ring.push(bb);
    const cfg = res.protectionConfig;
    const params = this.paramsFor(cfg);
    if (cfg === null || params === null) {
      st.bank = null;
      st.bankKey = null;
      return null;
    }
    const key = (cfg.run_id) + "|" + (cfg.selected as { config_id: string }).config_id;
    if (st.bank !== null && st.bankKey === key) return st.bank.update(bb);

    const bank = new MomentumIndicatorBank(params, this.momentumConfig.signals);
    let step: BankStep | null = null;
    for (const b of st.ring.bars()) step = bank.update(b);
    st.bank = bank;
    st.bankKey = key;
    return step;
  }

  // ------------------------------------------------------------------
  // Engine adapter
  // ------------------------------------------------------------------

  evaluate(context: EvaluationContext): StrategySignal | null {
    if (!this.isActive || !this.momentumConfig.enabled) return null;
    const { symbol } = context;
    const bar = context.symbolState.get(symbol)?.latestBar;
    if (!bar) return null;
    // Quotes and trades re-evaluate between bars; only a new bar is a decision.
    const seen = this.seenTs.get(symbol);
    if (seen !== undefined && bar.ts <= seen) return null;
    this.seenTs.set(symbol, bar.ts);

    const positions = context.portfolioState.getAllPositions();
    const positionQty = context.portfolioState.getPosition(symbol)?.qty ?? 0;
    const flat = positions.every((p) => p.qty === 0);
    const decision = this.decideBar(bar, positionQty, flat);
    const intent = decision.intent;
    if (intent === null) return null;

    const qty = Math.floor(this.sizer ? this.sizer(intent) : this.defaultQty(intent));
    if (!(qty >= 1)) return null;
    this.markEntrySubmitted(symbol, bar.ts);
    return this.buildSignal({
      symbol,
      direction: "long",
      qty,
      triggerValue: intent.indicators.breakoutThreshold,
      triggerLabel: "breakout_momentum_entry",
      meta: { ...(intent as unknown as Record<string, unknown>) },
      order: intent.limitPrice !== null
        ? { type: "limit", limitPrice: intent.limitPrice, timeInForce: "ioc" }
        : undefined,
    });
  }

  /** Provisional allocation until P1-5: per_stock_pct of starting cash, whole shares. */
  private defaultQty(intent: EntryIntent): number {
    const account = this.manager.activeConfig?.account;
    if (!account) return 0;
    return (account.per_stock_pct * account.starting_cash) / (intent.limitPrice ?? intent.referenceClose);
  }

  // ------------------------------------------------------------------
  // Warm-up (core/live/strategyWarmer.ts)
  // ------------------------------------------------------------------

  /** Calendar span of the relative-volume history (the deepest window), with weekend and holiday slack. */
  warmUpLookbackMs(): number {
    const sessions = this.momentumConfig.signals.rvolHistorySessions + 1;
    return (Math.ceil((sessions * 7) / 5) + 4) * DAY_MS;
  }

  /**
   * Rebuilds each symbol's bar history from complete regular-session bars
   * (ascending by ts). Never decides or signals, and does not touch entered or
   * pending state. Indicators are built from this history when the first config
   * is adopted.
   */
  warmUp(bars: Bar[]): number {
    const completeBefore = nowMs() - BAR_MS;
    const { openMinute, closeMinute } = this.momentumConfig.session;
    let primed = 0;
    for (const bar of bars) {
      if (bar.ts > completeBefore || !this.validBar(bar)) continue;
      const local = localTime(bar.ts);
      if (local.weekend || local.minuteOfDay < openMinute || local.minuteOfDay >= closeMinute) continue;
      const st = this.stateOf(bar.symbol);
      if (st.lastTs !== null && bar.ts <= st.lastTs) continue;
      st.lastTs = bar.ts;
      st.ring.push({
        ts: bar.ts, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
        sessionId: local.date, minuteOfDay: local.minuteOfDay,
      });
      st.bank = null; // rebuilt from the ring on the next live bar
      st.bankKey = null;
      primed++;
    }
    return primed;
  }
}
