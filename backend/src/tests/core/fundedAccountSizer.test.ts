import {
  FundedAccountSizer,
  liquidityCapShares,
  sizeFundedOrder,
  type FundedAccountSizerConfig,
  type FundedSizingInput,
} from "../../core/sizing/fundedAccountSizer";
import type { PositionSizerParams } from "../../core/sizing/IPositionSizer";

const CFG: FundedAccountSizerConfig = {
  perStockPct: 0.08,
  riskPct: 0.0025,
  totalExposureCap: 0.8,
  maxPositions: 10,
  liquidityCapPct: 0.01,
  liquidityLookback: 20,
  liquidityMinObs: 15,
  stopAtrMult: 1.5,
};

// Equity 100k, price 50, ATR 1.0 (stop 1.5): per-stock 160, risk 166.7.
const BASE: FundedSizingInput = {
  equity: 100_000,
  price: 50,
  atr: 1,
  cashFree: 100_000,
  exposureUsed: 0,
  positionCount: 0,
  liquidityShares: 1e9,
};
const size = (over: Partial<FundedSizingInput> = {}, cfg = CFG) => sizeFundedOrder({ ...BASE, ...over }, cfg);

describe("sizeFundedOrder", () => {
  it("worked example gives 160 shares, per-stock binding", () => {
    expect(size()).toEqual({ qty: 160, bindingCap: "per_stock" });
  });

  it("each cap binds in turn", () => {
    expect(size({ atr: 2 })).toEqual({ qty: 83, bindingCap: "risk" }); // 250 / 3
    expect(size({ cashFree: 2_500 })).toEqual({ qty: 50, bindingCap: "cash" });
    expect(size({ exposureUsed: 79_000 })).toEqual({ qty: 20, bindingCap: "exposure" });
    expect(size({ liquidityShares: 12.7 })).toEqual({ qty: 12, bindingCap: "liquidity" });
    expect(size({ positionCount: 10 })).toEqual({ qty: 0, bindingCap: "max_positions" });
    expect(size({ positionCount: 9 }).qty).toBe(160);
  });

  it("caps come from config, not constants", () => {
    expect(size({}, { ...CFG, perStockPct: 0.04 }).qty).toBe(80);
    expect(size({ atr: 4 }).qty).toBe(41); // 250 / 6
    expect(size({ atr: 4 }, { ...CFG, riskPct: 0.005 }).qty).toBe(83); // 500 / 6
    expect(size({ exposureUsed: 79_000 }, { ...CFG, totalExposureCap: 0.9 }).qty).toBe(160);
    expect(size({ positionCount: 5 }, { ...CFG, maxPositions: 5 }).bindingCap).toBe("max_positions");
  });

  it("floors fractional shares and reports the binding cap on zero", () => {
    expect(size({ price: 3_000 })).toEqual({ qty: 2, bindingCap: "per_stock" }); // 2.67
    expect(size({ cashFree: 40 })).toEqual({ qty: 0, bindingCap: "cash" });
    expect(size({ exposureUsed: 80_000 })).toEqual({ qty: 0, bindingCap: "exposure" });
    expect(size({ liquidityShares: 0 })).toEqual({ qty: 0, bindingCap: "liquidity" });
    expect(size({ exposureUsed: 90_000 }).qty).toBe(0); // negative room is zero
  });

  it("absorbs float noise just below an integer", () => {
    expect(size({ liquidityShares: 4 - 1e-12 }).qty).toBe(4);
  });

  it("uses unitCost for the cash cap", () => {
    expect(size({ cashFree: 2_500, unitCost: 50.5 }).qty).toBe(49);
  });

  it("rejects invalid inputs", () => {
    for (const over of [{ price: NaN }, { atr: 0 }, { equity: -5 }, { atr: Infinity }]) {
      expect(size(over)).toEqual({ qty: 0, bindingCap: "invalid_input" });
    }
  });

  it("size multiplier scales only the equity caps", () => {
    expect(size({ sizeMultiplier: 0.5 }).qty).toBe(80);
    expect(size({ cashFree: 2_500, sizeMultiplier: 2 }).qty).toBe(50);
  });
});

describe("liquidityCapShares", () => {
  const cfg = { liquidityCapPct: 0.01, liquidityLookback: 20, liquidityMinObs: 5 };

  it("odd count uses the middle value", () => {
    expect(liquidityCapShares([500, 100, 300, 200, 400], cfg)).toBeCloseTo(3);
  });

  it("even count averages the two middle values", () => {
    expect(liquidityCapShares([100, 300, 200, 400], { ...cfg, liquidityMinObs: 4 })).toBeCloseTo(2.5);
  });

  it("returns zero below min observations or when empty", () => {
    expect(liquidityCapShares([1, 2, 3, 4], cfg)).toBe(0);
    expect(liquidityCapShares([], { ...cfg, liquidityMinObs: 0 })).toBe(0);
  });

  it("ignores invalid values and keeps only the latest lookback sessions", () => {
    expect(liquidityCapShares([NaN, -1, 100, 100, 100, 100, 100], cfg)).toBeCloseTo(1);
    const vols = [1_000_000, 1_000_000, ...Array.from({ length: 20 }, () => 100)];
    expect(liquidityCapShares(vols, { ...cfg, liquidityMinObs: 15 })).toBeCloseTo(1);
  });
});

describe("FundedAccountSizer (IPositionSizer adapter)", () => {
  const portfolio = (cash: number, values: number[]) =>
    ({
      getRiskView: () => ({
        equity: cash + values.reduce((a, b) => a + b, 0),
        cash,
        positions: values.map((marketValue) => ({ marketValue })),
        initialCapital: 100_000,
      }),
    }) as unknown as PositionSizerParams["portfolio"];

  const ctx = { atr: 1, reservedCash: 0, pendingNotional: 0, pendingCount: 0, liquidityShares: 1e9 };
  const params = (p: PositionSizerParams["portfolio"], direction: "long" | "close_long" = "long") =>
    ({ symbol: "AAA", direction, estimatedPrice: 50, portfolio: p }) as unknown as PositionSizerParams;

  it("sizes from portfolio state and context", () => {
    const s = new FundedAccountSizer(CFG, () => ctx);
    expect(s.type).toBe("funded_account");
    expect(s.computeQty(params(portfolio(100_000, [])))).toBe(160);
    expect(s.lastBindingCap).toBe("per_stock");
  });

  it("counts pending reservations and notional", () => {
    // equity 100k; reserved cash leaves 2,500; pending notional 0
    const s = new FundedAccountSizer(CFG, () => ({ ...ctx, reservedCash: 97_500 }));
    expect(s.computeQty(params(portfolio(100_000, [])))).toBe(50);
    expect(s.lastBindingCap).toBe("cash");
    // held 39,000 marked + 40,000 pending leaves 1,000 under 80k
    const e = new FundedAccountSizer(CFG, () => ({ ...ctx, pendingNotional: 40_000, pendingCount: 1 }));
    expect(e.computeQty(params(portfolio(61_000, [39_000])))).toBe(20);
    expect(e.lastBindingCap).toBe("exposure");
  });

  it("returns 0 for closes and when no context is available", () => {
    const s = new FundedAccountSizer(CFG, () => ctx);
    expect(s.computeQty(params(portfolio(100_000, []), "close_long"))).toBe(0);
    const n = new FundedAccountSizer(CFG, () => undefined);
    expect(n.computeQty(params(portfolio(100_000, [])))).toBe(0);
    expect(n.lastBindingCap).toBe("invalid_input");
  });
});
