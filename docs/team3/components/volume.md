# Volume (skip high-volume moves)

**Type:** entry filter  ·  **File:** `filters/volume.ts`
**Switch:** `useVolume`  ·  **Knobs:** `volumeMaxRatio` = 3  ·  **Status:** stub (lets every trade through), owner to fill in
**Owner:** _(name)_

## Main idea
A move on very high volume is more often news, and news moves tend to keep going.

## Objective
- Removes / improves: fades of news-driven moves.
- Success looks like: _(metric, direction vs baseline)_

## How it works for us
- Hooks in at: entry filters, after bigMove.
- Inputs it reads: _(fields)_
- Missing data: _(what it does)_

## Math
_(Short reason, then formula. Define every symbol.)_

## Source
_(Paper / link. Took: ... Changed: ...)_

## Tests
`backend/src/tests/strategy/team3Reversal/volume.test.ts`: _(what each case proves)_

## Ablation rows
_(fill in after testing)_
