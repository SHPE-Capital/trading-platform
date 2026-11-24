# Team 3 Stage 2: final result (in-sample, before Stage 3)

All numbers are in-sample (2026-09-01 → 10-15, 32 days), Momentum main and Core control. The protocol's round-trip cost is about 14.2 bps per trade. Ledger: [ablation.md](../ablation.md). Background: [why-individual.md](why-individual.md), [combination.md](combination.md), [strategy-survey.md](strategy-survey.md).

## 1. The honest result
| Config | Momentum net $ | Trades | Net bps/trade | Edge before costs (bps/trade) | Core net $ (bps/trade) |
|---|---|---|---|---|---|
| V4 baseline (A04 / A03) | −1,647.82 | 370 | −9.52 | +4.70 | −3,048.74 (−15.32) |
| **C3** stack: relativeToSpy 0.7 + crowd split | −495.93 | 258 | −5.25 | +8.98 | −1,020.26 (−12.06) |
| **F1** SPY divergence (survey candidate 1) | **+107.16** | 32 | **+7.14** | ≈ +21 | −44.64 (−6.57), 14 trades |
| F2 own-share + quiet day (survey candidate 2) | −307.55 | 104 | −6.21 | ≈ +8 | −1,213.82 (−14.40) |

- **Tuning closes part of the cost gap but doesn't make the strategy profitable.** C3, the best stack built one condition at a time, closes about 45% of Momentum's edge gap: the gap between edge before costs and cost went from 9.5 to 5.2 bps. It still loses money. Each kept part lowers costs and losses: relativeToSpy picks stock-specific stretches, and crowd split moves size away from crowded minutes (about half of its dollar gain is just smaller bets; see C3b).
- **Combining conditions found one in-sample winner, on too little data to trust.** F1 enters when the stock is stretched while SPY is stretched the other way, on a day with only 1–2 VWAP crossings. It's the only config whose edge clearly beats costs. But it has 32 trades on 18 days, the top 2 days carry 73% of its edge before costs, Core is negative on 14 trades, and it's the best of 1,309 surveyed groups.
- **Trials:** 21 strategy configs (D/V rows and duplicates excluded). The luck-only best IS Sharpe at N ≈ 30, T = 32 is about **5.8** annualized. F1's daily Sharpe should be read against that bar, not against 0.
- **Rejected by the size-neutral true test:** `entryZ` 2.5 (Core gets worse per trade), stop off (Core contradicts), F2 (no better than C3).

## 2. What would have flipped it to profitable
A trade makes money only when **edge before costs > round-trip cost**.

| Lever | Finding |
|---|---|
| **Cost** | C3 breaks even at a round trip of about **9 bps**, about 0.63× the protocol's 14.2 bps (net = gross − cost; gross +8.98). That's within reach of a limit-order or maker execution model, but a fill-probability model would be needed to claim it. V4 would need about 4.7 bps. F1 has about 7 bps of slack at the current cost. |
| **Fill timing** | **Not the leak.** Entry fill (next bar's open) vs the signal bar's close, in the fade direction, averages **−0.0 bps** (V4 Momentum 370 trades; Core −0.04; C3 −0.05) in the zero-cost dumps. On 1-minute bars the next open is the signal close. |
| **Capture** | 75% of baseline trades end on the 30-bar time stop, and only about 16–20% reach VWAP. Kept rows raised the reversion share only a little (C3 19.8%). The edge is in *which* stretches revert (F1's target exits average +59 bps gross), not in *how* exits are timed. Exit rules (R4) didn't help. |
| **Selection (conditions together)** | The one lever that moved edge per trade by a large amount (F1). It needs out-of-sample confirmation before it means anything. |

## 3. Phase 2 (designs only, not run)
- **5-minute bars:** stretches are larger relative to the fixed cost per trade. This needs a `barMinutes` resample in `history.ts` and the bar-count knobs scaled; changing the setup is a new protocol, not tuning.
- **Limit-order execution:** the most direct cut to the 14 bps round trip, and real engineering (queue position, fill probability).

## 4. What goes to Stage 3 (the lead decides)
Stage 3 runs once, out-of-sample (2026-10-16 → 11-20), on configs frozen and logged before the run. Suggested: **C3** (the defensible stack) and **F1** (the survey hypothesis), both declared up front. Any OOS result is reported, including a loss.

## 5. Addendum: F3 (2026-11-23)
- **Offline evaluation** ([signal-eval.md](signal-eval.md)): the engine-feasible simulator reproduces F1, F2 and V4 exactly. No survey group met the pre-registered rule. Under a relaxed trade minimum, the lead picked **F3** (|z| > 1.947, 1–2 VWAP crossings, SPY within 1σ).
- **F3:** Momentum **+$69** (+4.75 bps/trade, 31 trades); Core **+$71** (+5.09, 29 trades). It's the only signal positive on both universes.
- **Trials:** 22 strategy configs. The paper's honest story doesn't change: the tuned parts make losses and costs smaller; small condition sets beat costs in-sample on about 30 trades, and only the out-of-sample run can tell whether that's real.

## 6. Addendum: hold length (L series, 2026-11-23)
- **Offline sweep** ([hold-sweep.md](hold-sweep.md)), with entries fixed and parity exact at 30.
  - Many time-stopped trades do reach VWAP later: 114 of V4 Momentum's 283 do before the close.
  - But the ones that don't drift further, so V4 and C3 don't improve at any hold from 35 to 180.
- **Backtests on the working candidates** (F1, F3), pre-registered from the sweep:
  - F1 at 150 bars passes the true test (Momentum +$195, +14.27 bps/trade, share 0.88; Core +1.77).
  - Its pre-registered neighbour at 120 fails (share 0.64, the halves disagree), so the gain is a fragile peak.
  - F3 at 45 and at 90 fails.
- **Trials:** 27 strategy configs; 3 stay in reserve.
