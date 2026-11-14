/**
 * core/sizing/fundedAccountSizer.ts
 *
 * Funded-account sizer (momentum plan P1-5), a port of research-python
 * trade/funded_sizing.py (C3). Quantity is floor(min of):
 *   - perStockPct * equity / price
 *   - riskPct * equity / stopDistance            (stopDistance = stopAtrMult * ATR at entry)
 *   - freeCash / unitCost                        (cash after reservations)
 *   - (totalExposureCap * equity - exposureUsed) / price
 *   - liquidityShares                            (liquidityCapPct * median same-minute volume)
 * plus a max-positions gate. Zero means no order; the binding cap is returned
 * as the rejection reason. Every cap comes from FundedAccountSizerConfig.
 *
 * sizeFundedOrder() is the pure function the P1-4 allocator should call.
 * FundedAccountSizer adapts it to IPositionSizer, with the inputs the interface
 * lacks (ATR, reservations, liquidity) supplied by a context provider.
 */

import type { SizerType } from "../../types/common";
import type { IPositionSizer, PositionSizerParams } from "./IPositionSizer";

export interface FundedAccountSizerConfig {
  /** Per-stock cap as a fraction of equity (0.08) */
  perStockPct: number;
  /** Risk per trade as a fraction of equity (0.0025) */
  riskPct: number;
  /** Total exposure cap as a fraction of equity (0.80) */
  totalExposureCap: number;
  /** Max concurrent positions including pending entries (10) */
  maxPositions: number;
  /** Liquidity cap as a fraction of median same-minute volume (0.01) */
  liquidityCapPct: number;
  /** Sessions in the liquidity lookback (20) */
  liquidityLookback: number;
  /** Minimum valid observations for the liquidity cap (15) */
  liquidityMinObs: number;
  /** Initial stop distance in ATRs (1.5) */
  stopAtrMult: number;
}

export type BindingCap =
  | "per_stock"
  | "risk"
  | "cash"
  | "exposure"
  | "liquidity"
  | "max_positions"
  | "invalid_input";

export interface FundedSizingInput {
  equity: number;
  /** Planned entry price */
  price: number;
  /** ATR14 at entry (stop distance = stopAtrMult * atr) */
  atr: number;
  /** Cash after reservations for pending orders */
  cashFree: number;
  /** Cash reserved per share (limit price plus entry cost); defaults to price */
  unitCost?: number;
  /** Marked value of open positions plus pending notional */
  exposureUsed: number;
  /** Open plus pending position count */
  positionCount: number;
  /** Liquidity cap in shares, from liquidityCapShares() */
  liquidityShares: number;
  /** Scales the two equity-proportional caps only (default 1) */
  sizeMultiplier?: number;
}

export interface FundedSizingResult {
  qty: number;
  /** The cap that produced qty (the rejection reason when qty is 0) */
  bindingCap: BindingCap;
}

/**
 * Liquidity cap in shares: liquidityCapPct * median of the given same-minute
 * volumes. Zero if fewer than liquidityMinObs valid (finite, >= 0) values.
 * Only the most recent liquidityLookback observations are used.
 */
export function liquidityCapShares(
  volumes: readonly number[],
  cfg: Pick<FundedAccountSizerConfig, "liquidityCapPct" | "liquidityLookback" | "liquidityMinObs">,
): number {
  const valid = volumes.filter((v) => Number.isFinite(v) && v >= 0).slice(-cfg.liquidityLookback);
  const n = valid.length;
  if (n === 0 || n < cfg.liquidityMinObs) return 0;
  const s = [...valid].sort((a, b) => a - b);
  const mid = n >> 1;
  const med = n % 2 ? s[mid] : 0.5 * (s[mid - 1] + s[mid]);
  return cfg.liquidityCapPct * med;
}

/** Pure sizing. Ties go to the earlier cap in the listed order (as in Python). */
export function sizeFundedOrder(input: FundedSizingInput, cfg: FundedAccountSizerConfig): FundedSizingResult {
  const unitCost = input.unitCost ?? input.price;
  const stopDistance = cfg.stopAtrMult * input.atr;
  const finite = [input.equity, input.price, stopDistance, unitCost].every(Number.isFinite);
  if (!finite || !(input.equity > 0 && input.price > 0 && stopDistance > 0 && unitCost > 0)) {
    return { qty: 0, bindingCap: "invalid_input" };
  }
  if (input.positionCount >= cfg.maxPositions) return { qty: 0, bindingCap: "max_positions" };

  const m = input.sizeMultiplier ?? 1;
  const caps: Array<[BindingCap, number]> = [
    ["per_stock", (m * cfg.perStockPct * input.equity) / input.price],
    ["risk", (m * cfg.riskPct * input.equity) / stopDistance],
    ["cash", input.cashFree / unitCost],
    ["exposure", (cfg.totalExposureCap * input.equity - input.exposureUsed) / input.price],
    ["liquidity", input.liquidityShares],
  ];
  let [bindingCap, best] = caps[0];
  for (const [name, v] of caps.slice(1)) {
    if (v < best) {
      best = v;
      bindingCap = name;
    }
  }
  const q = Math.floor(best + 1e-9);
  return { qty: q > 0 ? q : 0, bindingCap };
}

/** Per-signal inputs the IPositionSizer interface cannot carry. */
export interface FundedSizingContext {
  atr: number;
  /** Cash reserved for pending orders */
  reservedCash: number;
  /** Notional of pending entries */
  pendingNotional: number;
  pendingCount: number;
  liquidityShares: number;
  unitCost?: number;
  sizeMultiplier?: number;
}

export class FundedAccountSizer implements IPositionSizer {
  readonly type: SizerType = "funded_account";

  /** Binding cap of the most recent computeQty call (rejection reason when qty is 0) */
  lastBindingCap: BindingCap | undefined;

  constructor(
    private readonly cfg: FundedAccountSizerConfig,
    private readonly getContext: (symbol: string) => FundedSizingContext | undefined,
  ) {}

  /** Entries only; closes and a missing context return 0. */
  computeQty(params: PositionSizerParams): number {
    if (params.direction !== "long" && params.direction !== "short") {
      this.lastBindingCap = undefined;
      return 0;
    }
    const ctx = this.getContext(params.symbol);
    if (!ctx) {
      this.lastBindingCap = "invalid_input";
      return 0;
    }
    const view = params.portfolio.getRiskView();
    const held = view.positions.reduce((s, p) => s + Math.abs(p.marketValue), 0);
    const r = sizeFundedOrder(
      {
        equity: view.equity,
        price: params.estimatedPrice,
        atr: ctx.atr,
        cashFree: view.cash - ctx.reservedCash,
        unitCost: ctx.unitCost,
        exposureUsed: held + ctx.pendingNotional,
        positionCount: view.positions.length + ctx.pendingCount,
        liquidityShares: ctx.liquidityShares,
        sizeMultiplier: ctx.sizeMultiplier,
      },
      this.cfg,
    );
    this.lastBindingCap = r.bindingCap;
    return r.qty;
  }
}
