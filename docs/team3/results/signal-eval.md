# Signal evaluation (Step 2): F3–F5 selection

Offline, in-sample (2026-09-01 → 2026-10-15) dumps only. No backtests, no strategy/rule/config changes. Rule: [ablation.md](../ablation.md) "Signal series F3–F5" (pre-registered). Code: `backend/src/runtime/team3Analysis/evaluate.ts` (run from `backend/`: `npx ts-node --transpile-only src/runtime/team3Analysis/evaluate.ts`; writes `tmp/team3-data/eval-results.json`, gitignored). Tests: `backend/src/tests/strategy/team3Reversal/team3Evaluate.test.ts`.

## Result in one line

**No candidate qualifies, so no F3–F5 is selected.** Under the one-position rule only 5 of the 19 candidates reach 60 Momentum trades, and all 5 lose money (net) in the second half. The groups with the best net bps/trade all have 17–38 Momentum trades.

## Simulation

- Per symbol, in time order, one position at a time. A new entry is allowed from the bar after the previous trade's exit signal bar (the exit fills at that bar's open, and the engine decides on the same bar).
- Entry fill: next raw bar's open. Exits: the baseline `simulateExit` (VWAP target, stopZ 3.5, maxHoldBars 30, flatten 5 min before close).
- Costs: price × (1 ± 5 bps) × (1 ± 2 bps) on each side. The engine applies the two steps multiplicatively (fill / open = 1.00070010), not as a flat 7 bps. Commission $0.005/share per side; shares = floor(5000 / signal close).
- bps/trade = Σ net $ / traded notional (half of all fill notional), the same as `team3Backtest.ts`.
- SPY is never traded under the F/group entry modes. V4 (used for the check and the sweep) trades all six symbols, as the engine does.
- Opportunity set: 1.5 ≤ |z| < 3.5, edge ≥ 0, entry window (after 15 min, not in the last 15 min), not the session's first bar, side from z (z > 0 sells).
- Bars come from the F1 dump of each universe (every dump has all of the universe's bars). Dump `entryTs` = decision bar ts + 60,000 ms.

## Validation against the engine runs

Every trade matches the engine on symbol, entry time, exit time and entry fill. Net $ matches to the cent.

| Run | Universe | Engine trades | Sim trades | Matched (symbol + entry ts) | Exit ts match | Entry fill match | Engine net bps | Sim net bps | Engine net $ | Sim net $ |
|---|---|---|---|---|---|---|---|---|---|---|
| F1 `2a628992` | Momentum | 32 | 32 | 32 | 32 | 32 | +7.14 | +7.14 | 107.16 | 107.16 |
| F1 `9756c285` | Core | 14 | 14 | 14 | 14 | 14 | −6.57 | −6.57 | −44.64 | −44.64 |
| F2 `952a5479` | Momentum | 104 | 104 | 104 | 104 | 104 | −6.21 | −6.21 | −307.55 | −307.55 |
| F2 `d349db3d` | Core | 176 | 176 | 176 | 176 | 176 | −14.40 | −14.40 | −1213.82 | −1213.82 |
| V4 `bab63751` (extra check) | Momentum | 370 | 370 | 370 | 370 | 370 | −9.52 | −9.52 | −1647.82 | −1647.82 |
| V4 `5a7cd486` (extra check) | Core | 419 | 419 | 419 | 419 | 419 | −15.32 | −15.32 | −3048.74 | −3048.74 |

F1 here is the engine rule: SPY |z| ≥ 1 with the opposite sign, and VWAP crossings over 60 bars in 1..2. F2 is own share > 0.945 and day move ≤ 47.1 bps.

## Ranking

- **Candidates:** the 26 flagged set (b) groups, minus F1's group (`crossings60=1-2 & spySameSide=no`), minus F2's group (`ownShare>0.945 & trendBps<=47.1`), minus the 5 groups that contain `crowded=yes`. That leaves **19**.
- **To qualify:** ≥ 60 Momentum trades; best day ≤ 30% of the Momentum gross edge sum; both Momentum halves ≥ 0 net; Core net bps with the same sign as Momentum.
- **Halves:** 09-01 → 09-23 and 09-24 → 10-15.
- **Net and gross:** both are bps/trade. Gross is the next-open to next-open move with no costs.
- **Sort:** by Momentum net bps/trade.

| # | Group | Mom trades | Mom net | Mom gross | Mom H1 / H2 net (n) | Mom days | best day % | Core trades | Core net | Core gross | Core H1 / H2 net | Misses |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | crossings60=1-2 & spySameSide=no (SPY opposite, zSPY >= 1) & trendBps=> 111.1 | 18 | 20.90 | 34.46 | 46.11 (10) / -12.15 (8) | 12 | 26.9 | 2 | -20.48 | -6.45 | 56.22 / -97.20 | Mom trades < 60; a Mom half < 0; Core sign differs |
| 2 | absZ=1.674 - 1.947 & crossings60=1-2 & spySameSide=no (SPY opposite, zSPY >= 1) | 21 | 17.79 | 32.44 | 36.49 (8) / 5.84 (13) | 12 | 25.2 | 8 | -1.32 | 12.97 | 8.10 / -4.44 | Mom trades < 60; Core sign differs |
| 3 | crossings60=1-2 & spySameSide=neutral (SPY within 1 sigma) & trendBps=<= 47.1 | 19 | 12.67 | 26.87 | 9.55 (10) / 16.16 (9) | 15 | 26.7 | 26 | -5.45 | 8.73 | 2.13 / -15.84 | Mom trades < 60; Core sign differs |
| 4 | absZ=> 1.947 & spySameSide=no (SPY opposite, zSPY >= 1) | 38 | 7.00 | 20.02 | 27.40 (20) / -16.72 (18) | 23 | 21.8 | 30 | 3.75 | 18.12 | 11.43 / -2.18 | Mom trades < 60; a Mom half < 0 |
| 5 | crossings60=1-2 & spySameSide=no (SPY opposite, zSPY >= 1) & trendBps=47.1 - 111.1 | 17 | 4.81 | 18.85 | 15.51 (7) / -3.10 (10) | 12 | 26.1 | 5 | -6.77 | 7.50 | -9.35 / -2.99 | Mom trades < 60; a Mom half < 0; Core sign differs |
| 6 | absZ=> 1.947 & crossings60=1-2 & spySameSide=neutral (SPY within 1 sigma) | 31 | 4.75 | 17.56 | 7.34 (12) / 3.05 (19) | 16 | 29.7 | 29 | 5.09 | 18.98 | 8.27 / 1.17 | Mom trades < 60 |
| 7 | volRatio=> 1.113 & spySameSide=no (SPY opposite, zSPY >= 1) | 78 | 3.24 | 16.66 | 13.16 (36) / -5.42 (42) | 27 | 22.4 | 43 | -5.84 | 8.57 | -2.45 / -7.85 | a Mom half < 0; Core sign differs |
| 8 | absZ=<= 1.674 & crossings60=1-2 & spySameSide=no (SPY opposite, zSPY >= 1) | 27 | 1.90 | 15.98 | 17.40 (10) / -7.44 (17) | 16 | 28.7 | 10 | -12.66 | 1.53 | 15.06 / -24.20 | Mom trades < 60; a Mom half < 0; Core sign differs |
| 9 | absZ=> 1.947 & spySameSide=neutral (SPY within 1 sigma) & trendBps=<= 47.1 | 35 | 1.45 | 15.94 | 0.84 (21) / 2.38 (14) | 21 | 24.5 | 70 | -15.78 | -1.58 | -14.59 / -16.91 | Mom trades < 60; Core sign differs |
| 10 | turnBar=no & spySameSide=no (SPY opposite, zSPY >= 1) | 103 | -0.31 | 12.92 | 10.21 (42) / -7.70 (61) | 29 | 21.9 | 70 | -7.05 | 7.25 | -1.61 / -10.67 | a Mom half < 0 |
| 11 | absZ=1.674 - 1.947 & spySameSide=no (SPY opposite, zSPY >= 1) & trendBps=47.1 - 111.1 | 28 | -0.81 | 12.16 | 24.97 (12) / -20.75 (16) | 17 | 27.6 | 20 | -1.23 | 13.26 | -3.58 / 0.36 | Mom trades < 60; a Mom half < 0 |
| 12 | ownShare=> 0.945 & spySameSide=no (SPY opposite, zSPY >= 1) | 105 | -1.38 | 11.61 | 7.31 (46) / -8.31 (59) | 30 | 23.9 | 70 | -6.72 | 7.60 | -0.24 / -11.27 | a Mom half < 0 |
| 13 | crossings60=1-2 & timeOfDay=late 13:45-15:44 | 32 | -1.66 | 11.67 | 4.32 (16) / -7.91 (16) | 16 | 44.6 | 17 | 17.83 | 31.93 | 22.24 / 3.06 | Mom trades < 60; best day > 30%; a Mom half < 0; Core sign differs |
| 14 | rangeSigma=> 0.317 & spySameSide=no (SPY opposite, zSPY >= 1) | 93 | -1.83 | 10.85 | 7.79 (41) / -9.61 (52) | 29 | 28.8 | 61 | -4.78 | 9.59 | 5.07 / -11.15 | a Mom half < 0 |
| 15 | spySameSide=no (SPY opposite, zSPY >= 1) & stretchRun=5-16 | 48 | -2.24 | 10.41 | 9.97 (21) / -11.90 (27) | 20 | 30.2 | 29 | -2.25 | 12.20 | 3.37 / -5.74 | Mom trades < 60; best day > 30%; a Mom half < 0 |
| 16 | timeOfDay=open 9:45-11:44 & spySameSide=no (SPY opposite, zSPY >= 1) | 79 | -2.72 | 9.96 | 4.23 (40) / -10.01 (39) | 29 | 37.0 | 49 | -4.13 | 10.16 | 2.39 / -9.85 | best day > 30%; a Mom half < 0 |
| 17 | absZ=1.674 - 1.947 & crossings60=1-2 & trendBps=47.1 - 111.1 | 47 | -5.94 | 8.49 | 3.18 (13) / -9.50 (34) | 19 | 47.4 | 50 | -8.03 | 5.90 | -13.87 / -2.59 | Mom trades < 60; best day > 30%; a Mom half < 0 |
| 18 | spySameSide=no (SPY opposite, zSPY >= 1) & trendBps=47.1 - 111.1 | 45 | -7.13 | 5.16 | 3.85 (19) / -15.41 (26) | 21 | 61.7 | 36 | -3.80 | 10.47 | -6.53 / -1.84 | Mom trades < 60; best day > 30%; a Mom half < 0 |
| 19 | absZ=<= 1.674 & crossings60=>= 3 & spySameSide=no (SPY opposite, zSPY >= 1) | 40 | -11.41 | 0.48 | -3.99 (23) / -21.74 (17) | 26 | 724.4 | 27 | -1.38 | 12.85 | -4.93 / 1.42 | Mom trades < 60; best day > 30%; a Mom half < 0 |

Row 19's best-day share is 724% because its gross sum is close to zero (0.48 bps × 40 trades).

### Selection: none qualify

Fewer than 3 qualify. **None** do. The next best by Momentum net bps, and the rules they miss:

1. `crossings60 in 1..2 & SPY opposite (|zSPY| ≥ 1, opposite sign) & trendBps > 111.05`: 18 Mom trades, +20.90 net. Halves +46.11 / −12.15. Core 2 trades, −20.48. Misses: < 60 trades, a half < 0, Core sign.
2. `1.6745 < |z| ≤ 1.9470 & crossings60 in 1..2 & SPY opposite`: 21 Mom trades, +17.79 net. Halves +36.49 / +5.84. Core 8 trades, −1.32. Misses: < 60 trades, Core sign.
3. `crossings60 in 1..2 & SPY neutral (|zSPY| < 1) & trendBps ≤ 47.14`: 19 Mom trades, +12.67 net. Halves +9.55 / +16.16. Core 26 trades, −5.45. Misses: < 60 trades, Core sign.

The closest group on the qualifying rules is #6, `|z| > 1.9470 & crossings60 in 1..2 & SPY neutral`. It passes every rule except the trade count: 31 Mom trades at +4.75 net, halves +7.34 / +3.05, Core +5.09.

Of the groups with ≥ 60 Momentum trades (#7, #10, #12, #14, #16), every one has a negative second half (−5.4 to −10.0 net). #7 (`volRatio > 1.1128 & SPY opposite`) is the only one with positive full-sample net (+3.24), and its Core is −5.84.

Bins in plain numbers (`s4-bins.json`):
- ownShare: 0.69684 / 0.94524
- absZ: 1.67447 / 1.94697
- edgeBps: 41.77 / 79.77
- crossings60: ≤ 0 / 1–2 / ≥ 3
- volRatio: 0.74237 / 1.11275
- rangeSigma: 0.16653 / 0.31702
- trendBps: 47.14 / 111.05
- stretchRun: ≤ 4 / 5–16 / ≥ 17
- timeOfDay thirds: 9:45–11:44 / 11:45–13:44 / 13:45–15:44
- spySameSide: yes = |zSPY| ≥ 1, same sign; no = |zSPY| ≥ 1, opposite sign; neutral = |zSPY| < 1

Why the set (b) edges don't survive: the survey counted every opportunity bar. The one-position walk keeps one trade per episode, so a group drops to about 1/5 of its survey size (e.g. `ownShare>0.945 & SPY opposite`: 561 survey records become 105 trades). The 14 bps of costs then take most of the 10–20 bps gross edge. Three of the top five are subsets of F1 (crossings 1–2 & SPY opposite & a third bin), so they are not new signals.
