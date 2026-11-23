# Team 3 Ablation Table

Rules and protocol: [AGENT_GUIDE.md §2](AGENT_GUIDE.md#2-ablation-table). Metrics: [§3](AGENT_GUIDE.md#3-metrics-for-a-reversal-strategy).
Never edit or delete a row; add a corrected one and mark the old one `superseded by Axx`.

**Protocol header (lead confirms once, before A01):**
- In-sample window: `2026-09-01` → `2026-10-15` (to be confirmed against cached data)
- Out-of-sample window: `2026-10-16` → `2026-11-13` (to be confirmed)
- Costs: slippage 5 bps (+ half spread 2 bps), $0.005/share · Capital: $100,000 · Bars: 1-min, regular session
- Engine risk config: `TEAM3_PROTOCOL.riskConfig` (`contract/protocol.ts`): kill switch off, engine caps above the strategy's
- VERSION 3 changes the baseline (VWAP reversion); rows from VERSION 2 are not comparable
- **OOS is locked until Stage 3.** No row may use an OOS day before the final config is frozen and logged here ([MASTER](MASTER.md#out-of-sample-ban)).
- Main universe: **Momentum**. Control: **Core**, with the same config. Each config gets one row per universe.

This file is the **trial ledger**. Every run goes in it, including diagnostics, features and failures. Rules: [MASTER, Iteration rules](MASTER.md#iteration-rules).

**Columns.** `Goal` = the R budget bucket (R3, R1, R2-rts, R2, R5, R4, reserve), or `—` for S0/S1 anchors and D/V rows, which don't count toward the ~20. `Config vs baseline` is the change against the current baseline (VERSION 4 defaults, A03 Core / A04 Momentum). `Rep` = reportable as a result (diagnostics: no). `Rev %` = reversion share = `target` exits ÷ trades (the R3/R1 mechanism check). `Exit mix` = count by exit reason (avg gross bps where logged). Window `IS` = 2026-09-01 → 2026-10-15 (32 trading days). Sharpe = runner `sharpeDaily` over the 32 days.

**Stage 2 configs used: 4 of ~20** (R3 4/4: done).

| ID | Date run | Goal | Window (dates) | Universe | Config vs baseline | VER | backtestId | Rep | Net P&L $ | Trades | Avg bps/trade | Rev % | Exit mix | Win % | Payoff | PF | Sharpe | Max DD $ (%) | Compared to | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A00 | 2026-11-23 | — (S0 ref) | IS 09-01 → 10-15 | Core | `beginner_reversal` reference strategy (fade every bar) | BR 2 | `0c435fbe-eaed-4a6b-a5c8-5516c6cb10ce` (summary only) | yes | -37,838.40 | 54,032 | -14.14 | n/a | n/a (no exit reasons) | 1.3 | 0.63 | 0.01 | -452.74 | 37,838.40 (37.84%) | — | Loses about the round-trip cost on every trade: zero gross edge. 0 of 32 days profitable (worst −1,275). Re-saved 2026-11-23: the first run (`bf3f149a-…`, 2026-11-22) and a rerun (`5a403803-…`) reproduced these numbers but hit the DB statement timeout on the summary insert; fixed by saving a slim curve (UPSTREAM #11). Orders/fills not saved (too large). |
| A00m | 2026-11-22 | — (S0 ref) | IS 09-01 → 10-15 | Momentum | `beginner_reversal` reference strategy | BR 2 | `d29b333c-6b95-4d97-9278-70e66464c95f` (summary only) | yes | -48,413.60 | 56,486 | -14.17 | n/a | n/a (no exit reasons) | 3.7 | 0.85 | 0.03 | -275.74 | 48,413.60 (48.41%) | — | Same: costs are the whole loss. 0 of 32 days profitable (worst −1,700). Sharpe corrected from −84.36 (phantom 33rd day, UPSTREAM #10). |
| A01 | 2026-11-22 | — (S0 anchor) | IS 09-01 → 10-15 | Core | VERSION 3 baseline (before M1/M2) | 3 | `939cfd88-7b80-446d-bc41-7b14494dba54` | yes | -3,154.64 | 433 | -15.34 | 15.0 | time 324, target 65, stop 36, close 8 ¹ | 26.1 | 0.71 | 0.25 | -20.54 | 3,191.60 (3.19%) | A00 | 2 of 32 days profitable (worst −271). −15 bps/trade ≈ the modeled round trip, so gross edge ≈ 0. Sharpe corrected from −19.72 (UPSTREAM #10). |
| A02 | 2026-11-22 | — (S0 anchor) | IS 09-01 → 10-15 | Momentum | VERSION 3 baseline (before M1/M2) | 3 | `ccabf708-8835-4366-8cd4-e1f82dc1a207` | yes | -1,674.25 | 375 | -9.55 | 17.6 | time 283, target 66, stop 15, close 11 ¹ | 37.1 | 1.00 | 0.59 | -10.34 | 1,769.78 (1.77%) | A01 | Smaller loss than Core, higher win rate, still under costs. 9 of 32 days profitable (worst −362). Sharpe corrected from −10.12 (UPSTREAM #10). |
| A03 | 2026-11-23 | — (S1 anchor) | IS 09-01 → 10-15 | Core | **baseline** (VERSION 4 defaults: M1 no entry at/past `stopZ`; M2 `riskPerTradeUsd` 5, unused here) | 4 | `1872fd42-331a-4a8c-a488-460231ac8552` | yes | -3,048.74 | 419 | -15.32 | 15.5 | time 324 (−13.3), target 65 (+28.4), stop 22 (−40.4), close 8 (−3.7) | 27.2 | 0.69 | 0.26 | -21.46 | 3,085.70 (3.08%) | A01 | vs A01: M1 removed 14 entries past the stop (stop exits 36→22), +$106. 2 of 32 days profitable (worst −244). Re-saved 2026-11-23: the first run (`b85e1db4-…`, 2026-11-22, summary timed out) is reproduced exactly. Sharpe was −20.57 over the phantom 33rd day. |
| A04 | 2026-11-22 | — (S1 anchor) | IS 09-01 → 10-15 | Momentum | **baseline** (VERSION 4 defaults) | 4 | `4b060cbe-2834-4996-8b6b-c223bef772ed` | yes | -1,647.82 | 370 | -9.52 | 17.6 | time 283 (−14.5), target 65 (+52.2), stop 11 (−42.2), close 11 (+11.7) | 37.3 | 1.00 | 0.59 | -10.24 | 1,745.12 (1.74%) | A02 | vs A02: M1 +$26. 9 of 32 days profitable (worst −355). Rerun 2026-11-23 (`b6efa90f-fca1-4677-85df-199d2b56d1bc`) reproduced it exactly. Sharpe corrected from −10.03 (UPSTREAM #10). |
| D1 | 2026-11-22 | — (diag) | IS 09-01 → 10-15 | Core | A01 + zero-cost fill model (`TEAM3_DIAGNOSTIC=zero_cost`) | 3 | `574736ac-ce71-4c8f-b966-395714dee8a6` | **no** | -225.20 (gross) | 433 | -1.09 (gross) | 15.0 | time 324 (−6.2), target 65 (+35.4), stop 36 (−22.4), close 8 (+3.4) | 48.3 | — | — | -2.07 | — | A01 | Gross edge before costs. |
| D2 | 2026-11-22 | — (diag) | IS 09-01 → 10-15 | Momentum | A02 + zero-cost fill model | 3 | `38d9139b-312f-4341-8bdf-17b8a1ecef0f` | **no** | +817.17 (gross) | 375 | +4.66 (gross) | 17.6 | time 283 (−7.6), target 66 (+59.1), stop 15 (−25.6), close 11 (+18.7) | 55.5 | — | — | 5.33 | — | A02 | |
| D3 | 2026-11-22 | — (diag) | IS 09-01 → 10-15 | Core | baseline (A03) + zero-cost fill model | 4 | `e6bf3eb9-028e-4f6a-9be3-c5f120a63c40` | **no** | -215.21 (gross) | 419 | -1.08 (gross) | 15.5 | time 324 (−6.3), target 65 (+35.4), stop 22 (−33.4), close 8 (+3.4) | 49.4 | — | — | -1.99 | — | A03 | |
| D4 | 2026-11-22 | — (diag) | IS 09-01 → 10-15 | Momentum | baseline (A04) + zero-cost fill model | 4 | `68934a6c-0b91-40e8-97b6-3eaf55b9f3e3` | **no** | +812.94 (gross) | 370 | +4.70 (gross) | 17.6 | time 283 (−7.5), target 65 (+59.2), stop 11 (−35.2), close 11 (+18.7) | 55.4 | — | — | 5.24 | — | A04 | |
| V1 | 2026-11-23 | — (V) | IS 09-01 → 10-15 | Core | none (VERSION 5 defaults, `useCostGate` off) | 5 | `77b3942f-8f5e-4be3-bbae-4588d12cac1c` | no | -3,048.74 | 419 | -15.32 | 15.5 | time 324, target 65, stop 22, close 8 | 27.2 | — | 0.26 | -21.46 | 3,085.70 (3.08%) | A03 | V5 parity (switch off). Identical to A03 on every column: the V5 code with the switch off is the V4 baseline. |
| V2 | 2026-11-23 | — (V) | IS 09-01 → 10-15 | Momentum | none (VERSION 5 defaults, `useCostGate` off) | 5 | `0bc96b5a-4f96-4079-8d67-1f571abcd9e4` | no | -1,647.82 | 370 | -9.52 | 17.6 | time 283, target 65, close 11, stop 11 | 37.3 | — | 0.59 | -10.24 | 1,745.12 (1.74%) | A04 | V5 parity (switch off). Identical to A04 on every column. |
| A05 | 2026-11-23 | R3 | IS 09-01 → 10-15 | Momentum | `minEdgeBps` 15 → 25 | 5 | `2cf7c332-28a4-44bc-86d7-eb06c9891af9` | yes | -1,348.90 | 330 | -8.73 | 17.3 | time 255 (−14.6), target 57 (+58.2), close 11 (+11.9), stop 7 (−55.0) | 39.7 | — | 0.64 | -8.70 | 1,500.30 (1.50%) | A04 | Q2.1 (R3). Boot vs A04: +$9.34/day, share 1.000, CI [6.96, 11.99]; halves +8.85 / +9.84 (1.000 / 1.000). Keep rule: **fails** on mechanism (reversion share 17.6 → 17.3%). |
| A06 | 2026-11-23 | R3 | IS 09-01 → 10-15 | Core | `minEdgeBps` 15 → 25 | 5 | `1a70363b-e9f6-49f0-86ab-97f972c99677` | yes | -2,668.13 | 366 | -15.28 | 12.8 | time 292 (−12.9), target 47 (+35.6), stop 19 (−43.7), close 8 (−3.4) | 27.9 | — | 0.28 | -19.11 | 2,701.11 (2.70%) | A03 | Q2.1 (R3). Boot vs A03: +$11.89/day, share 1.000, CI [8.97, 14.99]; halves +13.03 / +10.76. Control: same sign as Momentum. |
| A07 | 2026-11-23 | R3 | IS 09-01 → 10-15 | Momentum | `minEdgeBps` 15 → 35 | 5 | `8221e7f2-bcd3-4927-98d6-23831b77e5a0` | yes | -1,174.93 | 305 | -8.21 | 17.0 | time 237 (−14.8), target 52 (+62.2), close 10 (+16.0), stop 6 (−58.7) | 41.6 | — | 0.67 | -7.58 | 1,376.98 (1.38%) | A04 | Q2.2 (R3). Boot vs A04: +$14.78/day, share 1.000, CI [11.35, 18.51]; halves +13.80 / +15.76. Largest net gain in R3. Keep rule: **fails** on mechanism (17.6 → 17.0%). |
| A08 | 2026-11-23 | R3 | IS 09-01 → 10-15 | Core | `minEdgeBps` 15 → 35 | 5 | `776ce344-9211-4498-ba1d-b634a9d496bc` | yes | -2,035.44 | 316 | -13.44 | 13.6 | time 247 (−12.0), target 43 (+39.6), stop 18 (−41.5), close 8 (+6.6) | 32.3 | — | 0.34 | -15.85 | 2,065.53 (2.07%) | A03 | Q2.2 (R3). Boot vs A03: +$31.67/day, share 1.000, CI [25.15, 38.22]; halves +30.31 / +33.02. Control: same sign. |
| A09 | 2026-11-23 | R3 | IS 09-01 → 10-15 | Momentum | `useCostGate` on, `captureShare` 0.5 | 5 | `565bf8fc-5a7a-406d-85ff-ddd8f6dd3fc5` | yes | -1,286.90 | 323 | -8.50 | 17.3 | time 250 (−14.7), target 56 (+59.2), close 10 (+16.0), stop 7 (−54.6) | 40.6 | — | 0.65 | -8.31 | 1,450.74 (1.45%) | A04 | Q3.1 (R3, feature #2). Boot vs A04: +$11.28/day, share 1.000, CI [8.42, 14.35]; halves +10.00 / +12.56. At 0.5 the gate ≈ `minEdgeBps` 28.4 on a $500 stock. Keep rule: **fails** on mechanism (17.6 → 17.3%). |
| A10 | 2026-11-23 | R3 | IS 09-01 → 10-15 | Core | `useCostGate` on, `captureShare` 0.5 | 5 | `da5c1922-d73d-4d5b-a6ef-ac721f66f4f7` | yes | -2,458.39 | 355 | -14.51 | 12.7 | time 283 (−12.3), target 45 (+37.8), stop 19 (−42.0), close 8 (−0.6) | 29.3 | — | 0.30 | -18.06 | 2,491.36 (2.49%) | A03 | Q3.1 (R3, feature #2). Boot vs A03: +$18.45/day, share 1.000, CI [13.42, 24.07]; halves +17.99 / +18.90. Control: same sign. |
| A11 | 2026-11-23 | R3 | IS 09-01 → 10-15 | Momentum | `useCostGate` on, `captureShare` 0.6 | 5 | `aa5bec66-99b3-401e-b12f-b6a2d9f97b00` | yes | -1,405.98 | 338 | -8.88 | 17.2 | time 261 (−14.6), target 58 (+57.5), close 11 (+11.9), stop 8 (−49.6) | 39.1 | — | 0.63 | -9.01 | 1,541.18 (1.54%) | A04 | Q3.2 (R3, feature #2). Boot vs A04: +$7.56/day, share 1.000, CI [5.21, 10.26]; halves +7.46 / +7.66. At 0.6 the gate ≈ `minEdgeBps` 23.7. Keep rule: **fails** on mechanism (17.6 → 17.2%). |
| A12 | 2026-11-23 | R3 | IS 09-01 → 10-15 | Core | `useCostGate` on, `captureShare` 0.6 | 5 | `814e5952-edb2-4923-a7d8-403c9a6565c2` | yes | -2,750.48 | 376 | -15.35 | 13.3 | time 298 (−13.1), target 50 (+34.2), stop 20 (−42.1), close 8 (−3.4) | 27.7 | — | 0.27 | -19.60 | 2,783.45 (2.78%) | A03 | Q3.2 (R3, feature #2). Boot vs A03: +$9.32/day, share 1.000, CI [6.90, 11.88]; halves +10.49 / +8.15. Control: same sign. |

¹ A01/A02 ran before the runner logged exit reasons. The counts come from D1/D2. Exit decisions depend on bars only, not on fill costs, so a cost run and its zero-cost twin exit identically; D3 = A03 and D4 = A04 confirm it. Gross bps per reason differ between the twins (cost runs include entry slippage, about 7 bps lower), so only the counts are carried over.

### R3 summary

R3 (costs) batch, 2026-11-23: 4 configs × 2 universes, VERSION 5, IS only, against the V4 baseline (A03 Core / A04 Momentum). Nothing promoted.

| Row | Change | Mom net Δ | Mom bps/trade | Mom rev % (base 17.6) | Boot share | Halves | Core net Δ | Core rev % (base 15.5) | Keep rule |
|---|---|---|---|---|---|---|---|---|---|
| A05/A06 Q2.1 | `minEdgeBps` 25 | +$299 | −9.52 → −8.73 | 17.3 | 1.000 | agree | +$381 | 12.8 | fails: mechanism |
| A07/A08 Q2.2 | `minEdgeBps` 35 | +$473 | → −8.21 | 17.0 | 1.000 | agree | +$1,013 | 13.6 | fails: mechanism |
| A09/A10 Q3.1 | cost gate 0.5 | +$361 | → −8.50 | 17.3 | 1.000 | agree | +$590 | 12.7 | fails: mechanism |
| A11/A12 Q3.2 | cost gate 0.6 | +$242 | → −8.88 | 17.2 | 1.000 | agree | +$298 | 13.3 | fails: mechanism |

**Reading.** Every row passes 4 of the 5 conditions: net up on Momentum, share ≥ 0.8, halves agree, Core agrees. All fail the mechanism check, because the reversion share falls instead of rising. The gain comes from **trading less**: 370 → 305–338 trades, about 14 bps saved on each trade dropped. The trades that remain don't revert more often. All four rows are one knob in practice: the cost gate is a price-aware edge threshold (0.6 ≈ 23.7 bps, 0.5 ≈ 28.4), and the results are monotonic in that threshold (23.7 < 25 < 28.4 < 35). The best value (35) sits at the edge of the tested range, so the optimum isn't bracketed. Every row still loses money: the best is −8.21 bps/trade, about +6 gross against ~14 cost.

### Checks

**65/65 target exits (2026-11-23):** Core (A03) and Momentum (A04) both end with 65 `target` exits. This is a coincidence, not shared or overwritten output:
- distinct backtestIds; each saved `config.strategyConfig.symbols` is its own universe; saved orders cover disjoint symbols apart from SPY
- gross target bps differ (+28.4 vs +52.2), and so do D2 vs D4 (66 vs 65 targets)
- per symbol (runner `exitsBySymbol`), SPY trades in both universes and has an identical exit row in each (time 62, target 6, stop 5, close 1). Per-symbol state is independent and the gross caps never bound, so that's expected. The other five symbols differ one by one but both sum to 59: Core QQQ 13, MSFT 15, GOOGL 11, AMZN 11, AAPL 9; Momentum AMD 15, META 13, MU 12, TSLA 10, NVDA 9
- rerunning both on 2026-11-23 reproduced them exactly (A03 `1872fd42-331a-4a8c-a488-460231ac8552`, A04 `b6efa90f-fca1-4677-85df-199d2b56d1bc`), which also shows the runs are deterministic

**Paired day-bootstrap smoke test (2026-11-23, `runtime/team3Bootstrap.ts`, 10,000 draws, seed 20261123):** M1 (VERSION 3 → 4), B vs A on the same 32 IS days. Halves: 09-01 → 09-23 and 09-24 → 10-15 (16 days each).

| Pair | Mean Δ $/day | Share B > A | 95% CI $/day | 1st half (Δ, share) | 2nd half (Δ, share) | Halves agree |
|---|---|---|---|---|---|---|
| Core: A03 vs A01 | +3.31 | 0.9995 | [0.28, 7.58] | +4.65, 0.965 | +1.97, 0.991 | yes |
| Momentum: A04 vs A02 | +0.83 | 0.782 | [−1.07, 3.06] | +1.51, 0.726 | +0.14, 0.595 | yes |

M1 is a correction (Stage 1), not a Stage 2 row, so the keep rule doesn't apply to it. The numbers are only a check that the tool runs on real data.

Median bars to `target`: 13 (Core), 14 (Momentum). Cost runs' "gross" exit bps include entry slippage, so they read ~7 bps lower than the diagnostics.
