> **Status: dropped in VERSION 3, folded into the baseline.** This component became the baseline's session window: skipOpenMinutes, lastEntryMinutesBeforeClose, flattenMinutesBeforeClose.
> See [baseline.md](baseline.md). The text below is kept for the paper's history.
> **Implemented by Alex Rivera** (PR #78, `aaf0815`): skip entries in the first and last `skipEdgeMinutes` (15) of the session. That is the same 15-minute edge the baseline enforces with `skipOpenMinutes` / `lastEntryMinutesBeforeClose`, so the filter file was not re-added when his branch was merged.

# Time of Day (skip the open and close)

**Type:** entry filter  ·  **File:** `filters/timeOfDay.ts`
**Switch:** `useTimeOfDay`  ·  **Knobs:** `skipEdgeMinutes` = 15  ·  **Status:** stub (lets every trade through), owner to fill in
**Owner:** _(name)_

## Main idea
The first and last minutes of the day are the noisiest and most expensive to trade.

## Objective
- Removes / improves: fades in the first and last `skipEdgeMinutes` minutes.
- Success looks like: _(metric, direction vs baseline)_

## How it works for us
- Hooks in at: entry filters, first in order.
- Inputs it reads: _(fields)_
- Missing data: _(what it does)_

## Math
_(Short reason, then formula. Define every symbol.)_

## Source
_(Paper / link. Took: ... Changed: ...)_

## Tests
`backend/src/tests/strategy/team3Reversal/timeOfDay.test.ts`: _(what each case proves)_

## Ablation rows
_(fill in after testing)_
