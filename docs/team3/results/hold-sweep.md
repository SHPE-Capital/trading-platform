# Offline hold sweep (maxHoldBars 30 → 180)

Offline, in-sample (2026-09-01 → 10-15) dumps only. **0 configs**, no backtests, no rule or config changes. Code: `backend/src/runtime/team3Analysis/holdSweep.ts` (from `backend/`: `npx ts-node --transpile-only src/runtime/team3Analysis/holdSweep.ts`, which writes `tmp/team3-data/hold-sweep.json`, gitignored). Test: `backend/src/tests/strategy/team3Reversal/holdSweep.test.ts`.

**Method.**
- Every trade in each parent's cost dump is re-exited with `sim.ts` `simulateExit(series, entryBar, sign, { stopZ: 3.5, maxHoldBars: H })`, using the same `exitReason` as the engine. The VWAP target, `stopZ` and the pre-close flatten all still apply.
- H ∈ {30, 35, 40, 45, 50, 60, 75, 90, 105, 120, 150, 180}. The lead wanted the long side: 30–60 first, and up to 180 where it helps.
- **Gross** = fill-to-fill at raw next opens (the zero-cost definition). **Net = gross − 14.2 bps**, an equal-weight average per trade.
  - Because it's equal-weighted, net here doesn't match the engine's dollar-weighted bps exactly. Example: F3 Momentum is +3.4 here and +4.75 in the engine.
  - Compare H against H = 30 in the same table, not against the ledger.
- Halves split at 2026-09-23. p5 = the 5th-percentile trade.

**Parity (H = 30): exact on all 8 parent × universe dumps.** For every trade, the trade count, exit reason, exit bar, `barsHeld` and gross bps (against the dump's `entryFill`, to 1e-6) all match.

| Parent | Momentum dump | Core dump |
|---|---|---|
| V4 | `bab63751` (370) | `5a7cd486` (419) |
| F1 | `2a628992` (32) | `9756c285` (14) |
| F3 | `f27874dd` (31) | `d47f1ca0` (29) |
| C3 | `990a5e75` (258) | `4a40e3df` (217) |

**Caveat: the entries are held fixed.** The engine holds one position per symbol, so a longer hold blocks later entries. Real trade counts will fall, and the trades that drop out aren't random. Only the L-series backtests measure this.

## Reading
- **The time stop at 30 cuts off trades that do revert later, but waiting costs as much as it pays.**
  - Of V4 Momentum's 283 time-stopped trades, 34 reach VWAP by bar 60 and 82 by bar 120. With the time stop off, 114 reach it before the close.
  - The rest drift on, so the average time-stop loss deepens (−7.5 bps at 30, −34 at 120, −58 at 180), and the tail gets worse (p5 net −97 → −132).
  - Net per trade on V4 and C3 is flat or worse at every H. **The long hold doesn't fix the losing stacks.**
- **The stop almost never comes into it:** 1–2 of each parent's time-stopped trades hit `stopZ` even with no time stop. Holding longer turns time exits into targets or close-flattens, not stops.
- **F1:**
  - Momentum net rises at long holds: +6.6 at 30, +12.0 at 150, +15.3 at 180.
  - That comes all from the first half (+33.7 → +47.1). The second half stays negative at every H.
  - Core is negative at every H, and drops to −10.8 at 180.
- **F3:**
  - Momentum has a spike at 60 (+11.8, the second half +18.6) and a flatter rise from 75 to 90 (+7.4 to +7.8).
  - Core peaks at 90 (+8.5) and is ≤ +5 elsewhere.
  - **120** (the lead's offline test): Momentum +4.9 and Core +3.8, both positive, but below F3's best long H (90) on both.
  - From H = 75 on, the halves disagree on both universes: Momentum's first half is negative and its second half positive, and Core is the reverse.
- **Every curve is noisy on ~30 trades.** One or two trades moving from time to target shifts the average by 3–5 bps.

### V4 · momentum (370 trades)

| H | Target / time / stop / close | Gross bps | Net bps | 1st half net | 2nd half net | Time-stop gross | p5 gross / net | Avg bars |
|---|---|---|---|---|---|---|---|---|
| **30** | 65 / 283 / 11 / 11 | +4.2 | -10.0 | -4.3 | -14.7 | -7.5 | -82.7 / -96.9 | 26.3 |
| 35 | 74 / 271 / 11 / 14 | +3.1 | -11.1 | -2.7 | -18.1 | -10.3 | -87.1 / -101.3 | 30.0 |
| 40 | 82 / 259 / 12 / 17 | +3.8 | -10.4 | -2.8 | -16.8 | -10.9 | -94.5 / -108.7 | 33.6 |
| 45 | 90 / 251 / 12 / 17 | +4.8 | -9.4 | -1.9 | -15.5 | -11.7 | -101.1 / -115.3 | 37.1 |
| 50 | 95 / 244 / 12 / 19 | +5.2 | -9.0 | -2.0 | -14.7 | -12.2 | -97.9 / -112.1 | 40.4 |
| 60 | 99 / 230 / 12 / 29 | +4.8 | -9.4 | -4.0 | -13.9 | -13.4 | -82.3 / -96.5 | 46.9 |
| 75 | 111 / 205 / 13 / 41 | +2.2 | -12.0 | -6.6 | -16.4 | -22.6 | -125.9 / -140.1 | 55.6 |
| 90 | 124 / 187 / 13 / 46 | +3.8 | -10.4 | -5.8 | -14.2 | -24.8 | -104.8 / -119.0 | 63.6 |
| 105 | 137 / 171 / 13 / 49 | +3.7 | -10.5 | -6.5 | -13.9 | -31.3 | -117.0 / -131.2 | 70.8 |
| 120 | 147 / 158 / 13 / 52 | +3.1 | -11.1 | -6.5 | -14.9 | -34.3 | -118.2 / -132.4 | 77.5 |
| 150 | 158 / 129 / 13 / 70 | +1.4 | -12.8 | -6.8 | -17.8 | -47.3 | -121.3 / -135.5 | 89.0 |
| 180 | 165 / 107 / 13 / 85 | +1.1 | -13.1 | -5.7 | -19.2 | -57.7 | -117.7 / -131.9 | 98.5 |

### V4 · core (419 trades)

| H | Target / time / stop / close | Gross bps | Net bps | 1st half net | 2nd half net | Time-stop gross | p5 gross / net | Avg bars |
|---|---|---|---|---|---|---|---|---|
| **30** | 65 / 324 / 22 / 8 | -1.1 | -15.3 | -15.3 | -15.3 | -6.3 | -46.9 / -61.1 | 26.2 |
| 35 | 73 / 312 / 23 / 11 | -0.8 | -15.0 | -14.5 | -15.4 | -7.0 | -54.2 / -68.4 | 30.0 |
| 40 | 82 / 296 / 23 / 18 | -0.2 | -14.4 | -13.6 | -14.9 | -7.1 | -54.0 / -68.2 | 33.7 |
| 45 | 90 / 286 / 23 / 20 | +0.4 | -13.8 | -13.5 | -14.1 | -7.8 | -53.2 / -67.4 | 37.2 |
| 50 | 102 / 272 / 23 / 22 | +0.9 | -13.3 | -13.2 | -13.4 | -8.4 | -51.8 / -66.0 | 40.5 |
| 60 | 114 / 256 / 23 / 26 | +0.3 | -13.9 | -12.7 | -14.8 | -11.2 | -58.8 / -73.0 | 46.8 |
| 75 | 125 / 232 / 23 / 39 | -0.4 | -14.6 | -13.1 | -15.6 | -15.0 | -60.7 / -74.9 | 55.6 |
| 90 | 138 / 214 / 23 / 44 | +0.6 | -13.6 | -11.7 | -15.0 | -15.5 | -59.5 / -73.7 | 63.7 |
| 105 | 147 / 199 / 23 / 50 | +0.2 | -14.0 | -11.8 | -15.6 | -18.2 | -68.0 / -82.2 | 71.1 |
| 120 | 155 / 184 / 23 / 57 | -0.0 | -14.2 | -12.0 | -15.8 | -21.3 | -68.6 / -82.8 | 77.9 |
| 150 | 170 / 149 / 23 / 77 | +0.1 | -14.1 | -11.7 | -15.8 | -26.6 | -71.2 / -85.4 | 90.0 |
| 180 | 180 / 128 / 23 / 88 | +0.1 | -14.1 | -11.7 | -15.9 | -31.1 | -70.3 / -84.5 | 100.0 |

### F1 · momentum (32 trades)

| H | Target / time / stop / close | Gross bps | Net bps | 1st half net | 2nd half net | Time-stop gross | p5 gross / net | Avg bars |
|---|---|---|---|---|---|---|---|---|
| **30** | 10 / 22 / 0 / 0 | +20.8 | +6.6 | +33.7 | -12.0 | +0.3 | -26.8 / -41.0 | 24.4 |
| 35 | 12 / 20 / 0 / 0 | +23.8 | +9.6 | +32.6 | -6.2 | +2.0 | -25.1 / -39.3 | 27.7 |
| 40 | 13 / 19 / 0 / 0 | +21.8 | +7.6 | +30.5 | -8.0 | -3.3 | -30.5 / -44.7 | 30.8 |
| 45 | 14 / 18 / 0 / 0 | +22.4 | +8.2 | +28.3 | -5.6 | -4.8 | -35.1 / -49.3 | 33.6 |
| 50 | 14 / 18 / 0 / 0 | +20.3 | +6.1 | +33.1 | -12.4 | -8.5 | -62.7 / -76.9 | 36.4 |
| 60 | 15 / 17 / 0 / 0 | +16.5 | +2.3 | +35.3 | -20.3 | -18.0 | -126.5 / -140.7 | 42.0 |
| 75 | 15 / 16 / 0 / 1 | +18.6 | +4.4 | +38.5 | -18.9 | -16.4 | -110.7 / -124.9 | 49.7 |
| 90 | 17 / 13 / 0 / 2 | +20.9 | +6.7 | +46.1 | -20.2 | -22.2 | -108.1 / -122.3 | 57.1 |
| 105 | 17 / 13 / 0 / 2 | +21.3 | +7.1 | +46.3 | -19.8 | -21.4 | -113.4 / -127.6 | 63.2 |
| 120 | 18 / 11 / 0 / 3 | +22.1 | +7.9 | +47.0 | -19.0 | -21.3 | -102.1 / -116.3 | 68.8 |
| 150 | 19 / 9 / 0 / 4 | +26.2 | +12.0 | +44.3 | -10.1 | -13.7 | -69.1 / -83.3 | 77.8 |
| 180 | 21 / 7 / 0 / 4 | +29.5 | +15.3 | +47.1 | -6.5 | +17.6 | -58.2 / -72.4 | 84.5 |

### F1 · core (14 trades)

| H | Target / time / stop / close | Gross bps | Net bps | 1st half net | 2nd half net | Time-stop gross | p5 gross / net | Avg bars |
|---|---|---|---|---|---|---|---|---|
| **30** | 3 / 11 / 0 / 0 | +7.7 | -6.5 | +12.1 | -16.9 | -0.6 | -42.1 / -56.3 | 26.6 |
| 35 | 4 / 10 / 0 / 0 | +6.7 | -7.5 | +18.0 | -21.6 | -9.4 | -32.2 / -46.4 | 30.4 |
| 40 | 4 / 10 / 0 / 0 | +6.5 | -7.7 | +20.7 | -23.4 | -9.7 | -42.8 / -57.0 | 33.9 |
| 45 | 4 / 10 / 0 / 0 | +7.6 | -6.6 | +20.4 | -21.6 | -8.2 | -31.6 / -45.8 | 37.5 |
| 50 | 5 / 9 / 0 / 0 | +13.7 | -0.5 | +24.3 | -14.3 | +2.2 | -21.4 / -35.6 | 40.9 |
| 60 | 6 / 8 / 0 / 0 | +11.9 | -2.3 | +24.0 | -17.0 | -5.4 | -32.7 / -46.9 | 46.9 |
| 75 | 8 / 6 / 0 / 0 | +13.5 | -0.7 | +26.3 | -15.7 | -14.4 | -32.1 / -46.3 | 53.6 |
| 90 | 8 / 6 / 0 / 0 | +9.7 | -4.5 | +28.0 | -22.6 | -23.2 | -45.5 / -59.7 | 60.1 |
| 105 | 8 / 6 / 0 / 0 | +12.0 | -2.2 | +31.4 | -20.9 | -17.9 | -40.3 / -54.5 | 66.5 |
| 120 | 9 / 5 / 0 / 0 | +13.5 | -0.7 | +33.1 | -19.4 | -25.7 | -37.6 / -51.8 | 72.9 |
| 150 | 9 / 5 / 0 / 0 | +11.8 | -2.4 | +33.1 | -22.1 | -30.6 | -50.7 / -64.9 | 83.6 |
| 180 | 9 / 5 / 0 / 0 | +3.4 | -10.8 | +33.1 | -35.2 | -54.1 | -84.0 / -98.2 | 94.4 |

### F3 · momentum (31 trades)

| H | Target / time / stop / close | Gross bps | Net bps | 1st half net | 2nd half net | Time-stop gross | p5 gross / net | Avg bars |
|---|---|---|---|---|---|---|---|---|
| **30** | 8 / 21 / 2 / 0 | +17.6 | +3.4 | +6.8 | +1.2 | -4.7 | -75.0 / -89.2 | 25.0 |
| 35 | 9 / 20 / 2 / 0 | +18.5 | +4.3 | +4.8 | +4.0 | -7.7 | -89.0 / -103.2 | 28.3 |
| 40 | 10 / 19 / 2 / 0 | +17.7 | +3.5 | +0.6 | +5.4 | -14.4 | -76.6 / -90.8 | 31.4 |
| 45 | 11 / 18 / 2 / 0 | +19.0 | +4.8 | +0.6 | +7.5 | -15.4 | -82.2 / -96.4 | 34.5 |
| 50 | 12 / 17 / 2 / 0 | +18.2 | +4.0 | -4.7 | +9.5 | -19.8 | -101.5 / -115.7 | 37.3 |
| 60 | 12 / 15 / 2 / 2 | +26.0 | +11.8 | +0.9 | +18.6 | -1.1 | -72.3 / -86.5 | 42.5 |
| 75 | 13 / 14 / 2 / 2 | +21.6 | +7.4 | -0.7 | +12.6 | -13.4 | -79.9 / -94.1 | 49.4 |
| 90 | 16 / 11 / 2 / 2 | +22.0 | +7.8 | -3.3 | +14.8 | -35.8 | -101.0 / -115.2 | 55.6 |
| 105 | 16 / 11 / 2 / 2 | +19.3 | +5.1 | -9.2 | +14.1 | -43.4 | -124.6 / -138.8 | 61.0 |
| 120 | 16 / 11 / 2 / 2 | +19.1 | +4.9 | -5.9 | +11.7 | -43.9 | -125.3 / -139.5 | 66.3 |
| 150 | 16 / 11 / 2 / 2 | +17.5 | +3.3 | -8.6 | +10.9 | -48.3 | -162.1 / -176.3 | 76.9 |
| 180 | 16 / 9 / 2 / 4 | +15.4 | +1.2 | -4.6 | +4.9 | -40.9 | -147.4 / -161.6 | 86.2 |

### F3 · core (29 trades)

| H | Target / time / stop / close | Gross bps | Net bps | 1st half net | 2nd half net | Time-stop gross | p5 gross / net | Avg bars |
|---|---|---|---|---|---|---|---|---|
| **30** | 7 / 22 / 0 / 0 | +19.0 | +4.8 | +7.9 | +0.9 | +3.3 | -30.1 / -44.3 | 26.3 |
| 35 | 7 / 22 / 0 / 0 | +19.0 | +4.8 | +8.6 | +0.2 | +3.3 | -19.1 / -33.3 | 30.1 |
| 40 | 7 / 22 / 0 / 0 | +19.3 | +5.1 | +10.0 | -1.1 | +3.6 | -29.4 / -43.6 | 33.9 |
| 45 | 7 / 22 / 0 / 0 | +19.2 | +5.0 | +12.0 | -3.6 | +3.6 | -41.2 / -55.4 | 37.7 |
| 50 | 7 / 22 / 0 / 0 | +17.8 | +3.6 | +7.7 | -1.5 | +1.7 | -39.2 / -53.4 | 41.5 |
| 60 | 8 / 21 / 0 / 0 | +14.1 | -0.1 | +7.2 | -9.0 | -5.3 | -42.9 / -57.1 | 48.8 |
| 75 | 9 / 19 / 0 / 1 | +18.6 | +4.4 | +11.0 | -3.6 | -7.2 | -50.0 / -64.2 | 59.0 |
| 90 | 10 / 18 / 0 / 1 | +22.7 | +8.5 | +20.2 | -6.0 | -3.0 | -29.0 / -43.2 | 68.7 |
| 105 | 12 / 16 / 0 / 1 | +19.0 | +4.8 | +16.2 | -9.2 | -14.6 | -40.5 / -54.7 | 77.6 |
| 120 | 13 / 15 / 0 / 1 | +18.0 | +3.8 | +15.9 | -11.2 | -20.3 | -40.7 / -54.9 | 85.4 |
| 150 | 13 / 14 / 0 / 2 | +16.2 | +2.0 | +14.8 | -13.7 | -26.9 | -50.2 / -64.4 | 100.9 |
| 180 | 13 / 14 / 0 / 2 | +14.6 | +0.4 | +15.6 | -18.3 | -30.3 | -66.3 / -80.5 | 115.3 |

### C3 · momentum (258 trades)

| H | Target / time / stop / close | Gross bps | Net bps | 1st half net | 2nd half net | Time-stop gross | p5 gross / net | Avg bars |
|---|---|---|---|---|---|---|---|---|
| **30** | 51 / 192 / 5 / 10 | +6.2 | -8.0 | -1.6 | -13.3 | -8.7 | -94.3 / -108.5 | 26.0 |
| 35 | 57 / 184 / 5 / 12 | +4.4 | -9.8 | -0.0 | -18.0 | -12.6 | -106.8 / -121.0 | 29.6 |
| 40 | 63 / 177 / 6 / 12 | +6.3 | -7.9 | +1.0 | -15.4 | -11.0 | -120.6 / -134.8 | 33.1 |
| 45 | 70 / 170 / 6 / 12 | +7.9 | -6.3 | +2.2 | -13.4 | -12.2 | -129.5 / -143.7 | 36.5 |
| 50 | 74 / 164 / 6 / 14 | +7.8 | -6.4 | +1.1 | -12.6 | -13.8 | -107.2 / -121.4 | 39.8 |
| 60 | 75 / 156 / 6 / 21 | +6.8 | -7.4 | -2.3 | -11.5 | -14.8 | -108.5 / -122.7 | 45.9 |
| 75 | 82 / 141 / 7 / 28 | +3.4 | -10.8 | -5.4 | -15.2 | -26.6 | -158.0 / -172.2 | 54.5 |
| 90 | 91 / 129 / 7 / 31 | +5.6 | -8.6 | -4.3 | -12.1 | -27.7 | -127.8 / -142.0 | 62.3 |
| 105 | 99 / 118 / 7 / 34 | +4.9 | -9.3 | -5.7 | -12.2 | -36.6 | -131.5 / -145.7 | 69.5 |
| 120 | 106 / 107 / 7 / 38 | +5.2 | -9.0 | -4.7 | -12.6 | -38.5 | -126.6 / -140.8 | 76.1 |
| 150 | 112 / 87 / 7 / 52 | +3.4 | -10.8 | -5.6 | -15.1 | -53.6 | -131.5 / -145.7 | 87.2 |
| 180 | 115 / 71 / 7 / 65 | +2.4 | -11.8 | -3.7 | -18.6 | -68.3 | -137.2 / -151.4 | 96.3 |

### C3 · core (217 trades)

| H | Target / time / stop / close | Gross bps | Net bps | 1st half net | 2nd half net | Time-stop gross | p5 gross / net | Avg bars |
|---|---|---|---|---|---|---|---|---|
| **30** | 42 / 159 / 10 / 6 | +0.7 | -13.5 | -12.8 | -14.0 | -8.8 | -66.3 / -80.5 | 25.5 |
| 35 | 46 / 154 / 10 / 7 | +1.5 | -12.7 | -12.1 | -13.0 | -9.0 | -59.8 / -74.0 | 29.1 |
| 40 | 50 / 147 / 10 / 10 | +2.4 | -11.8 | -11.6 | -11.8 | -8.9 | -61.0 / -75.2 | 32.6 |
| 45 | 52 / 145 / 10 / 10 | +2.6 | -11.6 | -11.6 | -11.6 | -9.8 | -61.2 / -75.4 | 36.0 |
| 50 | 57 / 138 / 10 / 12 | +1.7 | -12.5 | -11.6 | -13.0 | -12.7 | -68.7 / -82.9 | 39.2 |
| 60 | 64 / 129 / 10 / 14 | +0.7 | -13.5 | -11.3 | -14.9 | -16.9 | -80.9 / -95.1 | 45.4 |
| 75 | 68 / 119 / 10 / 20 | +1.3 | -12.9 | -10.3 | -14.4 | -19.5 | -70.0 / -84.2 | 54.0 |
| 90 | 74 / 111 / 10 / 22 | +1.6 | -12.6 | -8.7 | -15.1 | -21.3 | -81.2 / -95.4 | 62.0 |
| 105 | 75 / 106 / 10 / 26 | +1.3 | -12.9 | -9.1 | -15.3 | -23.0 | -92.0 / -106.2 | 69.5 |
| 120 | 78 / 96 / 10 / 33 | +1.1 | -13.1 | -8.6 | -16.0 | -27.0 | -93.4 / -107.6 | 76.5 |
| 150 | 83 / 79 / 10 / 45 | +2.2 | -12.0 | -8.8 | -14.1 | -28.6 | -86.1 / -100.3 | 88.8 |
| 180 | 88 / 66 / 10 / 53 | +1.5 | -12.7 | -8.8 | -15.2 | -35.8 | -97.8 / -112.0 | 98.7 |

## Trades time-stopped at 30: where they would end

Whole window; halves are in `hold-sweep.json`. "Target" = reached VWAP. With the time stop off, a trade ends at target, stop or the close flatten.

| Parent | Universe | Time-stopped at 30 | By 60: target / stop / close / still open | By 120: target / stop / close / still open | Time stop off: target / stop / close |
|---|---|---|---|---|---|
| V4 | momentum | 283 | 34 / 1 / 18 / 230 | 82 / 2 / 41 / 158 | 114 / 2 / 167 |
| V4 | core | 324 | 49 / 1 / 18 / 256 | 90 / 1 / 49 / 184 | 135 / 1 / 188 |
| F1 | momentum | 22 | 5 / 0 / 0 / 17 | 8 / 0 / 3 / 11 | 14 / 0 / 8 |
| F1 | core | 11 | 3 / 0 / 0 / 8 | 6 / 0 / 0 / 5 | 6 / 0 / 5 |
| F3 | momentum | 21 | 4 / 0 / 2 / 15 | 8 / 0 / 2 / 11 | 11 / 0 / 10 |
| F3 | core | 22 | 1 / 0 / 0 / 21 | 6 / 0 / 1 / 15 | 8 / 0 / 14 |
| C3 | momentum | 192 | 24 / 1 / 11 / 156 | 55 / 2 / 28 / 107 | 75 / 2 / 115 |
| C3 | core | 159 | 22 / 0 / 8 / 129 | 36 / 0 / 27 / 96 | 60 / 0 / 99 |

## Feeds the L series
The pre-registered rule is in [ablation.md](../ablation.md), "L series". It picks per parent (F1 and F3 only) the best Momentum H in (30, 60] and in (60, 180], where Core's net at that H mustn't be below Core's at 30. The picks are:
- **F1:** 50 and 150
  - 35, 40 and 45 fail the Core check.
  - 180 fails Core (−10.8 < −6.5).
- **F3:** 45 and 90
  - 60 fails Core (−0.1 < +4.8).
  - 120 is reported next to 90: Momentum +4.9, Core +3.8.
