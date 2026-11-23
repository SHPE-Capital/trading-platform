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
| R4-V1 | 2026-11-23 | R4 (V) | IS 09-01 → 10-15 | Momentum | none (partway switch off) | 6+R4 | `f17cd0c0-d608-4aeb-b090-164ae2689ad7` | no | -1,647.82 | 370 | -9.52 | 17.6 | time 283 (−14.5), target 65 (+52.2), stop 11 (−42.2), close 11 (+11.7) | 37.3 | 0.59 | -10.24 | 1,745.12 (1.74%) | — | — | — | win 45.1%, avg win +37.1, avg loss −35.6, p5 −92.7 | — | Parity: identical to A04. |
| R4-V2 | 2026-11-23 | R4 (V) | IS 09-01 → 10-15 | Core | none (partway switch off) | 6+R4 | `7318df2e-2b27-4fa4-9712-9257e2805e5e` | no | -3,048.74 | 419 | -15.32 | 15.5 | time 324 (−13.3), target 65 (+28.4), stop 22 (−40.4), close 8 (−3.7) | 27.2 | 0.26 | -21.46 | 3,085.70 (3.08%) | — | — | — | win 38.2%, avg win +19.8, avg loss −25.3, p5 −55.2 | — | Parity: identical to A03. |
| R4-01 | 2026-11-23 | R4 | IS 09-01 → 10-15 | Momentum | `{"stopZ":100}` | 6+R4 | `a63dc5c0-6de7-4c6f-b141-21a6a8a3f17f` | no | -1,561.09 | 364 | -9.17 | 18.4 | time 286 (−15.6), target 67 (+51.4), close 11 (+11.7), stop 0 | 38.2 | — | — | 1,678.83 (—) | +2.71/day, 0.973, [−0.04, 6.36] | +1.93, 0.973 | +3.49, 0.881 | 10 of 11 baseline-stopped trades matched: mean gross −42.9 → **−31.7** (9 time, 1 target). Win 46.4%, avg win +36.2, avg loss −35.8, p5 −92.9 (base −92.7). Worst day −368 (base −355). | **PASS** (✓ +$86.7, ✓ 0.973, ✓, ✓, ✓ Core +$133.8) | 3 entries with \|z\| ≥ 3.5 admitted (stopZ also caps entry, M1). CI lower bound just below 0. |
| R4-01 | 2026-11-23 | R4 | IS 09-01 → 10-15 | Core | `{"stopZ":100}` | 6+R4 | `1ec24eb7-5bcb-4e5a-bc4c-2493a5049275` | no | -2,914.99 | 405 | -15.16 | 16.3 | time 331 (−15.1), target 66 (+27.4), close 8 (−3.4), stop 0 | 28.4 | — | — | 2,951.95 (—) | +4.18/day, 0.951, [−0.48, 10.99] | +4.96, 0.740 | +3.40, 0.990 | 17 of 22 matched: mean −42.7 → **−49.2** (worse; 15 time, 2 target). Win 39.5%, p5 −68.3 (base −55.2): fatter tail. | Core: same sign (+$133.8) | Mechanism contradicts on Core: the formerly stopped trades lose more, but the 5 unmatched / changed paths net out positive. |
| R4-02 | 2026-11-23 | R4 | IS 09-01 → 10-15 | Momentum | `{"usePartwayTarget":true,"tpFraction":0.5}` | 6+R4 | `fe45ee9e-b317-43de-bb68-133fe59bbd56` | no | -2,054.18 | 400 | -10.97 | 56.0 (partway 55.8 + target 0.3) | partway 223 (+12.9), time 156 (−26.2), stop 11 (−49.5), close 9 (+1.7), target 1 | 38.5 | — | — | 2,126.68 (—) | −12.70/day, 0.041, [−27.22, 1.68] | −19.29, 0.044 | −6.11, 0.256 | win 45.1 → **51.5%** ✓, avg win +37.1 → **+24.8** ✓, net −$406 ✗. p5 −79.8. | **FAIL** (✗ −$406, ✗ 0.041, ✗ net doesn't hold, ✗ halves both < 0, Core same sign so ✓) | Gross per partway exit +12.9 bps < ~15 bps round trip; more trades (400 vs 370) from freed capacity. |
| R4-02 | 2026-11-23 | R4 | IS 09-01 → 10-15 | Core | `{"usePartwayTarget":true,"tpFraction":0.5}` | 6+R4 | `8a230d6b-b9e7-4c88-90a3-d923788b0588` | no | -3,228.56 | 451 | -15.07 | 57.4 | partway 258 (+3.3), time 164 (−21.0), stop 22 (−41.6), close 6 (−14.1), target 1 | 24.4 | — | — | 3,240.85 (—) | −5.62/day, 0.146, [−16.06, 4.82] | −12.35, 0.011 | +1.11, 0.546 | win 38.2 → 44.8%, avg win +19.8 → +11.7 | Core: same sign (−$180) | |

## Recommendation
_(One paragraph when the session is done. No promotion: the lead decides.)_

**VERSION bump needed:** _(yes/no, and why)_
