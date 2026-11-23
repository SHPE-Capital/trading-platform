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

**Stage 2 configs used: 0 of ~20** (R3 0/4).

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

¹ A01/A02 ran before the runner logged exit reasons. The counts come from D1/D2. Exit decisions depend on bars only, not on fill costs, so a cost run and its zero-cost twin exit identically; D3 = A03 and D4 = A04 confirm it. Gross bps per reason differ between the twins (cost runs include entry slippage, about 7 bps lower), so only the counts are carried over.

### Checks

**65/65 target exits (2026-11-23):** Core (A03) and Momentum (A04) both end with 65 `target` exits. This is a coincidence, not shared or overwritten output:
- distinct backtestIds; each saved `config.strategyConfig.symbols` is its own universe; saved orders cover disjoint symbols apart from SPY
- gross target bps differ (+28.4 vs +52.2), and so do D2 vs D4 (66 vs 65 targets)
- per symbol (runner `exitsBySymbol`), SPY trades in both universes and has an identical exit row in each (time 62, target 6, stop 5, close 1). Per-symbol state is independent and the gross caps never bound, so that's expected. The other five symbols differ one by one but both sum to 59: Core QQQ 13, MSFT 15, GOOGL 11, AMZN 11, AAPL 9; Momentum AMD 15, META 13, MU 12, TSLA 10, NVDA 9
- rerunning both on 2026-11-23 reproduced them exactly (A03 `1872fd42-331a-4a8c-a488-460231ac8552`, A04 `b6efa90f-fca1-4677-85df-199d2b56d1bc`), which also shows the runs are deterministic

Median bars to `target`: 13 (Core), 14 (Momentum). Cost runs' "gross" exit bps include entry slippage, so they read ~7 bps lower than the diagnostics.
