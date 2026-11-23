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
| R2-D1 | 2026-11-23 | R2 | in | core | none (baseline rerun) | 6 | 2c787496-a245-4fb6-b139-06928d7fa717 | 1 | −3,048.74 | 419 | −15.32 | 15.5 | time 324 / target 65 / stop 22 / close 8 | 27.2 | 0.26 | −21.46 | 3,085.70 (3.08%) | n/a | n/a | n/a | trend thr 1.147%; time stops trend 93 / non-trend 231 (28.7% on trend days) | n/a (diagnostic) | Reproduces A03 net exactly. |
| R2-D2 | 2026-11-23 | R2 | in | momentum | none (baseline rerun) | 6 | 62d03193-e744-4092-aa15-09d5c2001fd3 | 1 | −1,647.82 | 370 | −9.52 | 17.6 | time 283 / target 65 / stop 11 / close 11 | 37.3 | 0.59 | −10.24 | 1,745.12 (1.74%) | n/a | n/a | n/a | trend thr 2.164%; time stops trend 65 / non-trend 218 (23.0%) | n/a (diagnostic) | Reproduces A04 net exactly. |
| R2-01 | 2026-11-23 | R2 | in | core −SPY,QQQ (**universe row**) | `TEAM3_EXCLUDE=SPY,QQQ` | 6 | 42fdfe7c-1a5a-4453-8504-02efb32f4a35 | 1 | −1,969.73 | 270 | −15.07 | 17.0 | time 201 / target 46 / stop 16 / close 7 | 33.0 | 0.33 | −17.24 | 2,001.38 (2.00%) | +33.72, 1.00, [25.92, 42.80] | +36.05, 1.00 | +31.39, 1.00 | gross (twin R2-D3) −0.77 bps vs −1.08 | see Momentum row | Gain is from fewer trades; bps/trade almost unchanged. |
| R2-01 | 2026-11-23 | R2 | in | momentum −SPY (**universe row**) | `TEAM3_EXCLUDE=SPY` | 6 | 89339dc1-7a0c-4c9d-9913-6a88ce2f8404 | 1 | −1,108.59 | 296 | −7.97 | 19.9 | time 221 / target 59 / stop 6 / close 10 | 44.3 | 0.68 | −6.99 | 1,338.31 (1.34%) | +16.85, 1.00, [12.97, 21.11] | +16.56, 1.00 | +17.14, 1.00 | gross (twin R2-D4) +6.26 bps vs +4.70 | ✓ net, ✓ share, ✓ mech (pre-reg criterion; marginal, see notes), ✓ halves, ✓ Core → **PASS** | Core–Momentum gross gap widened (5.8 → 7.0 bps), so "Core moves toward Momentum" holds only on the pre-registered absolute test (+0.3 bps, noise-sized). |
| R2-D3 | 2026-11-23 | R2 | in | core −SPY,QQQ | zero_cost twin of R2-01 | 6 | 4e930c4a-5f0d-4e40-8523-92b0286fdabf | 1 | −100.84 | 270 | −0.77 | 17.0 | time 201 / target 46 / stop 16 / close 7 | 49.6 | 0.95 | −1.02 | 486.64 | n/a | n/a | n/a | gross −0.77 | n/a | Compare D3 −1.08. |
| R2-D4 | 2026-11-23 | R2 | in | momentum −SPY | zero_cost twin of R2-01 | 6 | 2289ef0d-01bb-4105-be75-ce53b7e2b850 | 1 | +870.82 | 296 | +6.26 | 19.9 | time 221 / target 59 / stop 6 / close 10 | 56.4 | 1.35 | 5.61 | 549.58 | n/a | n/a | n/a | gross +6.26 | n/a | Compare D4 +4.70. |
| R2-02 | 2026-11-23 | R2 | in | core | `{"useVwapRegime":true}` | 6 | 1afe1572-9552-4de2-a334-bc0c4c514fa8 | 1 | −1,755.27 | 187 | −19.79 | 23.0 | time 123 / target 43 / stop 21 | 26.2 | 0.19 | −17.73 | 1,770.49 (1.77%) | +40.42, 1.00, [21.74, 58.67] | +25.71, 0.97 | +55.13, 1.00 | time stops trend 93→32, non-trend 231→91 (28.7%→26.0% on trend days) | see Momentum row | bps/trade worse; gain from fewer trades. |
| R2-02 | 2026-11-23 | R2 | in | momentum | `{"useVwapRegime":true}` | 6 | 204d264f-32d7-4dd3-8faa-f8aad8865f8d | 1 | −1,166.47 | 144 | −17.26 | 23.6 | time 103 / target 34 / stop 6 / close 1 | 33.3 | 0.39 | −10.86 | 1,189.67 (1.19%) | +15.04, 0.887, [−8.25, 40.74] | −22.49, 0.04 | +52.57, 1.00 | time stops trend 65→18, non-trend 218→85 (23.0%→17.5%) | ✓ net, ✓ share, ✓ mech, ✗ halves, ✓ Core → **FAIL** | bps/trade −9.52 → −17.26; time-stop gross −14.45 → −27.78. |

## Recommendation
R2-01 (drop SPY/QQQ, universe row) passes all five keep conditions, but the mechanism pass is weak: Core's gross edge moved only −1.08 → −0.77 bps and Momentum's rose too, so the Core–Momentum gap did not close. The net gain comes from removing trades with about the same bps/trade, not from a better edge per trade. Since `relativeToSpy` needs SPY in `symbols`, R2-01 can't be stacked with that filter; treat it as a candidate for the combining step after rspy. R2-02 (`useVwapRegime`) does cut trend-day time stops as predicted (Momentum 65 → 18), but it also makes the remaining trades worse (−17.3 bps/trade) and the halves disagree on Momentum (first half −22.5 $/day). It fails the keep rule; per R2 §5, consider dropping the filter instead of tuning it. No promotion: the lead decides.

**VERSION bump needed:** no. R2 adds no strategy code or config fields; `r2.ts` is metric-only.
