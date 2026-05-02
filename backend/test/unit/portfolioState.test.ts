
import { PortfolioStateManager } from "../../src/core/state/portfolioState";
import { Fill } from "../../src/types/orders";
import { UUID } from "../../src/types/common";

describe("PortfolioStateManager", () => {
  let psm: PortfolioStateManager;
  const INITIAL_CAPITAL = 100000;

  beforeEach(() => {
    psm = new PortfolioStateManager(INITIAL_CAPITAL);
  });

  const createFill = (symbol: string, side: "buy" | "sell", qty: number, price: number, commission = 0): Fill => ({
    id: "fill-1" as UUID,
    orderId: "order-1" as UUID,
    symbol,
    side,
    qty,
    price,
    notional: qty * price,
    commission,
    ts: Date.now(),
    isoTs: new Date().toISOString(),
  });

  const isClose = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-6, 1e-9 * Math.max(Math.abs(a), Math.abs(b)));

  test("Long open: buy 10 @ 100", () => {
    psm.applyFill(createFill("SPY", "buy", 10, 100));
    const pos = psm.getPosition("SPY")!;
    expect(pos.qty).toBe(10);
    expect(pos.avgEntryPrice).toBe(100);
    expect(pos.realizedPnl).toBe(0);
    expect(pos.unrealizedPnl).toBe(0);
    expect(psm.getCash()).toBe(INITIAL_CAPITAL - 1000);
  });

  test("MTM long: updatePrice to 110", () => {
    psm.applyFill(createFill("SPY", "buy", 10, 100));
    psm.updatePrice("SPY", 110);
    const pos = psm.getPosition("SPY")!;
    expect(pos.unrealizedPnl).toBe(100);
    expect(pos.marketValue).toBe(1100);
    expect(psm.getSnapshot().equity).toBe(INITIAL_CAPITAL + 100);
  });

  test("Long full close: sell 10 @ 110", () => {
    psm.applyFill(createFill("SPY", "buy", 10, 100));
    psm.applyFill(createFill("SPY", "sell", 10, 110));
    expect(psm.getPosition("SPY")).toBeNull();
    expect(psm.getSnapshot().totalRealizedPnl).toBe(100);
    expect(psm.getCash()).toBe(INITIAL_CAPITAL + 100);
  });

  test("Short open: sell 10 @ 100", () => {
    psm.applyFill(createFill("SPY", "sell", 10, 100));
    const pos = psm.getPosition("SPY")!;
    expect(pos.qty).toBe(-10);
    expect(pos.avgEntryPrice).toBe(100);
    expect(psm.getCash()).toBe(INITIAL_CAPITAL + 1000);
  });

  test("MTM short: updatePrice to 90", () => {
    psm.applyFill(createFill("SPY", "sell", 10, 100));
    psm.updatePrice("SPY", 90);
    const pos = psm.getPosition("SPY")!;
    expect(pos.unrealizedPnl).toBe(100);
    expect(psm.getSnapshot().equity).toBe(INITIAL_CAPITAL + 100);
  });

  test("Short cover: buy 10 @ 90", () => {
    psm.applyFill(createFill("SPY", "sell", 10, 100));
    psm.applyFill(createFill("SPY", "buy", 10, 90));
    expect(psm.getPosition("SPY")).toBeNull();
    expect(psm.getSnapshot().totalRealizedPnl).toBe(100);
    expect(psm.getCash()).toBe(INITIAL_CAPITAL + 100);
  });

  test("Partial close long: buy 10 @ 100, sell 4 @ 105", () => {
    psm.applyFill(createFill("SPY", "buy", 10, 100));
    psm.applyFill(createFill("SPY", "sell", 4, 105));
    const pos = psm.getPosition("SPY")!;
    expect(pos.qty).toBe(6);
    expect(pos.avgEntryPrice).toBe(100);
    expect(pos.realizedPnl).toBe(20);
    expect(psm.getSnapshot().totalRealizedPnl).toBe(20);
  });

  test("Zero-crossing flip long->short: hold long 10, sell 15", () => {
    psm.applyFill(createFill("SPY", "buy", 10, 100));
    psm.applyFill(createFill("SPY", "sell", 15, 110));
    const pos = psm.getPosition("SPY")!;
    expect(pos.qty).toBe(-5);
    expect(pos.avgEntryPrice).toBe(110);
    expect(psm.getSnapshot().totalRealizedPnl).toBe(100);
  });

  test("Zero-crossing flip short->long: hold short 10, buy 15", () => {
    psm.applyFill(createFill("SPY", "sell", 10, 100));
    psm.applyFill(createFill("SPY", "buy", 15, 90));
    const pos = psm.getPosition("SPY")!;
    expect(pos.qty).toBe(5);
    expect(pos.avgEntryPrice).toBe(90);
    expect(psm.getSnapshot().totalRealizedPnl).toBe(100);
  });

  test("Commissions: net realizedPnl includes commission", () => {
    // Buy 10 @ 100, commission $5
    psm.applyFill(createFill("SPY", "buy", 10, 100, 5));
    // Sell 10 @ 110, commission $5
    psm.applyFill(createFill("SPY", "sell", 10, 110, 5));
    // Gross PnL = 100. Net PnL = 100 - 10 = 90.
    expect(psm.getSnapshot().totalRealizedPnl).toBe(90);
    expect(psm.getCash()).toBe(INITIAL_CAPITAL + 90);
  });

  test("Multiple symbols isolation", () => {
    psm.applyFill(createFill("SPY", "buy", 10, 100));
    psm.applyFill(createFill("QQQ", "buy", 10, 200));
    
    expect(psm.getPosition("SPY")!.avgEntryPrice).toBe(100);
    expect(psm.getPosition("QQQ")!.avgEntryPrice).toBe(200);
    
    psm.applyFill(createFill("SPY", "sell", 10, 110));
    expect(psm.getSnapshot().totalRealizedPnl).toBe(100);
    expect(psm.getPosition("QQQ")!.qty).toBe(10);
  });
});
