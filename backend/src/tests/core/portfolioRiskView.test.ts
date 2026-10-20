/**
 * tests/core/portfolioRiskView.test.ts
 *
 * Audit finding 3: the per-event proactive portfolio check built a full
 * snapshot (UUID + ISO timestamp) on every quote. It now reads a lightweight
 * risk view, which must agree with the snapshot exactly — the kill switch must
 * fire on the same quote as before.
 */

import { PortfolioStateManager } from "../../core/state/portfolioState";
import { RiskEngine } from "../../core/risk/riskEngine";
import { seededRandom } from "../../bench/random";
import type { Fill } from "../../types/orders";

const fill = (symbol: string, side: "buy" | "sell", qty: number, price: number): Fill =>
  ({ id: "f", orderId: "o", symbol, side, qty, price, notional: qty * price, commission: 0.01, ts: 1, isoTs: "" }) as Fill;

describe("PortfolioStateManager.getRiskView", () => {
  it("matches getSnapshot's equity and positions bit for bit across random histories", () => {
    const rand = seededRandom(17);
    const p = new PortfolioStateManager(100_000);
    const symbols = ["SPY", "QQQ", "IWM", "AAPL"];
    for (let i = 0; i < 2_000; i++) {
      const sym = symbols[Math.floor(rand() * symbols.length)];
      const price = 100 + rand() * 400;
      if (rand() < 0.2) p.applyFill(fill(sym, rand() < 0.5 ? "buy" : "sell", 1 + Math.floor(rand() * 20), price));
      else p.updatePrice(sym, price);
      const view = p.getRiskView();
      const snap = p.getSnapshot();
      expect(view.equity).toBe(snap.equity);
      expect(view.positions).toEqual(snap.positions);
      expect(view.cash).toBe(snap.cash);
      expect(view.initialCapital).toBe(snap.initialCapital);
    }
  });

  it("gives the risk engine the same verdicts as a snapshot, including the kill switch", () => {
    const viaView = new RiskEngine({ maxIntradayDrawdownPct: 0.05, maxGrossExposurePct: 3 });
    const viaSnap = new RiskEngine({ maxIntradayDrawdownPct: 0.05, maxGrossExposurePct: 3 });
    const p = new PortfolioStateManager(100_000);
    p.applyFill(fill("SPY", "buy", 200, 500));
    for (const price of [500, 490, 480, 470, 460, 450, 440]) {
      p.updatePrice("SPY", price);
      expect(viaView.checkPortfolio(p.getRiskView())).toEqual(viaSnap.checkPortfolio(p.getSnapshot()));
    }
    expect(viaView.isKillSwitchActive()).toBe(true);
    expect(viaSnap.isKillSwitchActive()).toBe(true);
  });

  it("isKillSwitchActive tracks setKillSwitch", () => {
    const r = new RiskEngine();
    expect(r.isKillSwitchActive()).toBe(false);
    r.setKillSwitch(true);
    expect(r.isKillSwitchActive()).toBe(true);
    expect(r.getConfig().killSwitchActive).toBe(true);
  });
});
