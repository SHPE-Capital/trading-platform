# Cost-Aware Edge Gate

**Type:** entry filter  ·  **File:** `rules.ts` (`costGate`, `roundTripCostBps`), used in `team3ReversalStrategy.ts` step 5
**Switch:** `useCostGate` (default off)  ·  **Knobs:** `captureShare` = 0.5, `costFixedBps` = 14, `costCommissionPerShare` = 0.005  ·  **Added in VERSION:** 5 · **Status:** tested (R3), **not in the baseline**

## Main idea
Enter only if the part of the stretch back to VWAP we expect to capture beats what the round trip costs.

## Objective
- Removes: entries whose expected capture can't pay the ~14 bps round trip.
- Success looks like: net up, bps/trade up, reversion share up vs baseline.

## How it works for us
- Hooks in at: right after `entryIdea` (step 5), before the filters. One line.
- Inputs it reads: `idea.edgeBps` (|close − VWAP| ÷ close), the bar's close.
- Missing data: no VWAP means no idea, so the gate is never reached.

## Math
$$ captureShare \times edgeBps \;>\; costFixedBps + \frac{2 \times costCommissionPerShare}{close} \times 10^4 $$
`costFixedBps` = 2 × (slippage 5 + half spread 2), the protocol's fill model. The commission term is both legs at the entry price. This matches the measured cost: net − gross per trade is 14.24 bps (A03 vs D3) and 14.22 (A04 vs D4). At 0.5 on a $500 stock the gate is `edgeBps > 28.4`; at 0.6 it is `> 23.7`. **So in practice it's a price-aware `minEdgeBps`.**

## Source
R3-costs.md (break-even ≈ 14–15 bps at full capture, ≈ 25 at 60%).

## Tests
`rules.test.ts`: round-trip cost formula, the strict threshold at 0.5, a higher share lowering the bar. Parity: V5 with the switch off reproduced A03/A04 exactly (ledger V1/V2).

## Ablation rows
A09/A10 (0.5), A11/A12 (0.6). All improve net with bootstrap share 1.000 and both halves agreeing, but the reversion share falls, so the keep rule fails on the mechanism check. See the R3 summary in [ablation.md](../ablation.md#r3-summary).
