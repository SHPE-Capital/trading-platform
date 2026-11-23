# Stage 2 ledger: R2 regime (branch `team3/r2`)

Only the `team3/r2` session writes this file. It's merged into [ablation.md](../ablation.md) in the combining step.
Rules: [MASTER, Testing rules](../MASTER.md#testing-rules) and [Parallel Stage 2](../MASTER.md#parallel-stage-2). Prompt: [prompts/r2.md](prompts/r2.md).

- IDs: `R2-01`, `R2-02`, … for configs; `R2-V1…` for parity rows; `R2-D1…` for diagnostics (V and D rows don't count toward the budget).
- Baseline (frozen V4): A03 Core `1872fd42-331a-4a8c-a488-460231ac8552`, A04 Momentum `4b060cbe-2834-4996-8b6b-c223bef772ed`. Reversion share 15.5% Core / 17.6% Momentum.
- Bootstrap: `npx ts-node src/runtime/team3Bootstrap.ts <rowId>` (it picks the row's own universe's baseline).
- **Parity:** not required: R2 adds no strategy code (`useVwapRegime` and `TEAM3_EXCLUDE` already exist; `r2.ts` is metric-only). R2-D1/D2 rerun the baseline anyway.
- **Pre-registration:** write each row's config, the predicted direction of its mechanism check, and any definition it needs (e.g. "trend day") **here, before running it.**

## Pre-registered rows

| ID | Config vs baseline | Mechanism check and predicted direction | Definitions |
|---|---|---|---|
| R2-D1, R2-D2 | none (baseline config rerun, Core / Momentum). Diagnostic, free. | Gives the baseline's trend-day time-stop split for R2-02 (the frozen A03/A04 runs predate `r2.ts`). Must reproduce A03/A04 net exactly. | Trend day as below. |
| R2-01 (Q2.5) **universe row** | no config change; Core `TEAM3_EXCLUDE=SPY,QQQ`, Momentum `TEAM3_EXCLUDE=SPY` | Core's **gross edge (bps/trade before costs)** moves up toward Momentum's: Core zero-cost twin > D3's −1.08 bps; Momentum twin stays ≈ D4's +4.70 or rises. Twins = R2-D3 (Core), R2-D4 (Momentum), `TEAM3_DIAGNOSTIC=zero_cost`. | Gross edge = mean `pnlBpsGross` of the zero-cost twin's round trips (also reported as `mechanism.r2.grossBpsPerTrade`). |
| R2-02 (Q2.7) | `{"useVwapRegime":true}` (default knobs 4 / 60) | **fewer time-stop exits on trend days** (`mechanism.r2.timeStopsTrendDays` below R2-D1/R2-D2), on both universes; share of time stops on trend days also falls. | **Trend day** (fixed before any run): per symbol-day, regular-session (9:30–15:58 bar starts) move \|last close − first open\| ÷ first open ≥ the 75th percentile of that move across all symbol-days in the run's `barsBySymbol`. Bars don't depend on config, so for a fixed universe the threshold equals the baseline's. A trade belongs to its entry day. |

## Results

| ID | Date run | Goal | Window | Universe | Config vs baseline | Code VER | backtestId | Rep | Net P&L $ | Trades | Avg bps/trade | Rev % | Exit mix | Win % | PF | Sharpe | Max DD $ (%) | Bootstrap all (Δ $/day, share, 95% CI) | 1st half (Δ, share) | 2nd half (Δ, share) | Mechanism value | Keep (net↑ Mom, share ≥ 0.8, mech, halves, Core) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

## Recommendation
_(One paragraph when the session is done. No promotion: the lead decides.)_

**VERSION bump needed:** _(yes/no, and why)_
