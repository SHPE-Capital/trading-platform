
import { RiskEngine } from "../../src/core/risk/riskEngine";
import { OrderIntent } from "../../src/types/orders";
import { PortfolioSnapshot } from "../../src/types/portfolio";
import { UUID } from "../../src/types/common";

describe("RiskEngine", () => {
  const defaultConfig = {
    allowShortSelling: false,
    maxPositionSizeUsd: 10000,
    maxNotionalExposureUsd: 20000,
    orderCooldownMs: 5000,
  };

  const createPortfolio = (positionsValue: number, positions: any[] = []): PortfolioSnapshot => ({
    id: "p1" as UUID,
    ts: Date.now(),
    isoTs: new Date().toISOString(),
    cash: 100000,
    positionsValue,
    equity: 100000 + positionsValue,
    initialCapital: 100000,
    totalUnrealizedPnl: 0,
    totalRealizedPnl: 0,
    totalPnl: 0,
    returnPct: 0,
    positions,
    positionCount: positions.length,
  });

  const createIntent = (symbol: string, side: "buy" | "sell", qty: number, price: number): OrderIntent => ({
    id: "intent-1" as UUID,
    strategyId: "strat-1",
    symbol,
    side,
    qty,
    orderType: "market",
    timeInForce: "gtc",
    limitPrice: price,
    ts: Date.now(),
  });

  test("BUY when allowShortSelling=false and no existing position: allowed", () => {
    const risk = new RiskEngine(defaultConfig);
    const intent = createIntent("SPY", "buy", 10, 100);
    const result = risk.check(intent, createPortfolio(0));
    expect(result.passed).toBe(true);
  });

  test("SELL when allowShortSelling=false and no existing position: blocked", () => {
    const risk = new RiskEngine(defaultConfig);
    const intent = createIntent("SPY", "sell", 10, 100);
    const result = risk.check(intent, createPortfolio(0));
    expect(result.passed).toBe(false);
    expect(result.reason?.toLowerCase()).toContain("short selling is disabled");
  });

  test("SELL when allowShortSelling=false and matching long exists: allowed up to held qty", () => {
    const risk = new RiskEngine(defaultConfig);
    const intent = createIntent("SPY", "sell", 5, 100);
    const portfolio = createPortfolio(1000, [{ symbol: "SPY", qty: 10, currentPrice: 100, marketValue: 1000 }]);
    const result = risk.check(intent, portfolio);
    expect(result.passed).toBe(true);
  });

  test("SELL when allowShortSelling=false and matching long exists: blocked beyond", () => {
    const risk = new RiskEngine(defaultConfig);
    const intent = createIntent("SPY", "sell", 15, 100);
    const portfolio = createPortfolio(1000, [{ symbol: "SPY", qty: 10, currentPrice: 100, marketValue: 1000 }]);
    const result = risk.check(intent, portfolio);
    expect(result.passed).toBe(false);
  });

  test("SELL when allowShortSelling=true and no existing position: allowed", () => {
    const risk = new RiskEngine({ ...defaultConfig, allowShortSelling: true });
    const intent = createIntent("SPY", "sell", 10, 100);
    const result = risk.check(intent, createPortfolio(0));
    expect(result.passed).toBe(true);
  });

  test("Notional caps applied to GROSS exposure", () => {
    const risk = new RiskEngine({ ...defaultConfig, maxNotionalExposureUsd: 10000 });
    // Long 5000 SPY, Short 5000 QQQ = 10000 Gross.
    const portfolio = createPortfolio(0, [
        { symbol: "SPY", qty: 50, avgEntryPrice: 100, currentPrice: 100, marketValue: 5000 },
        { symbol: "QQQ", qty: -25, avgEntryPrice: 200, currentPrice: 200, marketValue: -5000 }
    ]);
    const intent = createIntent("AAPL", "buy", 10, 101); // Try to add another 1010.
    const result = risk.check(intent, portfolio);
    expect(result.passed).toBe(false);
    expect(result.reason?.toLowerCase()).toContain("max notional exposure");
  });

  test("Cooldown: 0 cooldown allows back-to-back orders", () => {
    const risk = new RiskEngine({ ...defaultConfig, orderCooldownMs: 0 });
    const intent = createIntent("SPY", "buy", 10, 100);
    
    // We can't easily override time inside the risk engine without mocking nowMs
    // but 0 cooldown should always pass.
    risk.check(intent, createPortfolio(0));
    const result = risk.check(intent, createPortfolio(0));
    expect(result.passed).toBe(true);
  });

  test("Cooldown: non-zero cooldown blocks inside window", () => {
    const risk = new RiskEngine({ ...defaultConfig, orderCooldownMs: 5000 });
    const intent = createIntent("SPY", "buy", 10, 100);
    
    risk.check(intent, createPortfolio(0));
    const result = risk.check(intent, createPortfolio(0));
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("Order cooldown active");
  });
});
