/**
 * tests/strategy/cointHysteresis.test.ts
 *
 * Covers the deadband that stops the Engle-Granger gate from flapping.
 *
 * Regression context — in the XOM/CVX run on 10 Sept 2026 the test statistic
 * settled almost exactly on the 5% critical value (-3.3377) and then jittered
 * by a few thousandths per recalculation, producing dozens of alternating
 * "lost cointegration" / "regained cointegration" log pairs within milliseconds.
 * Each flip also froze or released the hedge-ratio update, stuttering beta.
 */

import { applyCointHysteresis } from "../../strategies/pairs/pairsStrategy";
import { DEFAULT_COINT_HYSTERESIS } from "../../strategies/pairs/pairsConfig";

const CV = -3.3377; // MacKinnon 5% critical value, bivariate with intercept
const BAND = DEFAULT_COINT_HYSTERESIS;

describe("applyCointHysteresis", () => {
  describe("entering cointegration", () => {
    it("requires tau to clear the threshold by the full band", () => {
      // Just past the bare threshold but inside the deadband — not enough.
      expect(applyCointHysteresis(false, CV - 0.01, CV, BAND)).toBe(false);
      // Clear of the deadband — accept.
      expect(applyCointHysteresis(false, CV - BAND - 0.01, CV, BAND)).toBe(true);
    });
  });

  describe("leaving cointegration", () => {
    it("requires tau to fall short of the threshold by the full band", () => {
      // Marginally worse than the bare threshold — hold the previous verdict.
      expect(applyCointHysteresis(true, CV + 0.01, CV, BAND)).toBe(true);
      // Clearly worse — drop it.
      expect(applyCointHysteresis(true, CV + BAND + 0.01, CV, BAND)).toBe(false);
    });
  });

  it("holds its previous verdict anywhere inside the deadband", () => {
    // The same tau yields different answers depending on prior state — that
    // asymmetry is the whole point of hysteresis.
    const tauInsideBand = CV + 0.05;
    expect(applyCointHysteresis(true, tauInsideBand, CV, BAND)).toBe(true);
    expect(applyCointHysteresis(false, tauInsideBand, CV, BAND)).toBe(false);
  });

  it("does not flap across the exact sequence observed in the XOM/CVX run", () => {
    // Verbatim tau values from the production log, which alternated on every recalc.
    const observed = [
      -3.341, -3.336, -3.339, -3.336, -3.341, -3.337, -3.340, -3.334,
      -3.363, -3.333, -3.358, -3.336, -3.339, -3.337, -3.341, -3.332,
    ];

    let state = false;
    let flips = 0;
    for (const tau of observed) {
      const next = applyCointHysteresis(state, tau, CV, BAND);
      if (next !== state) flips++;
      state = next;
    }

    // Every one of these sits inside the deadband, so the verdict must never move.
    expect(flips).toBe(0);

    // Sanity check that the old behaviour really did flap on this same input,
    // so the test would catch a regression that removed the band.
    let bare = false;
    let bareFlips = 0;
    for (const tau of observed) {
      const next = applyCointHysteresis(bare, tau, CV, 0);
      if (next !== bare) bareFlips++;
      bare = next;
    }
    expect(bareFlips).toBeGreaterThan(5);
  });

  it("still reacts to a genuine regime change", () => {
    // A real breakdown moves tau by several tenths, well outside the band.
    let state = true;
    state = applyCointHysteresis(state, -2.161, CV, BAND); // observed post-break value
    expect(state).toBe(false);

    state = applyCointHysteresis(state, -3.988, CV, BAND); // observed strong value
    expect(state).toBe(true);
  });

  it("band of 0 reproduces the original bare-threshold comparison", () => {
    expect(applyCointHysteresis(false, CV - 0.001, CV, 0)).toBe(true);
    expect(applyCointHysteresis(true, CV + 0.001, CV, 0)).toBe(false);
  });
});
