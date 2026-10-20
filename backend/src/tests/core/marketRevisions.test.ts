/**
 * tests/core/marketRevisions.test.ts
 *
 * Updated bars, trade corrections and trade cancels used to be dropped. They
 * now correct symbol state — conservatively — and never re-run strategies,
 * which already acted on the original data.
 */

import { EventBus } from "../../core/engine/eventBus";
import { Orchestrator } from "../../core/engine/orchestrator";
import { SymbolStateManager } from "../../core/state/symbolState";
import { PortfolioStateManager } from "../../core/state/portfolioState";
import { OrderStateManager } from "../../core/state/orderState";
import { RiskEngine } from "../../core/risk/riskEngine";
import { AlpacaMarketDataAdapter } from "../../adapters/alpaca/marketData";
import type { ExecutionEngine } from "../../core/execution/executionEngine";
import type { IStrategy } from "../../strategies/base/strategy";
import type { StrategyType } from "../../types/strategy";
import type { UUID } from "../../types/common";
import type { Fill } from "../../types/orders";
import type { TradingEvent } from "../../types/events";

const BAR_T = "2026-03-10T14:30:00Z";
const bar = (close: number, extra: Record<string, unknown> = {}) =>
  ({ T: "b", S: "SPY", o: 500, h: 502, l: 499, c: close, v: 1_000, t: BAR_T, ...extra });
const trade = (id: number, p: number) => ({ T: "t", S: "SPY", i: id, p, s: 10, x: "V", t: "2026-03-10T14:31:00.5Z" });
const correction = (oi: number, cp: number) => ({ T: "c", S: "SPY", x: "V", oi, op: 500, os: 10, ci: 9_999, cp, cs: 10, t: "2026-03-10T14:31:01Z" });
const cancel = (i: number) => ({ T: "x", S: "SPY", i, x: "V", p: 500, s: 10, a: "C", t: "2026-03-10T14:31:01Z" });

function setup() {
  const bus = new EventBus();
  const symbolState = new SymbolStateManager();
  const portfolio = new PortfolioStateManager(100_000);
  const evaluate = jest.fn().mockReturnValue(null);
  const strategy = {
    id: "s" as UUID, type: "pairs_trading" as StrategyType,
    config: { id: "s" as UUID, name: "s", type: "pairs_trading" as StrategyType, symbols: ["SPY"], rollingWindowMs: 1, maxPositionSizeUsd: 1, cooldownMs: 0, enabled: true },
    start: jest.fn(), stop: jest.fn(), evaluate,
  } as IStrategy;
  const orch = new Orchestrator(bus, symbolState, portfolio, new OrderStateManager(), new RiskEngine(),
    { submit: jest.fn() } as unknown as ExecutionEngine, "paper");
  orch.registerStrategy(strategy);
  orch.start();
  const adapter = new AlpacaMarketDataAdapter(bus, "paper", { invalidData: "quarantine" });
  const send = (...msgs: unknown[]): void => adapter.ingestFrame(JSON.stringify(msgs));
  return { bus, symbolState, portfolio, evaluate, send };
}

describe("market data revisions", () => {
  it("a revised bar replaces the stored bar and its close-derived mid, without re-running strategies", () => {
    const { symbolState, portfolio, evaluate, send } = setup();
    portfolio.applyFill({ id: "f", orderId: "o", symbol: "SPY", side: "buy", qty: 10, price: 500, notional: 5_000, commission: 0, ts: 1, isoTs: "" } as Fill);
    send(bar(501));
    const evaluations = evaluate.mock.calls.length;
    send({ ...bar(501.5), T: "u" });
    expect(symbolState.get("SPY")!.latestBar!.close).toBe(501.5);
    expect(symbolState.get("SPY")!.latestMid).toBe(501.5);
    expect(portfolio.getPosition("SPY")!.currentPrice).toBe(501.5);
    expect(evaluate.mock.calls.length).toBe(evaluations);
  });

  it("does not move a mid that came from a fresher quote", () => {
    const { symbolState, send } = setup();
    send(bar(501));
    send({ T: "q", S: "SPY", bp: 502, ap: 502.02, bs: 1, as: 1, t: "2026-03-10T14:31:05Z" });
    send({ ...bar(499), T: "u" });
    expect(symbolState.get("SPY")!.latestBar!.close).toBe(499);
    expect(symbolState.get("SPY")!.latestMid).toBeCloseTo(502.01, 9);
  });

  it("ignores a revision of a bar that is no longer the latest", () => {
    const { symbolState, send } = setup();
    send(bar(501), { ...bar(503), h: 504, t: "2026-03-10T14:31:00Z" });
    send({ ...bar(400), T: "u" });
    expect(symbolState.get("SPY")!.latestBar!.close).toBe(503);
  });

  it("a correction replaces the latest trade only when it is the corrected print", () => {
    const { symbolState, send } = setup();
    send(trade(7, 500));
    send(correction(6, 400));
    expect(symbolState.get("SPY")!.latestTrade!.price).toBe(500);
    send(correction(7, 501));
    expect(symbolState.get("SPY")!.latestTrade).toMatchObject({ price: 501, id: "9999" });
  });

  it("a cancel clears the latest trade only when it is the cancelled print", () => {
    const { symbolState, send } = setup();
    send(trade(7, 500));
    send(cancel(6));
    expect(symbolState.get("SPY")!.latestTrade).not.toBeNull();
    send(cancel(7));
    expect(symbolState.get("SPY")!.latestTrade).toBeNull();
  });

  it("drops unusable revisions", () => {
    const { bus, send } = setup();
    const seen: TradingEvent["type"][] = [];
    bus.onAll((e) => { seen.push(e.type); });
    send({ ...bar(501), T: "u", h: 1 }, { ...correction(1, 0) }, { T: "x", S: "SPY", t: "bad" });
    expect(seen).toEqual([]);
  });
});
