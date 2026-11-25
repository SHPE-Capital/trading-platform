> **Status: dropped in VERSION 3, folded into the baseline.** This component redundant with the baseline's entryZ stretch gate (it was always noted as overlapping VWAP Stretch).
> See [baseline.md](baseline.md). The text below is kept for the paper's history.

# Big Move (fade only big moves)

**Type:** entry filter (may be repurposed, see MASTER.md)  ·  **File:** `filters/bigMove.ts`
**Switch:** `useBigMove`  ·  **Knobs:** `bigMoveMinZ` = 2  ·  **Status:** stub (lets every trade through), owner to fill in
**Owner:** _(name)_

## Main idea
Small moves are mostly noise; a move much bigger than normal is more likely an overreaction.

## Objective
- Removes / improves: fades of small moves that mostly pay costs. Overlaps vwapStretch.
- Success looks like: _(metric, direction vs baseline)_

## How it works for us
- Hooks in at: entry filters, after vwapStretch.
- Inputs it reads: _(fields)_
- Missing data: _(what it does)_

## Math
_(Short reason, then formula. Define every symbol.)_

## Source
_(Paper / link. Took: ... Changed: ...)_

## Tests
`backend/src/tests/strategy/team3Reversal/bigMove.test.ts`: _(what each case proves)_

## Ablation rows
_(fill in after testing)_
