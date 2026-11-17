# Relative to SPY (stock-specific moves only)

**Type:** entry filter  ·  **File:** `filters/relativeToSpy.ts`
**Switch:** `useRelativeToSpy`  ·  **Knobs:** `benchmarkSymbol` = SPY (must be in symbols)  ·  **Status:** stub (lets every trade through), owner to fill in
**Owner:** _(name)_

## Main idea
When the whole market moves, the move comes back less. Fade only moves the stock made on its own.

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
