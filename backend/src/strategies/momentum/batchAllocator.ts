/**
 * strategies/momentum/batchAllocator.ts
 *
 * Minute batch and cross-stock allocator (momentum plan P1-4), a port of the
 * research C4 steps 4 to 6 (trade/account.py) on top of the C3 sizer.
 *
 * Integration point (decided: no orchestrator or OMS edit). The strategy emits
 * intents through decideBar(); a caller that owns the minute (the engine
 * adapter, or the P1-6 parity test) collects them in a MinuteBatch, closes the
 * batch 1 s after the scheduled minute end, and calls allocateBatch() once.
 * Dispatch of the resulting orders stays in the caller, in the returned order,
 * so synchronous in-order dispatch and deterministic replay are unchanged.
 *
 * Algorithm (docs/contracts/momentum_golden.md, orders section):
 *  1. drop candidates already entered today (silently);
 *  2. rank by the configured function (default dollar_volume_20d: descending
 *     median daily dollar volume, ascending assetId on ties);
 *  3. per candidate: max_positions gate, bad_data check, limit/unit cost,
 *     sizeFundedOrder with cash and exposure net of earlier orders in the same
 *     batch; zero size is rejected as size_zero:<cap>.
 *
 * Inputs:  EntryIntents with per-symbol ranking score and same-minute volumes,
 *          the account state and the weekly `account` settings.
 * Outputs: ranked candidates, sized orders, rejections.
 */

import {
  liquidityCapShares,
  sizeFundedOrder,
  type BindingCap,
  type FundedAccountSizerConfig,
} from "../../core/sizing/fundedAccountSizer";
import type { AccountSettings } from "./weeklyConfig";
import type { EntryIntent } from "./breakoutMomentumTypes";

/** Ordering key for a candidate: larger score ranks first. */
export type RankingFn = (c: BatchCandidate) => number;

/** Registry of ranking functions, selected by `account.ranking`. */
export const RANKINGS: Readonly<Record<string, RankingFn>> = {
  dollar_volume_20d: (c) => c.dollarVolumeMedian,
};

export interface BatchCandidate {
  intent: EntryIntent;
  /** Median daily dollar volume over the previous liquidity_lookback sessions (0 if none). */
  dollarVolumeMedian: number;
  /** Volume of this symbol at the same minute in previous sessions, oldest first. */
  sameMinuteVolumes: readonly number[];
}

/** Scripted or live account state at the decision. */
export interface AccountState {
  equity: number;
  /** Cash not yet reserved by pending orders */
  cashFree: number;
  /** Marked value of open positions plus pending notional carried in */
  exposureUsed: number;
  openPositions: number;
  pendingOrders: number;
  /** Asset IDs already entered in this session (excluded without a rejection) */
  enteredToday: ReadonlySet<string>;
}

export type AllocatorAccountConfig = Pick<
  AccountSettings,
  | "max_positions" | "per_stock_pct" | "risk_pct" | "total_exposure_cap" | "liquidity_cap_pct"
  | "liquidity_lookback" | "liquidity_min_obs" | "cost_bps" | "ranking" | "size_multiplier"
> & {
  exit: Pick<AccountSettings["exit"], "initial_stop_atr">;
  fill: Pick<AccountSettings["fill"], "limit_markup">;
};

export interface AllocatedOrder {
  assetId: string;
  symbol: string;
  intent: EntryIntent;
  /** 0-based position among the ranked candidates */
  rank: number;
  qty: number;
  signalClose: number;
  atr: number;
  stopDistance: number;
  limitPrice: number;
  unitCost: number;
  /** Cumulative cash reserved in this batch including this order */
  reserved: number;
  liquidityShares: number;
  bindingCap: BindingCap;
}

export type RejectionReason = "max_positions" | "bad_data" | `size_zero:${string}`;

export interface Rejection {
  assetId: string;
  symbol: string;
  reason: RejectionReason;
}

export interface BatchAllocation {
  /** Ranked candidates (after the entered-today filter) */
  candidates: string[];
  orders: AllocatedOrder[];
  rejections: Rejection[];
}

/** Median; mean of the two middle values for an even count; 0 for no values. */
export function median(values: readonly number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = n >> 1;
  return n % 2 ? s[mid] : 0.5 * (s[mid - 1] + s[mid]);
}

/** Median of per-session dollar volumes (each the sum of close*volume), last `lookback` sessions. */
export function medianDailyDollarVolume(dailyDollarVolumes: readonly number[], lookback: number): number {
  return median(dailyDollarVolumes.slice(-lookback));
}

/** Pure ranking: descending score, ascending assetId (string order) on ties. */
export function rankCandidates(candidates: readonly BatchCandidate[], ranking: string): BatchCandidate[] {
  const fn = RANKINGS[ranking];
  if (!fn) throw new Error(`unknown ranking '${ranking}'; choose from ${Object.keys(RANKINGS).sort().join(", ")}`);
  return [...candidates].sort((a, b) => {
    const sa = fn(a);
    const sb = fn(b);
    if (sa !== sb) return sb > sa ? 1 : -1;
    return a.intent.assetId < b.intent.assetId ? -1 : a.intent.assetId > b.intent.assetId ? 1 : 0;
  });
}

function sizerConfig(a: AllocatorAccountConfig): FundedAccountSizerConfig {
  return {
    perStockPct: a.per_stock_pct,
    riskPct: a.risk_pct,
    totalExposureCap: a.total_exposure_cap,
    maxPositions: a.max_positions,
    liquidityCapPct: a.liquidity_cap_pct,
    liquidityLookback: a.liquidity_lookback,
    liquidityMinObs: a.liquidity_min_obs,
    stopAtrMult: a.exit.initial_stop_atr,
  };
}

/** Rank and size one minute's candidates. Pure and deterministic. */
export function allocateBatch(
  candidates: readonly BatchCandidate[],
  state: AccountState,
  account: AllocatorAccountConfig,
): BatchAllocation {
  const eligible = candidates.filter((c) => !state.enteredToday.has(c.intent.assetId));
  const ranked = rankCandidates(eligible, account.ranking);
  const cfg = sizerConfig(account);
  const out: BatchAllocation = { candidates: ranked.map((c) => c.intent.assetId), orders: [], rejections: [] };

  let reserved = 0;
  let pendingNotional = 0;
  let pending = state.pendingOrders;

  ranked.forEach((c, rank) => {
    const { intent } = c;
    const reject = (reason: RejectionReason): void => {
      out.rejections.push({ assetId: intent.assetId, symbol: intent.symbol, reason });
    };

    if (state.openPositions + pending >= account.max_positions) return reject("max_positions");
    const price = intent.referenceClose;
    const atr = intent.atr;
    if (!(Number.isFinite(price) && price > 0 && Number.isFinite(atr) && atr > 0)) return reject("bad_data");

    const limitPrice = price * (1 + account.fill.limit_markup);
    const unitCost = limitPrice * (1 + account.cost_bps / 1e4);
    const stopDistance = account.exit.initial_stop_atr * atr;
    const liquidityShares = liquidityCapShares(c.sameMinuteVolumes, cfg);

    const r = sizeFundedOrder(
      {
        equity: state.equity,
        price,
        atr,
        cashFree: state.cashFree - reserved,
        unitCost,
        exposureUsed: state.exposureUsed + pendingNotional,
        positionCount: state.openPositions + pending,
        liquidityShares,
        sizeMultiplier: account.size_multiplier ?? undefined,
      },
      cfg,
    );
    if (r.qty <= 0) return reject(`size_zero:${r.bindingCap}`);

    reserved += r.qty * unitCost;
    pendingNotional += r.qty * limitPrice;
    pending += 1;
    out.orders.push({
      assetId: intent.assetId,
      symbol: intent.symbol,
      intent,
      rank,
      qty: r.qty,
      signalClose: price,
      atr,
      stopDistance,
      limitPrice,
      unitCost,
      reserved,
      liquidityShares,
      bindingCap: r.bindingCap,
    });
  });
  return out;
}

export interface LateBar {
  symbol: string;
  receivedAtMs: number;
  /** Milliseconds after the cutoff */
  lateByMs: number;
}

/**
 * Collects the candidates of one scheduled minute. The batch closes
 * `graceMs` (default 1000) after the minute end; later arrivals are excluded
 * and recorded in `late` (the caller logs them). Arrival times are passed in,
 * never read from a clock, so replay is deterministic.
 */
export class MinuteBatch {
  private readonly items = new Map<string, BatchCandidate>();
  readonly late: LateBar[] = [];
  private closed = false;

  constructor(
    /** Scheduled end of the minute (Unix ms) */
    readonly minuteEndMs: number,
    private readonly graceMs = 1000,
  ) {}

  get cutoffMs(): number {
    return this.minuteEndMs + this.graceMs;
  }

  /** True if accepted. A repeated asset replaces its earlier entry. */
  add(candidate: BatchCandidate, receivedAtMs: number): boolean {
    if (this.closed || receivedAtMs > this.cutoffMs) {
      this.late.push({
        symbol: candidate.intent.symbol,
        receivedAtMs,
        lateByMs: Math.max(0, receivedAtMs - this.cutoffMs),
      });
      return false;
    }
    this.items.set(candidate.intent.assetId, candidate);
    return true;
  }

  /** Close the batch and return its candidates in arrival order. */
  close(): BatchCandidate[] {
    this.closed = true;
    return [...this.items.values()];
  }
}
