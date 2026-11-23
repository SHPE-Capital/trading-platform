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
| R1-01 | 2026-11-23 | R1 | in | Momentum | `{"entryZ":2.5}` | 6 | 2ffd7d2f-94ed-4a3d-93de-0e3cba195811 | 1 | -421.22 | 136 | -6.65 | 14.7 | time 103 / target 20 / stop 11 / close 2 | 35.3 | 0.69 | -4.28 | 612 (0.61%) | +38.33, 1.000, [18.49, 58.95] | +22.02, 0.962 | +54.64, 1.000 | rev 0.147 (↓ vs 0.176), adv5 mean 18.39 / med 9.91 (≈flat vs 18.59/10.74) | ✓ ✓ ✗ ✓ ✓ → FAIL | gain is fewer trades (cost), not more reversion |
| R1-01 | 2026-11-23 | R1 | in | Core | `{"entryZ":2.5}` | 6 | fd8216a4-7195-4981-bc6f-03b6dae0dc47 | 1 | -1560.94 | 193 | -17.02 | 15.0 | time 139 / target 29 / stop 22 / close 3 | 26.9 | 0.22 | -17.59 | 1618 (1.62%) | +46.49, 1.000, [30.76, 61.89] | +33.33, 1.000 | +59.66, 1.000 | rev 0.150 (↓ vs 0.155), adv5 mean 12.34 (↑ vs 11.56) | Core agrees | |
| R1-02 | 2026-11-23 | R1 | in | Momentum | `{"entryZ":1.5}` | 6 | bd4a5174-5c0a-4b97-9dcb-47297f61892c | 1 | -4863.24 | 820 | -12.66 | 17.0 | time 636 / target 139 / close 32 / stop 13 | 35.6 | 0.47 | -19.61 | 4895 (4.89%) | -100.48, 0.000, [-140.47, -61.12] | -110.61, 0.000 | -90.35, 0.000 | rev 0.169 (↓), adv5 mean 17.19 (↓) | ✗ ✗ ✗ ✗ ✓ → FAIL | plateau check: entryZ 2 is not a local optimum from below; lower is clearly worse |
| R1-02 | 2026-11-23 | R1 | in | Core | `{"entryZ":1.5}` | 6 | 5440b283-53d4-4ac9-b20b-2f89c723800e | 1 | -5834.05 | 880 | -13.96 | 17.0 | time 685 / target 150 / close 23 / stop 22 | 30.0 | 0.24 | -29.45 | 5844 (5.84%) | -87.04, 0.000, [-109.48, -65.96] | -75.91, 0.000 | -98.17, 0.000 | rev 0.171 (↑), adv5 mean 10.45 (↓) | Core agrees (negative) | |
| R1-03 | 2026-11-23 | R1 | in | Momentum | `{"useTurnEntry":true}` | 6 | dcc2c7f1-f247-4f29-9f09-40d21b8d50b1 | 1 | -943.92 | 222 | -9.11 | 10.4 | time 185 / target 23 / stop 7 / close 7 | 31.1 | 0.60 | -7.59 | 1057 (1.06%) | +22.00, 0.9945, [5.29, 40.04] | +7.47, 0.736 | +36.53, 1.000 | rev 0.104 (↓ vs 0.176), adv5 mean 15.00 / med 8.94 (↓ vs 18.59/10.74) | ✓ ✓ ✗ (split: adv ↓ as predicted, rev ↓ against) ✓ ✓ → FAIL | gain is fewer trades; bps/trade ≈ baseline |
| R1-03 | 2026-11-23 | R1 | in | Core | `{"useTurnEntry":true}` | 6 | fd66a000-5649-44d8-b3c9-143a7ee519ab | 1 | -1996.94 | 276 | -15.21 | 8.3 | time 230 / target 23 / stop 16 / close 7 | 25.0 | 0.22 | -16.86 | 2048 (2.05%) | +32.87, 1.000, [19.82, 46.98] | +23.23, 0.998 | +42.51, 1.000 | rev 0.083 (↓), adv5 mean 9.81 (↓ vs 11.56) | Core agrees | |

## Recommendation
No R1 row passes the keep rule. R1-01 (entryZ 2.5) and R1-03 (turn entry) both improve net on Momentum and Core with bootstrap share ≥ 0.99 and both halves positive, but in both cases the reversion share **falls** (14.7% and 10.4% vs 17.6% Momentum), so the gain comes from trading less (fewer cost-losing time stops), not from the liquidity mechanism. R1-03 does cut early adverse excursion (18.6 → 15.0 bps Mom, 11.6 → 9.8 Core) as predicted, but entering later loses part of the stretch, so fewer trades hit VWAP. R1-02 (entryZ 1.5) is clearly worse on both universes, so the entryZ plateau falls off sharply below 2. Suggestion for the lead: treat R1-01 as a trade-count/cost result to revisit in the combining step next to the cost gate (it may overlap), not as an R1 mechanism win. No promotion: the lead decides.

**VERSION bump needed:** yes, if `useTurnEntry` is merged: it adds a new (default-off) switch to the trading logic in `rules.ts`. With the switch off the behaviour is unchanged (R1-V1/V2 = A04/A03 exactly).
