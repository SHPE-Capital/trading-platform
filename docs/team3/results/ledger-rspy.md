# Stage 2 ledger: relativeToSpy filter (branch `team3/rspy`)

Only the `team3/rspy` session writes this file. It's merged into [ablation.md](../ablation.md) in the combining step.
Rules: [MASTER, Testing rules](../MASTER.md#testing-rules) and [Parallel Stage 2](../MASTER.md#parallel-stage-2). Prompt: [prompts/rspy.md](prompts/rspy.md).

- IDs: `RS-01`, `RS-02`, … for configs; `RS-V1…` for parity rows; `RS-D1…` for diagnostics (V and D rows don't count toward the budget).
- Baseline (frozen V4): A03 Core `1872fd42-331a-4a8c-a488-460231ac8552`, A04 Momentum `4b060cbe-2834-4996-8b6b-c223bef772ed`. Reversion share 15.5% Core / 17.6% Momentum.
- Bootstrap: `npx ts-node src/runtime/team3Bootstrap.ts <rowId>` (it picks the row's own universe's baseline).
- **Pre-registration:** write each row's config, the predicted direction of its mechanism check, and any definition it needs (e.g. "trend day") **here, before running it.**

## Pre-registered rows

| ID | Config vs baseline | Mechanism check and predicted direction | Definitions |
|---|---|---|---|
| RS-V1, RS-V2 | parity: all switches off (`{}`), Momentum and Core | must equal A04 / A03 exactly (net, trades) | none |
| RS-V3 | exclusion-only reference: `TEAM3_EXCLUDE=SPY` (Momentum), `TEAM3_EXCLUDE=SPY,QQQ` (Core), config `{}` (= R2 Q2.5) | reference for the RS rows | none |
| RS-01 | `{"useRelativeToSpy":true,"rtsMinOwnShare":0.5}` | reversion share up (> 17.6% Mom / 15.5% Core); |beta| of per-trade gross bps on SPY holding-window bps down vs baseline | own share = abs(ret(stock) - ret(SPY)) / abs(ret(stock)) over the bar's history window (up to lookbackBars=30 earlier session bars) to this bar, beta 1; SPY missing at either end blocks; SPY, QQQ not traded. Metric `mechanism.rspy`: `beta` = OLS slope of pnlBpsGross on SPY bps entryTs->exitTs (signal closes); `betaSideAdj` uses SPY bps signed by trade side (reported, not the pre-registered check) |
| RS-02 | `{"useRelativeToSpy":true,"rtsMinOwnShare":0.7}` | same as RS-01, stronger | same |

## Results

| ID | Date run | Goal | Window | Universe | Config vs baseline | Code VER | backtestId | Rep | Net P&L $ | Trades | Avg bps/trade | Rev % | Exit mix | Win % | PF | Sharpe | Max DD $ (%) | Bootstrap all (Δ $/day, share, 95% CI) | 1st half (Δ, share) | 2nd half (Δ, share) | Mechanism value | Keep (net↑ Mom, share ≥ 0.8, mech, halves, Core) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| RS-V1 | 2026-11-23 | rspy (V) | IS 09-01 → 10-15 | Momentum | `{}` (all switches off) | 6+rspy | `9e29dcd8-b2fe-41d8-a579-7dca22a9b18c` | no | -1,647.82 | 370 | -9.52 | 17.6 | time 283 / target 65 / close 11 / stop 11 | 37.3 | 0.59 | -10.24 | 1,745.12 (1.74%) | — | — | — | baseline β (trade P&L on SPY) **0.453** | n/a | Parity: = A04 exactly. |
| RS-V2 | 2026-11-23 | rspy (V) | IS 09-01 → 10-15 | Core | `{}` (all switches off) | 6+rspy | `3b02ee56-0f91-462d-9c7c-1cbf8c07dc5a` | no | -3,048.74 | 419 | -15.32 | 15.5 | time 324 / target 65 / stop 22 / close 8 | 27.2 | 0.26 | -21.46 | 3,085.70 (3.08%) | — | — | — | baseline β **0.259** | n/a | Parity: = A03 exactly. |
| RS-V3 | 2026-11-23 | rspy (V, reference) | IS 09-01 → 10-15 | Momentum −SPY | `{}`, `TEAM3_EXCLUDE=SPY` (same config as R2-01) | 6+rspy | `3abd61cf-2e9b-46f7-818d-0158a7f9e041` | no | -1,108.59 | 296 | -7.97 | 19.9 | time 221 / target 59 / stop 6 / close 10 | — | — | — | — | vs A04: +16.85, 1.00, [12.97, 21.11] | +16.56 | +17.14 | — | n/a (reference) | Exclusion only. Same numbers as R2-01 (`89339dc1-…`). |
| RS-V3 | 2026-11-23 | rspy (V, reference) | IS 09-01 → 10-15 | Core −SPY,QQQ | `{}`, `TEAM3_EXCLUDE=SPY,QQQ` (same config as R2-01) | 6+rspy | `50385beb-0657-4c36-bab2-1b618147eb10` | no | -1,969.73 | 270 | -15.07 | 17.0 | time 201 / target 46 / stop 16 / close 7 | — | — | — | — | vs A03: +33.72, 1.00, [25.92, 42.80] | +36.05 | +31.39 | — | n/a (reference) | Exclusion only. Same numbers as R2-01 (`42fdfe7c-…`). |
| RS-01 | 2026-11-23 | R2-rts | IS 09-01 → 10-15 | Momentum | `{"useRelativeToSpy":true,"rtsMinOwnShare":0.5}` | 6+rspy | `1c945ce4-7b31-4d59-a2ef-a965da7bd3e9` | yes | -1,037.56 | 286 | -7.73 | 19.9 | time 214 / target 57 / stop 6 / close 9 | — | — | — | — | vs A04: +19.07, 1.00, [13.27, 24.97] | +13.97, 1.00 | +24.17, 1.00 | rev 19.9% (↑ vs 17.6) ✓; β 0.453 → **0.295** ✓ | ✓ ✓ ✓ ✓ ✓ → **PASS** | vs RS-V3 reference: +2.22, 0.849, [−1.78, 6.60]; halves −2.59 (0.09) / +7.03 (0.99) **disagree**. Most of the gain vs A04 is the SPY exclusion. |
| RS-01 | 2026-11-23 | R2-rts | IS 09-01 → 10-15 | Core | same | 6+rspy | `f6589210-732f-4999-aa4f-c87dcca374a4` | yes | -1,800.74 | 247 | -15.07 | 16.6 | time 187 / target 41 / stop 11 / close 8 | — | — | — | — | vs A03: +39.00, 1.00, [28.40, 52.04] | +40.22 | +37.78 | rev 16.6% (↑ vs 15.5); β 0.259 → **0.100** | Core agrees | vs RS-V3: +5.28, 0.995, [1.15, 10.22]; halves agree. |
| RS-02 | 2026-11-23 | R2-rts | IS 09-01 → 10-15 | Momentum | `{"useRelativeToSpy":true,"rtsMinOwnShare":0.7}` | 6+rspy | `87633870-7774-47c2-89b8-1c6d72dd8652` | yes | -912.10 | 258 | -7.55 | 19.8 | time 192 / target 51 / stop 5 / close 10 | — | — | — | — | vs A04: +22.99, 0.9999, [11.19, 35.92] | +15.25, 0.97 | +30.74, 1.00 | rev 19.8% ✓; β 0.453 → **0.105** ✓ | ✓ ✓ ✓ ✓ ✓ → **PASS** | vs RS-V3: +6.14, 0.866, [−4.30, 17.97]; halves −1.32 (0.42) / +13.60 (0.95) **disagree**. |
| RS-02 | 2026-11-23 | R2-rts | IS 09-01 → 10-15 | Core | same | 6+rspy | `1cd15a22-8185-4f93-8ec5-77123c40d660` | yes | -1,426.88 | 217 | -13.58 | 19.4 | time 159 / target 42 / stop 10 / close 6 | — | — | — | — | vs A03: +50.68, 1.00, [37.36, 66.22] | +46.81 | +54.56 | rev 19.4% ↑; β 0.259 → **0.006** | Core agrees | vs RS-V3: +16.96, 1.00, [8.84, 26.68]; halves agree. |

## Recommendation
Both filter rows pass all five keep conditions against the frozen baseline (RS-01 +$610 Momentum, RS-02 +$736; reversion share up and β of trade P&L to SPY down on both universes; Core agrees). But the filter switches SPY (and on Core QQQ) off as a side effect, and on Momentum most of the gain is that exclusion alone: against the exclusion-only reference RS-V3 (= R2-01) the filter's own effect is not robust on Momentum (bootstrap share 0.85 / 0.87, the two halves disagree). On Core it is clear (share 0.995 / 1.00, halves agree). RS-02 (cutoff 0.7) is the stronger row and the combining candidate. It already contains R2-01's exclusion, so R2-01 and RS-02 must not be stacked as two separate steps. Note for the tests: Rivera's boundary case (own share exactly 0.5) now expects `true`, because the spec's rule is `>=`. No promotion: the lead decides.

**VERSION bump needed:** yes (new knobs `rtsMinOwnShare`, `rtsExcludeSymbols`, changed `relativeToSpy` rule; registry now done).
