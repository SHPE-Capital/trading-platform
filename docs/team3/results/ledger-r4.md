# Stage 2 ledger: R4 exits (branch `team3/r4`)

Only the `team3/r4` session writes this file. It's merged into [ablation.md](../ablation.md) in the combining step.
Rules: [MASTER, Testing rules](../MASTER.md#testing-rules) and [Parallel Stage 2](../MASTER.md#parallel-stage-2). Prompt: [prompts/r4.md](prompts/r4.md).

- IDs: `R4-01`, `R4-02`, … for configs; `R4-V1…` for parity rows; `R4-D1…` for diagnostics (V and D rows don't count toward the budget).
- Baseline (frozen V4): A03 Core `1872fd42-331a-4a8c-a488-460231ac8552`, A04 Momentum `4b060cbe-2834-4996-8b6b-c223bef772ed`. Reversion share 15.5% Core / 17.6% Momentum.
- Bootstrap: `npx ts-node src/runtime/team3Bootstrap.ts <rowId>` (it picks the row's own universe's baseline).
- **Pre-registration:** write each row's config, the predicted direction of its mechanism check, and any definition it needs (e.g. "trend day") **here, before running it.**

## Pre-registered rows

| ID | Config vs baseline | Mechanism check and predicted direction | Definitions |
|---|---|---|---|
| R4-01 (Q2.6) stop off | `{"stopZ":100}` | The trades the baseline stopped (Momentum 11, Core 22 in R4-V1/V2 = A04/A03) **don't turn into bigger losses**: matched by symbol + entry signal time, their mean gross bps in R4-01 ≥ their mean gross bps in the baseline (−42.2 Mom / −40.4 Core). Also reported: p5 trade, max DD, worst day. | "Matched" = same symbol and same entry signal bar ts in both runs; unmatched baseline stopped trades are reported as a count. Gross bps = exit-bar close vs entry fill (`pnlBpsGross`). Caveat known before running: `stopZ` also caps entries (M1: no entry at/past `stopZ`), so stopZ 100 also admits entries with |z| ≥ 3.5; `entriesPastStop` is reported. |
| R4-02 (feature #6) partway target | `{"usePartwayTarget":true,"tpFraction":0.5}` | vs baseline: **win rate ↑, avg win ↓, net holds** (net P&L ≥ baseline). Win rate / avg win / avg loss from `mechanism.r4` (gross bps per round trip, win = gross > 0). | z₀ = vwapZ of the entry signal bar. Partway: short `z ≤ 0.5·z₀`, long `z ≥ 0.5·z₀`; exit reason `partway`, checked after stop and target, before time. Reversion share = (target + partway) / round trips. |
| R4-03 scale out half (conditional) | `{"useScaleOut":true,"tpFraction":0.5}` | same as R4-02. **Run only if R4-02 fails the keep rule.** | Close floor(qty/2) at the partway point (all if 0); the rest rides to VWAP or the stops. |

## Results

| ID | Date run | Goal | Window | Universe | Config vs baseline | Code VER | backtestId | Rep | Net P&L $ | Trades | Avg bps/trade | Rev % | Exit mix | Win % | PF | Sharpe | Max DD $ (%) | Bootstrap all (Δ $/day, share, 95% CI) | 1st half (Δ, share) | 2nd half (Δ, share) | Mechanism value | Keep (net↑ Mom, share ≥ 0.8, mech, halves, Core) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

## Recommendation
_(One paragraph when the session is done. No promotion: the lead decides.)_

**VERSION bump needed:** _(yes/no, and why)_
