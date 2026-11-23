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

| ID | Date run | VER | Group | Window | Config (vs defaults) | Compared to | Net P&L $ | Trades | Avg bps/trade | Win % | Payoff | PF | Sharpe | Max DD $ (%) | backtestId | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A00 | 2026-11-22 | BR 2 | Core | IS | `beginner_reversal` reference (fade every bar) | — | -37,838.40 | 54,032 | -14.14 | 1.3 | 0.63 | 0.01 | -86.89 | 37,838.40 (37.84%) | `bf3f149a-6e26-48d9-8f2f-d38741fbfd95` (summary save timed out; not in DB) | Loses exactly the round-trip cost on every trade: zero gross edge. 0 of 32 days profitable. Sharpe −86.89 was computed over a phantom 33rd day (UPSTREAM #10); recomputed after the rerun. |
| A00m | 2026-11-22 | BR 2 | Momentum | IS | `beginner_reversal` reference | — | -48,413.60 | 56,486 | -14.17 | 3.7 | 0.85 | 0.03 | -275.74 | 48,413.60 (48.41%) | `d29b333c-6b95-4d97-9278-70e66464c95f` (summary only; orders/fills too large to save) | Same: costs are the whole loss. 0 of 32 days profitable. Sharpe corrected from −84.36 (phantom 33rd day, UPSTREAM #10). |
| A01 | 2026-11-22 | 3 | Core | IS | baseline (all off) | A00 | -3,154.64 | 433 | -15.34 | 26.1 | 0.71 | 0.25 | -20.54 | 3,191.60 (3.19%) | `939cfd88-7b80-446d-bc41-7b14494dba54` | Profitable on only 2 of 32 days (worst day -271; Sharpe corrected from −19.72, phantom 33rd day, UPSTREAM #10); the -15 bps/trade is about the modeled round-trip cost (2 x 5 bps slippage + 2 x 2 bps half spread), so the gross edge is near zero. Run with `runtime/team3Backtest.ts`. |
| A02 | 2026-11-22 | 3 | Momentum | IS | baseline (all off) | A01 | -1,674.25 | 375 | -9.55 | 37.1 | 1.00 | 0.59 | -10.34 | 1,769.78 (1.77%) | `ccabf708-8835-4366-8cd4-e1f82dc1a207` | Smaller loss than Core with a higher win rate, but still under costs; profitable on 9 of 32 days (28%; worst day -362). Sharpe corrected from −10.12 (UPSTREAM #10). |
| A03 | 2026-11-22 | 4 | Core | IS | baseline v4 (M1: no entry at or past `stopZ`; M2: `riskPerTradeUsd` 5, unused here) | A01 | -3,048.74 | 419 | -15.32 | 27.2 | 0.69 | 0.26 | -20.57 | 3,085.70 (3.08%) | `b85e1db4-9793-4195-9229-522cd1051ec0` (summary save timed out; not in DB) | M1 removed 14 entries past the stop (stop exits 36→22), +$106. Exits: 324 time (−13.3 bps gross), 65 target (+28.4), 22 stop, 8 close. Sharpe −20.57 includes the phantom 33rd day (UPSTREAM #10); recomputed after the rerun. |
| A04 | 2026-11-22 | 4 | Momentum | IS | baseline v4 | A02 | -1,647.82 | 370 | -9.52 | 37.3 | 1.00 | 0.59 | -10.24 | 1,745.12 (1.74%) | `4b060cbe-2834-4996-8b6b-c223bef772ed` | M1: +$26. 9 of 32 days profitable (worst −355). Sharpe corrected from −10.03 (UPSTREAM #10). Exits: 283 time (−14.5), 65 target (+52.2), 11 stop, 11 close. |

**Diagnostics (zero cost, `TEAM3_DIAGNOSTIC=zero_cost`; never reportable as results):**

| ID | VER | Group | Gross P&L $ | Trades | Gross bps/trade | Win % | Exit mix (n, avg gross bps) | backtestId |
|---|---|---|---|---|---|---|---|---|
| D1 | 3 | Core | -225.20 | 433 | -1.09 | 48.3 | time 324 (−6.2), target 65 (+35.4), stop 36 (−22.4), close 8 (+3.4) | `574736ac-ce71-4c8f-b966-395714dee8a6` |
| D2 | 3 | Momentum | +817.17 | 375 | +4.66 | 55.5 | time 283 (−7.6), target 66 (+59.1), stop 15 (−25.6), close 11 (+18.7) | `38d9139b-312f-4341-8bdf-17b8a1ecef0f` |
| D3 | 4 | Core | -215.21 | 419 | -1.08 | 49.4 | time 324 (−6.3), target 65 (+35.4), stop 22 (−33.4), close 8 (+3.4) | `e6bf3eb9-028e-4f6a-9be3-c5f120a63c40` |
| D4 | 4 | Momentum | +812.94 | 370 | +4.70 | 55.4 | time 283 (−7.5), target 65 (+59.2), stop 11 (−35.2), close 11 (+18.7) | `68934a6c-0b91-40e8-97b6-3eaf55b9f3e3` |

### Checks

**65/65 target exits (2026-11-23):** Core (A03) and Momentum (A04) both end with 65 `target` exits. This is a coincidence, not shared or overwritten output:
- distinct backtestIds; each saved `config.strategyConfig.symbols` is its own universe; saved orders cover disjoint symbols apart from SPY
- gross target bps differ (+28.4 vs +52.2), and so do D2 vs D4 (66 vs 65 targets)
- per symbol (runner `exitsBySymbol`), SPY trades in both universes and has an identical exit row in each (time 62, target 6, stop 5, close 1). Per-symbol state is independent and the gross caps never bound, so that's expected. The other five symbols differ one by one but both sum to 59: Core QQQ 13, MSFT 15, GOOGL 11, AMZN 11, AAPL 9; Momentum AMD 15, META 13, MU 12, TSLA 10, NVDA 9
- rerunning both on 2026-11-23 reproduced them exactly (A03 `1872fd42-331a-4a8c-a488-460231ac8552`, A04 `b6efa90f-fca1-4677-85df-199d2b56d1bc`), which also shows the runs are deterministic

Median bars to `target`: 13 (Core), 14 (Momentum). Cost runs' "gross" exit bps include entry slippage, so they read ~7 bps lower than the diagnostics.
