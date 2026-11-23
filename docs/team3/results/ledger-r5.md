# Stage 2 ledger: R5 portfolio (branch `team3/r5`)

Only the `team3/r5` session writes this file. It's merged into [ablation.md](../ablation.md) in the combining step.
Rules: [MASTER, Testing rules](../MASTER.md#testing-rules) and [Parallel Stage 2](../MASTER.md#parallel-stage-2). Prompt: [prompts/r5.md](prompts/r5.md).

- IDs: `R5-01`, `R5-02`, … for configs; `R5-V1…` for parity rows; `R5-D1…` for diagnostics (V and D rows don't count toward the budget).
- Baseline (frozen V4): A03 Core `1872fd42-331a-4a8c-a488-460231ac8552`, A04 Momentum `4b060cbe-2834-4996-8b6b-c223bef772ed`. Reversion share 15.5% Core / 17.6% Momentum.
- Bootstrap: `npx ts-node src/runtime/team3Bootstrap.ts <rowId>` (it picks the row's own universe's baseline).
- **Pre-registration:** write each row's config, the predicted direction of its mechanism check, and any definition it needs (e.g. "trend day") **here, before running it.**

## Pre-registered rows

| ID | Config vs baseline | Mechanism check and predicted direction | Definitions |
|---|---|---|---|
| R5-V1/V2 | `{}` (switch off) on Momentum / Core | parity: net, trades, exit mix identical to A04 / A03 | n/a |
| R5-01 | `{"useVolSizing":true,"riskPerTradeUsd":5}` | `capBindShare` ↓ vs baseline (baseline fixed sizing ≈ 0, so the real test is that it stays low, i.e. sizes mostly inside the caps) and `symbolPnlStdUsd` ↓ vs baseline | cap binds = entry qty < qtyWanted |
| R5-02 | `{"useCrowdSplit":true}` | `clusterDayMaxDdUsd` ↓ vs baseline (also expect `worstClusterLossUsd` less negative) | **Cluster** = ≥ 3 same-side entries with the same signal minute. **Cluster day** = ET day with ≥ 1 cluster, taken from that run's own entries (crowd split doesn't change which entries fire). **Cluster-day max DD** = max drawdown of the equity path made of only cluster days' daily P&L, in date order. Trade $ = qty × entry close × gross bps (before exit costs). |

## Results

| ID | Date run | Goal | Window | Universe | Config vs baseline | Code VER | backtestId | Rep | Net P&L $ | Trades | Avg bps/trade | Rev % | Exit mix | Win % | PF | Sharpe | Max DD $ (%) | Bootstrap all (Δ $/day, share, 95% CI) | 1st half (Δ, share) | 2nd half (Δ, share) | Mechanism value | Keep (net↑ Mom, share ≥ 0.8, mech, halves, Core) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

## Recommendation
_(One paragraph when the session is done. No promotion: the lead decides.)_

**VERSION bump needed:** _(yes/no, and why)_
