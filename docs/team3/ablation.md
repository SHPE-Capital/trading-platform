# Team 3 Ablation Table

Rules and protocol: [AGENT_GUIDE.md §2](AGENT_GUIDE.md#2-ablation-table). Metrics: [§3](AGENT_GUIDE.md#3-metrics-for-a-reversal-strategy).
Never edit or delete a row; add a corrected one and mark the old one `superseded by Axx`.

**Protocol header (lead confirms once, before A01):**
- In-sample window: `2026-09-01` → `2026-10-15` (to be confirmed against cached data)
- Out-of-sample window: `2026-10-16` → `2026-11-20` (26 trading days)
- **OOS end extended 2026-11-13 → 2026-11-20 by lead decision, 2026-11-23, before any OOS run. Reason: more days for a small sample.**
- Costs: slippage 5 bps (+ half spread 2 bps), $0.005/share · Capital: $100,000 · Bars: 1-min, regular session
- Engine risk config: `TEAM3_PROTOCOL.riskConfig` (`contract/protocol.ts`): kill switch off, engine caps above the strategy's
- VERSION 3 changes the baseline (VWAP reversion); rows from VERSION 2 are not comparable
- **OOS is locked until Stage 3.** No row may use an OOS day before the final config is frozen and logged here ([MASTER](MASTER.md#out-of-sample-ban)).
- Main universe: **Momentum**. Control: **Core**, with the same config. Each config gets one row per universe.

This file is the **trial ledger**. Every run goes in it, including diagnostics, features and failures. Rules: [MASTER, Iteration rules](MASTER.md#iteration-rules).

**Columns.** `Goal` = the R budget bucket (R3, R1, R2-rts, R2, R5, R4, reserve), or `—` for S0/S1 anchors and D/V rows, which don't count toward the ~20. `Config vs baseline` is the change against the current baseline (VERSION 4 defaults, A03 Core / A04 Momentum). `Rep` = reportable as a result (diagnostics: no). `Rev %` = reversion share = `target` exits ÷ trades (the R3/R1 mechanism check). `Exit mix` = count by exit reason (avg gross bps where logged). Window `IS` = 2026-09-01 → 2026-10-15 (32 trading days). Sharpe = runner `sharpeDaily` over the 32 days.

**Stage 2 configs used (see the F3/B section for the final count, 25): 19 of ~30** (R3 4, R1 3, R2 2, R4 3 incl. 1 reserve, R5 2, rspy 2, combining 3 of 10: C3, C3b, C4). The parallel goals' rows are merged below in [Stage 2 (parallel goal sessions)](#stage-2-parallel-goal-sessions); full rows stay in [`results/ledger-<goal>.md`](results/). The combining step is in [S2 combination](#s2-combination).

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
| V3 | 2026-11-23 | — (V) | IS 09-01 → 10-15 | Core | none (VERSION 6 defaults: every switch off) | 6 | `9f566a33-bde5-4578-8474-be15536f684e` | no | -3,048.74 | 419 | -15.32 | 15.5 | time 324, target 65, stop 22, close 8 | 27.2 | — | 0.26 | -21.46 | 3,085.70 (3.08%) | A03 | V6 parity (Rivera's merge, Stage 2 config blocks): identical to A03. |
| V4 | 2026-11-23 | — (V) | IS 09-01 → 10-15 | Momentum | none (VERSION 6 defaults: every switch off) | 6 | `b180610a-1361-4b80-a7a1-a0fdc6d8fa5e` | no | -1,647.82 | 370 | -9.52 | 17.6 | time 283, target 65, close 11, stop 11 | 37.3 | — | 0.59 | -10.24 | 1,745.12 (1.74%) | A04 | V6 parity: identical to A04. The bootstrap's one-id form picked A04 for it by itself (Δ = 0). |
| V5 | 2026-11-23 | — (V) | IS 09-01 → 10-15 | Core | none (VERSION 7 defaults: every switch off, all five Stage 2 branches merged) | 7 | `5a7cd486-dc60-4159-a1dd-88049fb61bb0` | no | -3,048.74 | 419 | -15.32 | 15.5 | time 324, target 65, stop 22, close 8 | 27.2 | — | 0.26 | -21.46 | 3,085.70 (3.08%) | A03 | V7 parity (combining-step merge): identical to A03. |
| V6 | 2026-11-23 | — (V) | IS 09-01 → 10-15 | Momentum | none (VERSION 7 defaults: every switch off, all five Stage 2 branches merged) | 7 | `bab63751-fcad-4088-ad02-6c3019d66cb2` | no | -1,647.82 | 370 | -9.52 | 17.6 | time 283, target 65, close 11, stop 11 | 37.3 | — | 0.59 | -10.24 | 1,745.12 (1.74%) | A04 | V7 parity: identical to A04. |

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

### Stage 2 (parallel goal sessions)

Five sessions (R1, R2, R4, R5, rspy), 2026-11-23, code VERSION 6 plus each goal's block (merged as VERSION 7), IS only, each row against the frozen V4 baseline (A03 Core / A04 Momentum). Source ledgers: [r1](results/ledger-r1.md), [r2](results/ledger-r2.md), [r4](results/ledger-r4.md), [r5](results/ledger-r5.md), [rspy](results/ledger-rspy.md). Bootstrap share and halves (Δ $/day) are vs the row's own universe baseline. Keep = all five conditions, judged on the Momentum row; the Core row is the control. Nothing promoted.

| ID | Universe | Config vs baseline | backtestId | Net $ | Trades | bps/trade | Rev % | Boot share | Halves (1st / 2nd) | Keep |
|---|---|---|---|---|---|---|---|---|---|---|
| R1-01 | Momentum | `entryZ` 2.5 | `2ffd7d2f-94ed-4a3d-93de-0e3cba195811` | -421.22 | 136 | -6.65 | 14.7 | 1.000 | +22.02 / +54.64 | **fail** (mechanism: rev ↓) |
| R1-01 | Core | `entryZ` 2.5 | `fd8216a4-7195-4981-bc6f-03b6dae0dc47` | -1,560.94 | 193 | -17.02 | 15.0 | 1.000 | +33.33 / +59.66 | Core agrees |
| R1-02 | Momentum | `entryZ` 1.5 | `bd4a5174-5c0a-4b97-9dcb-47297f61892c` | -4,863.24 | 820 | -12.66 | 17.0 | 0.000 | −110.61 / −90.35 | **fail** (only Core holds) |
| R1-02 | Core | `entryZ` 1.5 | `5440b283-53d4-4ac9-b20b-2f89c723800e` | -5,834.05 | 880 | -13.96 | 17.0 | 0.000 | −75.91 / −98.17 | Core agrees (negative) |
| R1-03 | Momentum | `useTurnEntry` | `dcc2c7f1-f247-4f29-9f09-40d21b8d50b1` | -943.92 | 222 | -9.11 | 10.4 | 0.9945 | +7.47 / +36.53 | **fail** (mechanism split: adverse5 ↓, rev ↓) |
| R1-03 | Core | `useTurnEntry` | `fd66a000-5649-44d8-b3c9-143a7ee519ab` | -1,996.94 | 276 | -15.21 | 8.3 | 1.000 | +23.23 / +42.51 | Core agrees |
| R2-01 | Momentum −SPY | `TEAM3_EXCLUDE=SPY` (universe row) | `89339dc1-7a0c-4c9d-9913-6a88ce2f8404` | -1,108.59 | 296 | -7.97 | 19.9 | 1.00 | +16.56 / +17.14 | **PASS** (mechanism marginal) |
| R2-01 | Core −SPY,QQQ | `TEAM3_EXCLUDE=SPY,QQQ` | `42fdfe7c-1a5a-4453-8504-02efb32f4a35` | -1,969.73 | 270 | -15.07 | 17.0 | 1.00 | +36.05 / +31.39 | Core agrees |
| R2-02 | Momentum | `useVwapRegime` | `204d264f-32d7-4dd3-8faa-f8aad8865f8d` | -1,166.47 | 144 | -17.26 | 23.6 | 0.887 | −22.49 / +52.57 | **fail** (halves) |
| R2-02 | Core | `useVwapRegime` | `1afe1572-9552-4de2-a334-bc0c4c514fa8` | -1,755.27 | 187 | -19.79 | 23.0 | 1.00 | +25.71 / +55.13 | Core agrees |
| R4-01 | Momentum | `stopZ` 100 (stop off) | `a63dc5c0-6de7-4c6f-b141-21a6a8a3f17f` | -1,561.09 | 364 | -9.17 | 18.4 | 0.973 | +1.93 / +3.49 | **PASS** (CI touches 0) |
| R4-01 | Core | `stopZ` 100 | `1ec24eb7-5bcb-4e5a-bc4c-2493a5049275` | -2,914.99 | 405 | -15.16 | 16.3 | 0.951 | +4.96 / +3.40 | Core same sign (its mechanism contradicts) |
| R4-02 | Momentum | `usePartwayTarget`, `tpFraction` 0.5 | `fe45ee9e-b317-43de-bb68-133fe59bbd56` | -2,054.18 | 400 | -10.97 | 56.0 | 0.041 | −19.29 / −6.11 | **fail** |
| R4-02 | Core | same | `8a230d6b-b9e7-4c88-90a3-d923788b0588` | -3,228.56 | 451 | -15.07 | 57.4 | 0.146 | −12.35 / +1.11 | Core same sign (negative) |
| R4-03 | Momentum | `useScaleOut`, `tpFraction` 0.5 (reserve slot) | `f46a5b1c-7d54-4b6f-9d66-b9fd7b834e3d` | -1,730.77 | 370 trips | -10.00 | 54.1 | 0.248 | −5.17 / −0.02 | **fail** |
| R4-03 | Core | same | `972c3a53-7458-471a-a120-a544a7de105b` | -3,037.19 | 419 trips | -15.26 | 55.4 | 0.538 | −5.64 / +6.36 | Core flat |
| R5-01 | Momentum | `useVolSizing`, `riskPerTradeUsd` 5 | `0e098f15-8020-4abb-8a0f-c0c8dbe7a5e3` | -2,573.53 | 370 | -11.73 | 17.6 | 0.000 | −30.38 / −27.48 | **fail** (all 5) |
| R5-01 | Core | same | `b4e14b25-92e6-4073-b7e9-d6752c65f038` | -4,972.06 | 419 | -15.48 | 15.5 | 0.000 | −44.88 / −75.33 | Core agrees (negative) |
| R5-02 | Momentum | `useCrowdSplit` | `97caa151-ca62-41b9-94a0-db5e98dbdb0f` | -1,038.37 | 370 | -8.05 | 17.6 | 0.995 | +8.43 / +29.66 | **PASS** (~25% less notional) |
| R5-02 | Core | same | `d0207c12-ffbe-4d88-89b1-7b946ff769d6` | -1,995.27 | 419 | -14.53 | 15.5 | 1.000 | +29.55 / +36.29 | Core agrees |
| RS-01 | Momentum | `useRelativeToSpy`, `rtsMinOwnShare` 0.5 | `1c945ce4-7b31-4d59-a2ef-a965da7bd3e9` | -1,037.56 | 286 | -7.73 | 19.9 | 1.00 | +13.97 / +24.17 | **PASS** (vs exclusion-only ref: share 0.849, halves disagree) |
| RS-01 | Core | same | `f6589210-732f-4999-aa4f-c87dcca374a4` | -1,800.74 | 247 | -15.07 | 16.6 | 1.00 | +40.22 / +37.78 | Core agrees |
| RS-02 | Momentum | `useRelativeToSpy`, `rtsMinOwnShare` 0.7 | `87633870-7774-47c2-89b8-1c6d72dd8652` | -912.10 | 258 | -7.55 | 19.8 | 0.9999 | +15.25 / +30.74 | **PASS** (vs ref: share 0.866, halves disagree) |
| RS-02 | Core | same | `1cd15a22-8185-4f93-8ec5-77123c40d660` | -1,426.88 | 217 | -13.58 | 19.4 | 1.00 | +46.81 / +54.56 | Core agrees |

**V and D rows (don't count toward the budget):** R1-V1, R1-V2; R2-D1, R2-D2 (baseline reruns), R2-D3, R2-D4 (zero-cost twins of R2-01: gross −0.77 Core, +6.26 Momentum); R4-V1…R4-V4; R5-V1, R5-V2; RS-V1, RS-V2 (parity), RS-V3 (exclusion-only reference, = R2-01). Every parity row reproduces A03/A04 exactly. VERSION 7 parity: V5/V6 above.

**Reading.** Five rows pass the keep rule against the baseline: R2-01, R4-01, R5-02, RS-01, RS-02. Every one still loses money; each loses less than the baseline by trading less, betting smaller, or dropping the index names. RS-02 already contains R2-01's exclusion, so they aren't stacked. Why each row fails or passes weakly: [why-individual.md](results/why-individual.md).

### S2 combination

S2, 2026-11-23, code VERSION 7, IS only. One step at a time, each judged against the stack so far (Momentum main, Core control) with the size-neutral **true test** ([MASTER, Budget](MASTER.md#budget-30-configs-split-by-goal)): net bps/trade improves AND bootstrap share ≥ 0.8 AND halves agree AND Core doesn't contradict AND the step's mechanism moves. Start = V4 baseline (Momentum −1,647.82, 370 trades, −9.52 bps, gross +4.70; Core −3,048.74, 419, −15.32, gross −1.08). V7 parity: Core `5a7cd486-dc60-4159-a1dd-88049fb61bb0`, Momentum `bab63751-fcad-4088-ad02-6c3019d66cb2` (= A03/A04). V4 zero-cost twins: Core `cbb3b46d-3d57-4b0d-b859-6d2a258d195e`, Momentum `2af1685c-5af1-47f2-bb21-aede6fcdfab6`. Bootstrap: `runtime/team3Bootstrap.ts`, Δ $/day. Write-up: [results/combination.md](results/combination.md).

| ID | Universe | Config | backtestId (cost) | Net $ | Trades | bps/trade | Zero-cost gross bps (id) | vs | Boot Δ $/day, share | Halves (1st / 2nd) | Keep | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C1 | Momentum | `{"entryZ":2.5}` (= R1-01, not counted) | `2333278a-2b44-4135-a458-47907cbe802b` | -421.22 | 136 | -6.65 | +7.55 (`4e6e54c0-22d9-4587-b743-d69163709b19`) | V4 | (R1-01: share 1.000) | (R1-01: +22.02 / +54.64) | **REJECT** | Rev 14.7% (↓ from 17.6): R1 mechanism fails. |
| C1 | Core | same | `70fdc41c-14ff-43dd-a8c4-b713140cd751` | -1,560.94 | 193 | -17.02 | −2.78 (`e7394291-5851-47a9-882c-694c8af0e63e`) | V4 | — | — | Core contradicts | Size-neutral measures worse: bps −15.32 → −17.02, gross −1.08 → −2.78. Stack stays at V4. |
| C2 | Momentum | `{"useRelativeToSpy":true,"rtsMinOwnShare":0.7}` (= RS-02, not counted) | `af6fecf6-909f-463a-abe6-e0a91108be12` | -912.10 | 258 | -7.55 | +6.67 (`96dc4098-801b-436c-8ee3-05aac16aa919`) | V4 | (RS-02: share 0.9999) | (RS-02: +15.25 / +30.74) | **KEEP** | Rev 19.8% (↑). |
| C2 | Core | same | `285fff58-f4f9-44fa-800b-210839e70d6d` | -1,426.88 | 217 | -13.58 | +0.71 (`030c4a94-b361-4791-9f39-dd6813ea94c8`) | V4 | (RS-02: 1.00) | (RS-02: +46.81 / +54.56) | Core agrees | Core gross turns positive. |
| C3 | Momentum | C2 + `"useCrowdSplit":true` | `990a5e75-c896-48db-b7b4-daa97e865ce4` | -495.93 | 258 | -5.25 | +8.98 (`3b41d04d-aa4d-4b92-bdc4-93f64fab37d9`) | C2 | +13.01, 0.977, CI [0.2, 28.08] | +6.73 (0.846) / +19.28 (0.957) | **KEEP** | vs V4: +36.00, 1.000, halves +21.98 / +50.02. Crowd-split mechanism (cluster-day DD) not measurable: rspy leaves 0 clusters. Avg notional/trade 4,681 → 3,661. |
| C3 | Core | same | `4a40e3df-cd9d-46a5-a8ff-7df21f3b28f3` | -1,020.26 | 217 | -12.06 | +2.23 (`e0c5f5eb-a55d-46d3-a35c-3ee042150d9f`) | C2 | +12.71, 1.000 | agree | Core agrees | vs V4: +63.39, 1.000. Notional 4,842 → 3,899. |
| C3b | Momentum | C2 + `"tradeUsd":3950` (size-matched control for C3) | `09bcf657-b709-4073-9124-a5bcb4edd772` | -702.72 | 258 | -7.43 | — | — | C3 vs C3b: +6.46, 0.879, CI [−3.77, 18.32] | +5.41 (0.812) / +7.51 (0.780) | control | About half of C3's $ gain over C2 is just smaller bets; the reallocation adds real per-dollar edge on Momentum. |
| C3b | Core | same | `1409458d-a6ff-4e88-993f-40c5e9e3c9bd` | -1,106.17 | 217 | -13.59 | — | — | C3 vs C3b: +2.68, 0.758 | +5.52 / −0.15 (disagree) | control | Reallocation effect weak on Core. |
| C4 | Momentum | C3 + `"stopZ":100` | `07dfbd56-9909-4b50-8e1b-b65dac410bb8` | -450.00 | 256 | -4.80 | — | C3 | +1.44, 0.828 | +1.73 / +1.14 | **REJECT** | Passes on Momentum alone, but Core contradicts. |
| C4 | Core | same | `454accb9-1e05-4d4d-a4b6-247c0e360415` | -1,068.04 | 211 | -12.86 | — | C3 | −1.49, 0.106 | — | Core contradicts | Core bps worse (−12.06 → −12.86); p5 trade −73.5 → −78.0. |

**Final S2 stack = C3** (`useRelativeToSpy`, `rtsMinOwnShare` 0.7, `useCrowdSplit`). New configs spent: 3 (C3, C3b, C4); C1/C2 reproduce R1-01/RS-02 and aren't counted. The best stack still loses money: Momentum −$496, −5.25 bps/trade, gross +8.98 against ~14.2 round-trip cost.

### S5 formed strategy: F1 SPY divergence (from the S4 survey)

`useSpyDivergence` (code VERSION 7 + S5 block; **VERSION bump needed**). Entry, replacing the baseline's: 1.5 ≤ |z| < 3.5, edge ≥ 0, **SPY stretched ≥ 1σ the opposite way** this minute, and **1–2 VWAP crossings** in the last 60 bars. Side from z, SPY not traded, baseline exits. Bins are taken unchanged from [strategy-survey.md](results/strategy-survey.md), candidate 1; nothing was tuned. Parity with the switch off: Mom `c2ed2883-035c-4eb5-9ae4-5094f7551cd5` = A04, Core `bcc56d58-626c-47d6-90b5-43b084cbb206` = A03.

| ID | Universe | backtestId | Net $ | Trades | Net bps/trade | Win % | Exits (n, avg gross bps) | Boot vs V4 (Δ $/day, share, halves) | Boot vs C3 | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| F1 | Momentum | `2a628992-074b-4673-aabe-06555b13792a` | **+107.16** | 32 | **+7.14** | 46.9 | target 10 (+59.4), time 22 (−6.2) | +54.84, 1.000, +31.75 / +77.94 | +18.85, 0.976, halves +9.77 (0.75) / +27.92 (0.99) | **First positive net.** But only 32 trades on 18 days, and the top 2 days carry 73% of the gross. |
| F1 | Core | `9756c285-ffa2-4dcf-9fb4-3c53a97ba6cd` | −44.64 | 14 | −6.57 | 42.9 | time 11 (−7.8), target 3 (+31.4) | +93.88, 1.000 | — | Same direction per trade (−15.32 → −6.57 bps), still negative; 14 trades. |

| F2 | Momentum | `952a5479-db3d-42d7-8f3e-f4f0b6de8708` | −307.55 | 104 | −6.21 | 46.2 | target 39 (+38.1), time 62 (−20.6), close 2, stop 1 | +41.88, 0.999, +8.13 (0.73) / +75.64 | +5.89, **0.703**, halves −13.85 (0.20) / +25.62 (0.97): disagree | `useOwnQuietEntry` (survey candidate 2: own share > 0.945, day move ≤ 47.1 bps). Parity Mom `7ffef46a-…`, Core `cb7d5998-…` = A04/A03. **Not better than C3** per trade (−5.25) or by bootstrap. Iteration stopped here (lead: stop when gains are marginal). |
| F2 | Core | `d349db3d-6d57-4be0-9978-4eb847a4b8af` | −1,213.82 | 176 | −14.40 | 33.5 | time 122 (−14.6), target 44 (+18.5), close 6, stop 4 | +57.34, 1.000 | — | Core edge about zero, as the survey warned. |

Configs used: **21 of ~30** (S5: F1, F2).

**Reading.** Per trade, F1 is the first rule whose edge clearly exceeds the round trip on Momentum. It's also the most-searched result in the project: 1 of 1,309 surveyed groups, with a trade count too small for the halves or a bootstrap to carry much weight. Against V4 the bootstrap is uninformative, because a rule that barely trades beats a losing one by default. Treat it as a **hypothesis for Stage 3**, not evidence.

### Signal series F3–F5: pre-registration (2026-11-23, before any run)

**F3–F5 selection rule.**
- **Candidates:** the 26 flagged set (b) groups in [strategy-survey.md](results/strategy-survey.md), minus F1 and F2, minus the crowded-minute groups (dropped earlier as one-off episodes).
- **Score:** engine-feasible simulated net bps/trade on Momentum (one position per symbol, next-open fill, protocol costs), from `runtime/team3Analysis/evaluate.ts`.
- **To qualify:** ≥ 60 simulated Momentum trades, best day ≤ 30% of the edge sum, both halves ≥ 0, and Core of the same sign.
- **Pick:** the top 3, with **at most 2 containing "SPY opposite"**.
- **Before ranking:** the evaluator must reproduce the F1 and F2 engine runs.

**Try count:** 21 → 24.

**Amendment (lead, 2026-11-23, after the evaluation in [signal-eval.md](results/signal-eval.md); a rule change made after seeing the data).**
- No candidate qualified under the pre-registered rule.
- The lead relaxed the trade minimum to **≥ 30 simulated Momentum trades**, and required a **legitimately new idea**: not F1 plus one more condition.
- **F3** = |z| > 1.947 AND crossings60 in 1–2 AND SPY neutral (|zSPY| < 1). Simulated: Momentum 31 trades, +4.75 bps, halves +7.34 / +3.05; Core +5.09.
- **F4 and F5 are removed.**
- Other slots stay unspent.

### F3 (results, 2026-11-23)

Parity with `useConditionEntry` off: Mom `7e745d10-…` = A04, Core `54554839-…` = A03. VERSION 8 parity: Mom `d2129489-7410-4568-8f3c-32e9c041a052`, Core `b218e0de-69d1-4aa4-8536-9a3ac19726da` = A04/A03.

| ID | Universe | Config | backtestId | Net $ | Trades | Net bps/trade | Win % | Exits (n, avg gross bps) | Bootstrap vs parent (Δ $/day, share; halves) | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| F3 | Mom | `{"useConditionEntry":true,"ceRanges":{"absZ":[1.947,null],"crossings60":[0,2]},"ceSpySide":"neutral"}` | `f27874dd-8c1e-4898-b908-56e8c108d2d3` | **+69.22** | 31 | **+4.75** | 61.3 | target 8 (+86.5), time 21 (−12.5), stop 2 | vs V4 +53.66, 1.000; +21.29 (0.96) / +86.02. vs F1 −1.19, 0.427 | Matches the offline simulation exactly. |
| F3 | Core | same | `d47f1ca0-71a9-4901-8ff3-4d36e88f31a1` | **+71.15** | 29 | **+5.09** | 41.4 | target 7 (+62.5), time 22 (−3.7) | vs V4 +97.50, 1.000 | **The only signal positive on both universes.** |

Configs used: **22 of ~30** (F3). F3 is the only signal positive on both universes in-sample, on about 30 trades per universe, picked under a rule relaxed after the data had been seen.

### L series: maxHoldBars on the working candidates (pre-registration, 2026-11-23, before any run)

Lead decision: hold longer, testing only the in-sample winners, F1 and F3 (the final candidates). V4 and C3 appear in the offline sweep for context only. The rule was fixed in the plan before the sweep ran; the values below are read off [hold-sweep.md](results/hold-sweep.md), which is offline and spends 0 configs.

**Rule, per parent (F1, F3):**
- **L-mid:** the H in (30, 60] with the best sweep Momentum net bps.
- **L-long:** the H in (60, 180] with the best sweep Momentum net bps.
- An H qualifies only if Core's sweep net at that H isn't below Core's at 30.

**Rows:**

| Row | Config | Picked because |
|---|---|---|
| L1 | F1 + `"maxHoldBars":50` | 35, 40 and 45 fail the Core check |
| L2 | F1 + `"maxHoldBars":150` | 180 fails Core |
| L3 | F3 + `"maxHoldBars":45` | 60 fails Core |
| L4 | F3 + `"maxHoldBars":90` | best long H; 120 (the lead's offline test) is reported next to it |

**Neighbour checks (conditional):** L5 and L6 each rerun a passing L row at the next grid H toward 30, and only if that row passes.

**Each row:**
- runs once per universe, in-sample, with `TEAM3_DUMP`;
- is bootstrapped against its parent (F1 `2a628992`/`9756c285`, F3 `f27874dd`/`d47f1ca0`, two-ID form, same universe) and against V4 (one-ID form).

**True test vs the parent:** all five must hold.
1. Net bps/trade goes up.
2. Bootstrap share ≥ 0.8.
3. Both halves agree.
4. Core doesn't contradict.
5. The mechanism holds: matched on symbol + entry time, the time-stop losses removed are larger than the winners lost, and the real trade count against the fixed-entry sweep is reported.

**Try count:** 22 → 26, or 28 if both neighbour checks run.

### L series (results, 2026-11-23)

Code VERSION 8. In-sample only, each row run once per universe, all with dumps.

**Columns:**
- **Mechanism (Δ, blocked):** matched on symbol + entry time against the parent's dump.
  - **Δ** = the summed change in gross bps on the parent's time-stopped trades.
  - **Blocked** = how many of the parent's trades the longer hold blocks, with their gross bps.
  - Target and stop exits happen before bar 30, so they're unchanged.
- **Fixed-entry sweep:** what the offline sweep predicted for that H.
- **Boot vs parent:** Δ $/day, the share of draws where the row beats its parent, and the halves.
- **vs V4** (one-ID form): every row reads 1.000 on both universes.

| ID | Universe | Config | backtestId | Net $ | Trades | Net bps/trade | Win % | Sharpe (daily) | Max DD $ | Avg bars | Exits (n, avg gross bps) | Boot vs parent (Δ $/day, share; halves) | Mechanism (Δ, blocked) | Fixed-entry sweep (trades, net bps) | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| L1 | Mom | F1 + `"maxHoldBars":50` | `bd53044c-192f-4c9f-be33-7cb6c212650f` | +95.84 | 29 | +7.02 | 55.2 | 1.52 | 171.3 | 35.0 | target 14 (+50.8), time 15 (−20.3) | vs F1 −0.35, 0.465; −0.19 (0.44) / −0.52 (0.49) | −30.6; 3 blocked (+21.4) | 32, +6.1 | **Fails**: bps/trade ↓, share < 0.8, mechanism ✗ |
| L1 | Core | same | `31e1b324-ec8d-463d-bb61-30b716c61a5e` | +13.80 | 13 | +2.18 | 46.2 | 0.78 | 59.6 | 40.2 | time 8 (−1.5), target 5 (+27.6) | vs F1 +1.83, 0.943 | +119.7; 1 blocked (+2.2) | 14, −0.5 | Core better |
| L2 | Mom | F1 + `"maxHoldBars":150` | `839972a3-6c88-44cc-bedf-cec91726456e` | **+194.75** | 29 | **+14.27** | 69.0 | 3.35 | 229.3 | 72.5 | target 19 (+46.0), time 7 (−29.5), close 3 (−18.5) | vs F1 +2.74, **0.884**, CI [−1.84, 7.28]; +4.23 (0.97) / +1.25 (0.64), agree | +175.1; 3 blocked (+21.4) ✓ | 32, +12.0 | **Passes the true test** |
| L2 | Core | same | `e85ff2d5-d689-42aa-8ddd-d78a2f5e9b57` | +11.17 | 13 | +1.77 | 61.5 | 0.41 | 88.1 | 78.6 | target 9 (+28.5), time 4 (−34.5) | vs F1 +1.74, 0.818; +3.13 / +0.35 | (Core) | 14, −2.4 | Core agrees (−6.57 → +1.77) |
| L3 | Mom | F3 + `"maxHoldBars":45` | `2025ac41-2ac3-41ea-a333-c392abc50046` | +58.52 | 30 | +4.14 | 56.7 | 1.15 | 135.2 | 35.2 | time 18 (−22.3), target 10 (+82.3), stop 2 (−55.7) | vs F3 −0.33, 0.485; halves disagree | +68.7; 1 blocked (+77.6) ✗ | 31, +4.8 | **Fails** |
| L3 | Core | same | `e8fbe9e2-139a-4788-832e-98619377788a` | +60.25 | 28 | +4.46 | 46.4 | 1.22 | 149.7 | 37.4 | time 21 (−5.3), target 7 (+62.5) | vs F3 −0.34, 0.423 | −37.1; 1 blocked (−8.2) | 29, +5.0 | Core worse |
| L4 | Mom | F3 + `"maxHoldBars":90` | `5db5cd37-ace1-4d15-9473-281a2b36b371` | +104.19 | 30 | +7.37 | 56.7 | 2.16 | 159.3 | 57.1 | time 11 (−42.9), target 15 (+71.8), close 2 (−47.9), stop 2 (−55.7) | vs F3 +1.09, 0.680; −3.32 (0.21) / +5.50 (0.99), disagree | +157.3; 1 blocked (+77.6) ✓ | 31, +7.8 | **Fails**: share < 0.8, halves disagree |
| L4 | Core | same | `1247aa91-e9b8-41bd-afd3-d11e45d76a55` | +106.11 | 28 | +7.85 | 50.0 | 2.25 | 146.8 | 68.0 | target 10 (+55.3), time 17 (−12.5), close 1 (+88.5) | vs F3 +1.09, 0.730; +4.98 (0.98) / −2.80 (0.06), disagree | +65.4; 1 blocked (−8.2) | 29, +8.5 | |
| L5 (neighbour of L2) | Mom | F1 + `"maxHoldBars":120` | `a17afd1b-a6a6-4232-9864-923de2b72bca` | +138.51 | 29 | +10.15 | 69.0 | 1.80 | 229.3 | 64.6 | target 18 (+47.6), time 9 (−36.0), close 2 (−24.8) | vs F1 +0.98, 0.639; +5.28 (0.99) / −3.32 (0.37), disagree | +46.8; 3 blocked (+21.4) | 32, +7.9 | **Fails**: share < 0.8, halves disagree |
| L5 | Core | same | `06fd500d-3cd4-4556-9be4-3bc8c9d1c265` | +9.94 | 13 | +1.57 | 61.5 | 0.38 | 84.7 | 69.3 | target 9 (+28.5), time 4 (−34.4) | vs F1 +1.71, 0.820 | +112.5; 1 blocked (+2.2) | 14, −0.7 | |

**Reading.**
- **The one pass doesn't survive its neighbour.**
  - L2 (F1, hold 150) passes all five checks.
  - L5, the pre-registered neighbour at 120, still improves bps/trade (+7.14 → +10.15), but its share is 0.64 and its second half turns negative.
  - So L2's gain rests on a few F1 trades that happen to revert between bars 120 and 150. That's a fragile peak, not a plateau. L6 isn't run, since no other row passed.
- **Longer holds keep the trades; they change the exits.**
  - Real trade counts fell by only 1–3 against the fixed-entry sweep. F1 and F3 trade too rarely for a longer hold to block much.
  - The real bps/trade track the sweep's direction on every row.
- **F3 doesn't gain from holding longer.**
  - L3 (45) is flat to worse.
  - L4 (90) lifts both universes (Momentum +4.75 → +7.37, Core +5.09 → +7.85). But the halves split in opposite directions on the two universes, and neither share reaches 0.8.
- **Core moves with F1 on every hold** (−6.57 → about +1.6 to +2.2), but on 13 trades.
- **Configs used: 27 of ~30** (22 + L1–L5); 3 stay in reserve.

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
