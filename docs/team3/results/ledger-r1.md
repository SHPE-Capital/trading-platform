# Stage 2 ledger: R1 liquidity (branch `team3/r1`)

Only the `team3/r1` session writes this file. It's merged into [ablation.md](../ablation.md) in the combining step.
Rules: [MASTER, Testing rules](../MASTER.md#testing-rules) and [Parallel Stage 2](../MASTER.md#parallel-stage-2). Prompt: [prompts/r1.md](prompts/r1.md).

- IDs: `R1-01`, `R1-02`, … for configs; `R1-V1…` for parity rows; `R1-D1…` for diagnostics (V and D rows don't count toward the budget).
- Baseline (frozen V4): A03 Core `1872fd42-331a-4a8c-a488-460231ac8552`, A04 Momentum `4b060cbe-2834-4996-8b6b-c223bef772ed`. Reversion share 15.5% Core / 17.6% Momentum.
- Bootstrap: `npx ts-node src/runtime/team3Bootstrap.ts <rowId>` (it picks the row's own universe's baseline).
- **Pre-registration:** write each row's config, the predicted direction of its mechanism check, and any definition it needs (e.g. "trend day") **here, before running it.**

## Pre-registered rows

| ID | Config vs baseline | Mechanism check and predicted direction | Definitions |
|---|---|---|---|
| R1-01 (Q2.3) | `{"entryZ":2.5}` | reversion share ↑ (vs 17.6% Mom / 15.5% Core); adverse5 mean ↓ (vs 18.59 Mom / 11.56 Core bps) | adverse5 = max(0, worst high for shorts / low for longs over the 5 bars after the entry signal bar vs entryClose), bps; mean and median over round trips (`team3Metrics/r1.ts`). Baseline values from R1-V1/V2. |
| R1-02 (Q2.4) | `{"entryZ":1.5}` | neighbour/plateau check of entryZ 2. Predicted: reversion share ↑ (VWAP is closer) and adverse5 mean ↓ (smaller stretches), but net ↓ (smaller edge vs ~14 bps costs). Keep-rule cond. 3 uses reversion ↑ and adverse5 ↓. | same |
| R1-03 (feature #4) | `{"useTurnEntry":true}` | reversion share ↑; adverse5 mean ↓ (entering after the pressure turns) | turn = bar close moves toward VWAP vs previous close, still `entryZ ≤ |z| < stopZ`, edge ≥ minEdgeBps; side from z. See `components/turn-entry.md`. |

## Results

| ID | Date run | Goal | Window | Universe | Config vs baseline | Code VER | backtestId | Rep | Net P&L $ | Trades | Avg bps/trade | Rev % | Exit mix | Win % | PF | Sharpe | Max DD $ (%) | Bootstrap all (Δ $/day, share, 95% CI) | 1st half (Δ, share) | 2nd half (Δ, share) | Mechanism value | Keep (net↑ Mom, share ≥ 0.8, mech, halves, Core) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R1-V1 | 2026-11-23 | parity | in | Momentum | `{}` (useTurnEntry off) | 6 | 1a30a0b4-089d-4c19-983b-7ace802cd79f | 1 | -1647.82 | 370 | -9.52 | 17.6 | time 283 / target 65 / close 11 / stop 11 | 37.3 | 0.59 | -10.24 | 1745 (1.74%) | Δ 0, CI [0,0], onlyA/onlyB empty | 0 | 0 | rev 0.1757, adv5 mean 18.59 / med 10.74 | n/a | = A04 exactly |
| R1-V2 | 2026-11-23 | parity | in | Core | `{}` (useTurnEntry off) | 6 | 0901be43-a9eb-4698-bdb9-f003fe2907ed | 1 | -3048.74 | 419 | -15.32 | 15.5 | time 324 / target 65 / stop 22 / close 8 | 27.2 | 0.26 | -21.46 | 3086 (3.08%) | (not bootstrapped; net/trades/exits identical to A03) | | | rev 0.1551, adv5 mean 11.56 / med 7.99 | n/a | = A03 exactly |

## Recommendation
_(One paragraph when the session is done. No promotion: the lead decides.)_

**VERSION bump needed:** _(yes/no, and why)_
