# Hold Until Back (exit rule)

**Type:** exit rule  ·  **File:** `filters/holdUntilBack.ts`
**Switch:** `useHoldUntilBack`  ·  **Knobs:** `holdMaxBars` = 15  ·  **Status:** stub (closes on the very next bar), owner to fill in
**Owner:** _(name)_

## Main idea
Enter once, then hold until price comes back to its recent average (or a time limit) instead of flipping every minute.

## Objective
- Removes / improves: cost bleed from flipping the position every bar. Stub currently closes on the next bar.
- Success looks like: _(metric, direction vs baseline)_

## How it works for us
- Hooks in at: exit, replaces the baseline's flip.
- Inputs it reads: _(fields)_
- Missing data: _(what it does)_

## Math
_(Short reason, then formula. Define every symbol.)_

## Source
_(Paper / link. Took: ... Changed: ...)_

## Tests
`backend/src/tests/strategy/team3Reversal/holdUntilBack.test.ts`: _(what each case proves)_

## Ablation rows
_(fill in after testing)_
