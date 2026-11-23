# Relative to SPY (stock-specific moves only)

**Type:** entry filter  ·  **File:** `filters/relativeToSpy.ts`
**Switch:** `useRelativeToSpy`  ·  **Knobs:** `benchmarkSymbol` = SPY (must be in symbols)  ·  **Status:** stub (lets every trade through), owner to fill in
**Owner:** _(name)_

## Main idea
When the whole market moves, the move comes back less. Fade only moves the stock made on its own.

## Spec (locked before the batch)
*Confirmed by the lead 2026-11-23. Don't change it after the batch starts.*
- **β (hedge ratio): β = 1** for the filter (the simplest version). A rolling OLS β, from past bars only, is a later variant and needs reserve budget.
- **Residual stretch:** `resid = ret(stock) − β · ret(SPY)` over `lookbackBars`, where `total = ret(stock)` over the same bars.
- **Filter (version 1, run first):** enter only if `|resid| / |total| ≥ cutoff`. There are two cutoffs (the 2 values per knob): **0.5** and **0.7**. This doesn't change what z means, so the other thresholds stay as they are.
- **New signal (version 2):** compute z on the residual instead of the raw move. Run it **only if the filter passes the keep rule**. It needs `entryZ` and the edge gate retuned, which uses R2 budget.
- **SPY and QQQ are excluded** from trading while this switch is on. SPY is the benchmark only. QQQ is excluded because it has no stock-specific component.
- **Window:** `lookbackBars` (30), as specced. Rivera's 1-minute rule (PR #78) is the code it starts from; it's documented under Origin but not run as a separate row.
- **Mechanism check:** the β of per-trade P&L to SPY falls (metric in `runtime/team3Metrics/rspy.ts`), and the reversion share rises above 15.5% Core / 17.6% Momentum.
- **Budget:** 2 configs (cutoffs 0.5 and 0.7). The new-signal version runs after the combining step, from the combining budget. See [MASTER, Parallel Stage 2](../MASTER.md#parallel-stage-2).

## Objective
- Removes / improves: fades of market-wide moves.
- Success looks like: _(metric, direction vs baseline)_

## How it works for us
- Hooks in at: entry filters, last in order.
- Inputs it reads: _(fields)_
- Missing data: _(what it does)_

## Math
_(Short reason, then formula. Define every symbol.)_

## Source
_(Paper / link. Took: ... Changed: ...)_

## Tests
`backend/src/tests/strategy/team3Reversal/relativeToSpy.test.ts`: _(what each case proves)_

## Ablation rows
_(fill in after testing)_
