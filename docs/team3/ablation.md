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
| A00 | | — | Core | IS | `beginner_reversal` reference (fade every bar) | — | | | | | | | | | | |
| A01 | 2026-11-22 | 3 | Core | IS | baseline (all off) | A00 | -3,154.64 | 433 | -15.34 | 26.1 | 0.71 | 0.25 | -19.72 | 3,191.60 (3.19%) | `939cfd88-7b80-446d-bc41-7b14494dba54` | Profitable on only 2 of 33 days (worst day -271); the -15 bps/trade is about the modeled round-trip cost (2 x 5 bps slippage + 2 x 2 bps half spread), so the gross edge is near zero. Run with `runtime/team3Backtest.ts`. |
| A02 | 2026-11-22 | 3 | Momentum | IS | baseline (all off) | A01 | -1,674.25 | 375 | -9.55 | 37.1 | 1.00 | 0.59 | -10.12 | 1,769.78 (1.77%) | `ccabf708-8835-4366-8cd4-e1f82dc1a207` | Smaller loss than Core with a higher win rate, but still under costs; profitable on 27% of days (worst day -362). |
