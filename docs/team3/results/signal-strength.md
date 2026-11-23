# Team 3: signal strength and RSI lens (offline, in-sample, 2026-11-23)

In-sample only (2026-09-01 → 10-15, 32 days). No backtests were run, and no day from 10-16 on was read. Script: `backend/src/runtime/team3Analysis/signalStrength.ts`, which writes `tmp/team3-data/signal-strength.json`. Test: `backend/src/tests/strategy/team3Reversal/signalStrength.test.ts`.

## Method
- **Trades** come from the engine dumps, re-costed from their bars (entry and exit at the next raw open, the dump's own qty, protocol costs). The re-costing matches every engine row to the cent: V4, F1, F3, C3, L2 and L5, on both universes.
- **Variants** are run with `walkSymbol`, the engine-feasible one-position walker. Its parity is exact: F1 32/32, F3 31/31, L2 29/29 and V4 370/370 on Momentum, and F1 14/14, F3 29/29, L2 13/13 and V4 419/419 on Core.
- bps/trade is sum net $ / traded notional, as the runner computes it.
- **CI:** a day-clustered bootstrap with 5,000 resamples of whole days.
- **t-stat:** on per-trade net bps.
- **Deflated Sharpe** (Bailey and López de Prado): daily $ P&L over all 32 days (0 on days with no trade). SR0 is the expected maximum of N zero-skill trials, with Var(SR) ≈ 1/(T−1).
- **Selection null:** random subsets of the opportunity set (1.5 ≤ |z| < 3.5, entry window, no SPY), walked engine-feasibly. The acceptance rate is tuned so the walk lands on the candidate's trade count. 1,000 draws.
- **RSI:** Wilder RSI on session 1-minute closes, restarting each day. RSI at bar i uses closes up to and including bar i; it equals `computeRSI(closes[0..i])` exactly, and the test checks this.
  - "Stretch-side RSI" = RSI for z > 0, 100 − RSI for z < 0, so high means extreme in the stretch's direction.
  - Bins: RSI(2) ≥ 90 / ≤ 10, RSI(5) ≥ 80 / ≤ 20, RSI(14) ≥ 70 / ≤ 30. These are "extreme" (with the stretch), "counter" and "mid".
  - **Divergence (DIV14):** over the prior 30 bars of the day, price makes a new extreme in the stretch direction while RSI(14) does not. "Confirmed" means both make a new extreme. "noNewExtreme" means price makes none.
  - **PIN14:** stretch-side RSI(14) ≥ 70 for ≥ 5 bars in a row.
  - **ADX(14):** per session, `WilderAdx`.

## Groups tested: **126** in this study
Momentum-side count; Core reruns the same variants as the control.

| Kind | Count |
|---|---|
| F3 bin-edge grid (|z| cut × crossings × SPY band) | 27 |
| F1 grid at hold 30 (crossings × SPY threshold) | 9 |
| F1 grid at hold 150 (L2 neighbourhood) | 9 |
| F1 hold neighbours (90/120/150/180) | 4 |
| Decomposition (crossings only, each signal without crossings, …) | 5 |
| RSI/DIV/PIN/ADX bins inside F1, F3 and V4 trades | 15 + 16 + 15 |
| The same bins inside the opportunity set | 17 |
| Engine-feasible RSI rules | 9 |

Running total of selection: 27 configs + 1,309 survey groups + 126 here. No config was spent.

## 1. Strength (Momentum; Core in brackets)
| | Trades | Net bps (agg) | Gross bps | t | Day-clustered 95% CI | Halves | Top 1 / top 2 day share of net $ | Top symbol share | LOSO worst | LODO worst | Drop top 2 days |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F1 | 32 [14] | **+7.14** [−6.57] | 20.8 | 0.75 | −10.4 … +30.9 | +33.6 / −11.7 | 0.71 / 1.40 | META 1.30 | −2.74 (no META) | +2.13 | −3.16 |
| F3 | 31 [29] | **+4.75** [+5.09] | 17.6 | 0.28 | −10.3 … +20.6 | +7.3 / +3.1 | 0.90 / 1.63 | TSLA 0.70 | +1.65 (no TSLA) | +0.52 | −3.31 |
| C3 | 258 [217] | −5.25 [−12.06] | 6.2 | −2.19 | −11.4 … +0.4 | +1.2 / −11.0 | n/a (loses) | n/a | −6.45 | −6.75 | −7.52 |
| L2 | 29 [13] | **+14.27** [+1.77] | 27.7 | 1.28 | −9.4 … +40.4 | +44.5 / −11.1 | 0.39 / 0.77 | META 0.52 | +8.63 (no META) | +9.01 | +3.66 |
| L5 (L2 at 120) | 29 [13] | +10.15 [+1.57] | 23.5 | 0.71 | −21.9 … +40.2 | +47.2 / −21.0 | 0.55 / 1.08 | META 0.84 | +2.07 | +4.74 | −0.95 |

- Every candidate's CI contains 0, and no t-stat reaches 1.3.
- F1's edge is META plus two days: without META it turns negative, and without its top 2 days so does F3's.
- L2 is the only one that survives LOSO, LODO and dropping its top 2 days. But its second half is −11, and Core is +1.77 on just 13 trades.
- Core: F3's CI is −11.8 … +22.5, with Core LODO worst −1.47.

**Deflated Sharpe** (daily, annualized; SR0 = 5.79 at N = 27 and 9.50 at N = 1,309):

| | SR ann. (Mom) | DSR N=1 | DSR N=27 | DSR N=1,309 | Core SR ann. |
|---|---|---|---|---|---|
| F1 | 2.08 | 0.78 | 0.08 | 0.00 | −1.90 |
| F3 | 1.67 | 0.72 | 0.07 | 0.00 | 1.54 |
| L2 | 3.35 | 0.86 | 0.22 | 0.03 | 0.41 |
| C3 | −4.90 | 0.04 | 0.00 | 0.00 | −12.29 |

None comes close to DSR 0.95 even at N = 27.

**Selection null** (random opportunity subsets at the same trade count):

| | Universe | Null mean | Null p95 / p99 | P(random ≥ observed) | Best of 27 | Best of 1,309 |
|---|---|---|---|---|---|---|
| F1 +7.14 (32) | Mom | −13.1 | +0.7 / +6.1 | 0.01 | 0.22 | ≈1 |
| F3 +4.75 (31) | Mom | −12.8 | +2.1 / +6.8 | 0.03 | 0.52 | ≈1 |
| F3 +5.09 (29) | Core | −13.3 | −4.7 / −0.8 | <0.001 | 0.03 | 0.73 |

- Against one random draw, both candidates beat the opportunity set, which loses about −13 bps.
- Against the best of the 1,309 surveyed groups, a +5 to +7 result is what selection alone produces. This assumes independent draws, so it overstates the effect somewhat.
- F3's Core result is the only one that isn't explained by selection at N = 27. Core was not used to select F3 (the selection was Momentum-led), so this is the most informative number here.

**Bin-edge sensitivity** (Momentum net bps, n; Core in brackets). F3 = |z| > cut, crossings, |zSPY| < band:

| F3 cut \ crossings, band 0.8 / 1.0 / 1.2 | 0–2 | **1–2** | 1–3 |
|---|---|---|---|
| 1.752 (−10%) | −11.1 / −10.9 / −10.9 | −6.7 / −8.0 / −5.5 | −6.0 / −4.0 / −2.6 |
| **1.947** | −5.9 / −2.4 / −4.6 | **+5.5 (27) / +4.75 (31) / +2.7 (39)** [+9.1 / +5.1 / +8.4] | +3.6 / +6.3 / +5.0 [+1.6 / −1.5 / +1.8] |
| 2.142 (+10%) | −15.5 / −12.8 / −10.8 | −10.5 / −12.8 / −2.0 [+4.5 / +5.2 / +7.4] | −5.8 / −8.3 / +1.8 |

**F3 is a spike in |z|.** Moving the cut 10% either way makes Momentum negative in every cell, and letting 0 crossings in also makes it negative. The SPY band is a plateau (0.8–1.2 are all positive at the frozen cut), and so is crossings 1–3. On Core the positive area is wider: the 1–2 column holds at 1.947 and 2.142.

| F1, SPY ≥ θ opposite: crossings \ θ 0.8 / 1.0 / 1.2 | hold 30 | hold 150 (L2) |
|---|---|---|
| 0–2 | −1.3 / +0.0 / −1.7 | −1.0 / +6.6 / +10.9 |
| **1–2** | +3.3 / **+7.1** / +6.9 [Core −10.1 / −6.6 / −8.3] | +8.6 / **+14.3** / +21.8 [Core −2.0 / +1.8 / −2.0] |
| 1–3 | −1.3 / +6.0 / +2.0 | +5.2 / +14.2 / +15.3 [Core +3.9 / +7.3 / +6.1] |

- F1 at hold 30 is a narrow ridge.
- At hold 150 the Momentum result is a plateau over θ ≥ 1 and crossings 1–3. Hold 90/120/150/180 gives +8.5 / +10.2 / +14.3 / +17.5, a smooth rise rather than a spike. Every cell's second half is still negative except θ = 1.2.
- Core is flat to negative.

**F1 vs F3 overlap and decomposition:**
- 0 shared trades on both universes. This is by construction: SPY opposite (|zSPY| ≥ 1) and SPY neutral (< 1) are disjoint. They share 11 of their trade days on Momentum.
- The crossings condition alone does not carry the edge:

| Momentum (Core) | n | Net bps |
|---|---|---|
| Opportunity set | 694 (769) | −12.9 (−13.7) |
| Crossings 1–2 only | 169 (161) | −10.3 (−10.8) |
| F1 without crossings | 109 (74) | −1.8 (−7.2) |
| F3 without crossings | 141 (154) | −5.9 (−14.2) |
| F3 without SPY (|z| > 1.947 & 1–2) | 83 (84) | −3.8 (−3.3) |

Crossings alone gains only about 2.6 bps. The SPY condition is worth about 11 bps for F1. Each edge comes from the combination: neither part is positive alone.

## 2. RSI as a lens
**Redundancy.**
- On the opportunity set, corr(RSI14, z) = **0.87** on both universes. RSI5 is 0.72–0.73 and RSI2 is 0.52.
- Stretch-side RSI vs |z|: RSI14 0.40–0.43, RSI2 0.22–0.23.
- Stretch-side RSI vs crossings60 is 0.14–0.21, and |RSI − 50| vs crossings is 0.07–0.16. So RSI is not a read on crossings.
- Overlap on the opportunity set: P(RSI14 extreme | |z| ≥ 2) = 0.41 / 0.38 and P(|z| ≥ 2 | RSI14 extreme) = 0.49 / 0.55 (Jaccard 0.28 / 0.29). RSI2's Jaccard is 0.24 / 0.27.
- **Plainly: RSI(14) is mostly z again.** RSI(2) is less redundant, but it's mostly noise.

**Conditional edge, opportunity set** (all bars, baseline exit, overlapping; net = gross − 14.2). Mom n / net (Core):

| Bin | RSI2 | RSI14 | DIV14 |
|---|---|---|---|
| extreme / divergence | 2,610 / −12.1 (−13.4) | 2,039 / −13.5 (−12.0) | 1,540 / −13.4 (−11.8) |
| mid / confirmed | 6,564 / −13.2 (−13.2) | 7,454 / −12.7 (−13.6) | 1,478 / −11.3 (−12.6) |
| counter / no new extreme | 319 / −11.7 (−12.7) | | 6,475 / −13.1 (−13.7) |

- All of the opportunity set is at −12.8 (−13.2). No bin moves the mean by more than 1.6 bps.
- On Momentum, every bin's circular-shift p ≥ 0.31. On Core, one ADX bin has circular-shift p = 0.04, but it's the "na" bin (ADX not yet available).
- PIN14 is −14.2 vs −12.7 (Core −11.0 vs −13.4, opposite signs).
- ADX ≥ 30 on Momentum is −14.5 (Core −11.7, opposite).

**Inside trade sets** (net bps, n; label-shuffle p):

| Split | V4 Mom (370) | F1 Mom (32) | F3 Mom (31) | F3 Core (29) |
|---|---|---|---|---|
| RSI14 extreme / mid | −9.6 / −9.5 (p 0.97) | +16.9 (9) / +3.4 (p 0.5) | −2.6 (16) / +12.8 (p 0.55) | **+35.5 (10) / −10.7 (p 0.00)** |
| RSI2 extreme / mid | −9.1 / −11.6 | +14.8 (16) / −0.5 | +2.9 (23) / +2.3 | +12.6 (12) / +0.7 |
| DIV14 divergence / confirmed / none | −10.9 / −10.1 / −3.3 | +22.4 (8) / +8.5 (11) / −3.4 (13) | −17.6 (11) / +11.1 (14) / +30.6 (6) | −4.5 (3) / +20.3 (14) / −10.5 (12) |

- The one significant cell (F3 Core, RSI14 extreme) has the opposite sign on F3 Momentum (−2.6 extreme vs +12.8 mid). It's one of about 90 trade-set bins (46 per universe), so a few such cells are expected by chance.
- In V4's 370 trades no RSI bin differs (p ≥ 0.19).

**The hypothesis (divergence = exhaustion, pinned = trend running) is not supported.**
- In the opportunity set, divergence bars do no better than confirmed ones: Mom −13.4 vs −11.3, Core −11.8 vs −12.6.
- Inside F3 it's the reverse: divergence −17.6 and confirmed +11.1 on Momentum, and confirmed is best on Core.
- Pinned RSI is not worse on Core.
- ADX gives no consistent trend-strength split.

**Engine-feasible RSI rules vs the amendment minimums** (≥ 30 Mom trades, Core same sign, both halves ≥ 0):

| Rule | Mom n / net | Halves | Core n / net | Verdict |
|---|---|---|---|---|
| opp & DIV14 = divergence | 417 / −11.9 | −9.5 / −14.3 | 436 / −12.9 | fails |
| opp & DIV14 = confirmed | 471 / −12.6 | | 528 / −14.1 | fails |
| opp & crossings 1–2 & not pinned | 164 / −10.4 | | 156 / −10.0 | fails |
| opp & RSI2 extreme | 595 / −12.6 | | 652 / −13.8 | fails |
| opp & RSI14 mid | 625 / −11.5 | | 696 / −13.9 | fails |
| opp & crossings 1–2 & divergence | 97 / −10.5 | | 88 / −10.0 | fails |
| opp & crossings 1–2 & ADX < 20 | 43 / −1.4 | +7.6 / −7.9 | 40 / −14.1 | fails |
| F3 & DIV14 ≠ confirmed | 19 / −6.4 | | 20 / −6.7 | fails (n) |
| F1 & DIV14 ≠ confirmed | 30 / +9.4 | +39.5 / −11.5 | 12 / −13.6 | fails (Core sign, half) |

No RSI rule meets the minimums. The only positive one is F1 again with its "confirmed" trades removed, and it fails Core and the second half.

## 3. Recommendation: **(b) move to Stage 3. Freeze F3 and L2.**
- **Don't spend a reserve config on RSI.**
  - RSI(14) is about 0.87 correlated with z on the opportunity set.
  - No bin moves the opportunity-set edge by more than about 1.6 bps, and divergence works in the wrong direction inside F3.
  - None of the 9 feasible rules passes the minimums.
  - One more in-sample RSI config would add selection cost (126 more groups looked at here) with no lead to follow.
- **F3:** it's the only candidate positive on both universes with both halves ≥ 0 on each, and it survives LOSO (+1.65).
  - Its Core result is the only number here that beats the selection null at N = 27 (p ≈ 0.03).
  - Weakness: it's a spike in the |z| cut (±10% turns Momentum negative), and t is just 0.28. Freeze it exactly as run (`absZ (1.947, ∞)`, `crossings60 (0, 2]`, SPY neutral < 1σ).
- **L2 (F1 + hold 150):** it has the strongest Momentum result (+14.3, t 1.28, DSR 0.22 at N = 27). It's the only candidate that survives LOSO, LODO and dropping its top 2 days.
  - Its hold and SPY-threshold neighbourhood at hold 150 is a smooth plateau, not a spike. Hold 120 is +10.2 on Momentum and fails the true test only on share and halves.
  - Weakness: the second half is −11 and Core is +1.8 on 13 trades.
  - Prefer L2 over F1 at hold 30: F1 hold 30 depends on META and its top 2 days, and it's negative on Core.
- **Drop C3 from Stage 3** as a candidate: its CI is −11.4 … +0.4 on Momentum and −17.3 … −6.8 on Core. It's already shown to lose, so the OOS run would tell us nothing new. Report it as the in-sample reference.
- **Expectations for Stage 3:** about 20 OOS trading days gives roughly 15–20 trades per candidate. Against a per-trade SD of 50–70 bps, the standard error is 12–17 bps, so the OOS run can refute a large edge but can't confirm a 5–14 bps one. Report the result whatever it is.
