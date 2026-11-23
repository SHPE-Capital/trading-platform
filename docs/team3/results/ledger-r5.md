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
| R5-V1 | 2026-11-23 | R5 | IS 09-01 → 10-15 | Momentum | none (switch off) | 6+r5 | `19353e5d-f10f-4263-829e-7903b585e254` | no | -1,647.82 | 370 | -9.52 | 17.6 | time 283, target 65, close 11, stop 11 | 37.3 | 0.59 | -10.24 | 1,745.12 (1.74%) | — | — | — | capBind 0; symStd 179.88; clusters 6 / 3 days; worstCluster −81.55; clusterDayDD 339.57 | — | Parity: identical to A04. Mechanism baselines for Momentum. |
| R5-V2 | 2026-11-23 | R5 | IS 09-01 → 10-15 | Core | none (switch off) | 6+r5 | `acb2788a-ba91-42f7-9bc1-69e5964dced1` | no | -3,048.74 | 419 | -15.32 | 15.5 | time 324, target 65, stop 22, close 8 | 27.2 | 0.26 | -21.46 | 3,085.70 (3.08%) | — | — | — | capBind 0; symStd 81.08; clusters 6 / 5 days; worstCluster −87.02; clusterDayDD 655.74 | — | Parity: identical to A03. Mechanism baselines for Core. |
| R5-01 | 2026-11-23 | R5 | IS 09-01 → 10-15 | Momentum | `useVolSizing:true, riskPerTradeUsd:5` | 6+r5 | `0e098f15-8020-4abb-8a0f-c0c8dbe7a5e3` | no | -2,573.53 | 370 | -11.73 | 17.6 | time 283, target 65, close 11, stop 11 | 37.6 | 0.43 | -15.87 | 2,617.64 (2.62%) | −28.93, 0.000, [−41.92, −16.33] | −30.38, 0.000 | −27.48, 0.004 | capBind 0.278 (↑ from 0); symStd 265.64 (↑) ; clusterDayDD 466.42 | ✗ ✗ ✗ ✗(both <0) ✗ | Same entries/exits; only sizes change. Sizes up on calm names, which have the thinnest edge vs costs (R5 §1). |
| R5-01 | 2026-11-23 | R5 | IS 09-01 → 10-15 | Core | same | 6+r5 | `b4e14b25-92e6-4073-b7e9-d6752c65f038` | no | -4,972.06 | 419 | -15.48 | 15.5 | time 324, target 65, stop 22, close 8 | 27.2 | 0.20 | -24.03 | 4,998.49 (5.00%) | −60.10, 0.000, [−76.18, −45.07] | −44.88, 0.000 | −75.33, 0.000 | capBind 0.458 (↑); symStd 143.81 (↑); clusterDayDD 981.91 | (Core contradicts nothing: also worse) | 0 of 32 days profitable. |
| R5-02 | 2026-11-23 | R5 | IS 09-01 → 10-15 | Momentum | `useCrowdSplit:true` | 6+r5 | `97caa151-ca62-41b9-94a0-db5e98dbdb0f` | no | -1,038.37 | 370 | -8.05 | 17.6 | time 283, target 65, close 11, stop 11 | 37.3 | 0.63 | -9.99 | 1,158.43 (1.16%) | +19.05, 0.995, [3.53, 38.54] | +8.43, 0.888 | +29.66, 0.991 | clusterDayDD 103.33 (↓ from 339.57); worstCluster −18.06 (↓ from −81.55); symStd 146.32 | ✓ ✓ ✓ ✓ ✓ | Same trades; smaller size in crowded minutes. Commissions 37.5 → 27.9, so ~25% less notional: part of the gain is just betting less on a losing strategy. bps/trade still improves (−9.52 → −8.05). Strategy still loses money. |
| R5-02 | 2026-11-23 | R5 | IS 09-01 → 10-15 | Core | same | 6+r5 | `d0207c12-ffbe-4d88-89b1-7b946ff769d6` | no | -1,995.27 | 419 | -14.53 | 15.5 | time 324, target 65, stop 22, close 8 | 27.2 | 0.29 | -21.16 | 2,009.77 (2.01%) | +32.92, 1.000, [20.49, 47.37] | +29.55, 1.000 | +36.29, 1.000 | clusterDayDD 336.51 (↓ from 655.74); worstCluster −25.58 (↓ from −87.02) | Core agrees | Worst day −244 → −133. |

## Recommendation
Parity holds (R5-V1/V2 identical to A04/A03). **R5-01 (vol sizing, $5) fails every condition**: it moves dollars to calm names whose edge barely covers costs, the cap binds more (28% / 46% of entries, prediction was down) and spread across symbols grows; drop it. **R5-02 (crowd split) passes all five keep-rule conditions** on Momentum (+$19/day, share 0.995, both halves > 0) and Core agrees (+$33/day, share 1.00); cluster-day drawdown falls ~70% / ~50% as predicted. Caveat for the lead: trades, exits and reversion share don't change, and traded dollars fall ~25%, so much of the net gain comes from betting less on a strategy that still loses money; bps/trade improves only modestly (−9.52 → −8.05 Momentum, −15.32 → −14.53 Core). Recommend R5-02 as a combining-step candidate (risk control, not edge); re-check it on the stack once an edge-adding winner is in.

**VERSION bump needed:** yes. New switch `useCrowdSplit` (default off) changes sizing logic in `team3ReversalStrategy.ts` / `sizing.ts`; set VERSION 7 in the combining step.
