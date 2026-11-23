# Team 3 Ablation Table

Rules and protocol: [AGENT_GUIDE.md §2](AGENT_GUIDE.md#2-ablation-table). Metrics: [§3](AGENT_GUIDE.md#3-metrics-for-a-reversal-strategy).
Never edit or delete a row; add a corrected one and mark the old one `superseded by Axx`.

**Protocol header (lead confirms once, before A01):**
- In-sample window: `2026-09-01` → `2026-10-15` (to be confirmed against cached data)
- Out-of-sample window: `2026-10-16` → `2026-11-13` (to be confirmed)
- Costs: slippage 5 bps (+ half spread 2 bps), $0.005/share · Capital: $100,000 · Bars: 1-min, regular session
- Engine risk config: `TEAM3_PROTOCOL.riskConfig` (`contract/protocol.ts`): kill switch off, engine caps above the strategy's
- VERSION 3 changes the baseline (VWAP reversion); rows from VERSION 2 are not comparable

| ID | Date run | VER | Group | Window | Config (vs defaults) | Compared to | Net P&L $ | Trades | Avg bps/trade | Win % | Payoff | PF | Sharpe | Max DD $ (%) | backtestId | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A00 | 2026-11-22 | BR 2 | Core | IS | `beginner_reversal` reference (fade every bar) | — | -37,838.40 | 54,032 | -14.14 | 1.3 | 0.63 | 0.01 | -86.89 | 37,838.40 (37.84%) | `bf3f149a-6e26-48d9-8f2f-d38741fbfd95` (summary save timed out; not in DB) | Loses exactly the round-trip cost on every trade: zero gross edge. 0 of 33 days profitable. |
| A00m | 2026-11-22 | BR 2 | Momentum | IS | `beginner_reversal` reference | — | -48,413.60 | 56,486 | -14.17 | 3.7 | 0.85 | 0.03 | -84.36 | 48,413.60 (48.41%) | `d29b333c-6b95-4d97-9278-70e66464c95f` (summary only; orders/fills too large to save) | Same: costs are the whole loss. |
| A01 | 2026-11-22 | 3 | Core | IS | baseline (all off) | A00 | -3,154.64 | 433 | -15.34 | 26.1 | 0.71 | 0.25 | -19.72 | 3,191.60 (3.19%) | `939cfd88-7b80-446d-bc41-7b14494dba54` | Profitable on only 2 of 33 days (worst day -271); the -15 bps/trade is about the modeled round-trip cost (2 x 5 bps slippage + 2 x 2 bps half spread), so the gross edge is near zero. Run with `runtime/team3Backtest.ts`. |
| A02 | 2026-11-22 | 3 | Momentum | IS | baseline (all off) | A01 | -1,674.25 | 375 | -9.55 | 37.1 | 1.00 | 0.59 | -10.12 | 1,769.78 (1.77%) | `ccabf708-8835-4366-8cd4-e1f82dc1a207` | Smaller loss than Core with a higher win rate, but still under costs; profitable on 27% of days (worst day -362). |
| A03 | 2026-11-22 | 4 | Core | IS | baseline v4 (M1: no entry at or past `stopZ`; M2: `riskPerTradeUsd` 5, unused here) | A01 | -3,048.74 | 419 | -15.32 | 27.2 | 0.69 | 0.26 | -20.57 | 3,085.70 (3.08%) | `b85e1db4-9793-4195-9229-522cd1051ec0` (summary save timed out; not in DB) | M1 removed 14 entries past the stop (stop exits 36→22), +$106. Exits: 324 time (−13.3 bps gross), 65 target (+28.4), 22 stop, 8 close. |
| A04 | 2026-11-22 | 4 | Momentum | IS | baseline v4 | A02 | -1,647.82 | 370 | -9.52 | 37.3 | 1.00 | 0.59 | -10.03 | 1,745.12 (1.74%) | `4b060cbe-2834-4996-8b6b-c223bef772ed` | M1: +$26. Exits: 283 time (−14.5), 65 target (+52.2), 11 stop, 11 close. |

**Diagnostics (zero cost, `TEAM3_DIAGNOSTIC=zero_cost`; never reportable as results):**

| ID | VER | Group | Gross P&L $ | Trades | Gross bps/trade | Win % | Exit mix (n, avg gross bps) | backtestId |
|---|---|---|---|---|---|---|---|---|
| D1 | 3 | Core | -225.20 | 433 | -1.09 | 48.3 | time 324 (−6.2), target 65 (+35.4), stop 36 (−22.4), close 8 (+3.4) | `574736ac-ce71-4c8f-b966-395714dee8a6` |
| D2 | 3 | Momentum | +817.17 | 375 | +4.66 | 55.5 | time 283 (−7.6), target 66 (+59.1), stop 15 (−25.6), close 11 (+18.7) | `38d9139b-312f-4341-8bdf-17b8a1ecef0f` |
| D3 | 4 | Core | -215.21 | 419 | -1.08 | 49.4 | time 324 (−6.3), target 65 (+35.4), stop 22 (−33.4), close 8 (+3.4) | `e6bf3eb9-028e-4f6a-9be3-c5f120a63c40` |
| D4 | 4 | Momentum | +812.94 | 370 | +4.70 | 55.4 | time 283 (−7.5), target 65 (+59.2), stop 11 (−35.2), close 11 (+18.7) | `68934a6c-0b91-40e8-97b6-3eaf55b9f3e3` |

Median bars to `target`: 13 (Core), 14 (Momentum). Cost runs' "gross" exit bps include entry slippage, so they read ~7 bps lower than the diagnostics.
