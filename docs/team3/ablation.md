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
| A01 | | 3 | Core | IS | baseline (all off) | A00 | | | | | | | | | | |
