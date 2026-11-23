# Turn Entry

**Type:** entry rule  ·  **File:** `backend/src/strategies/team3Reversal/rules.ts` (`turnEntryIdea`, called from `entryIdea`)
**Switch:** `useTurnEntry` (default off)  ·  **Knobs:** shares `entryZ`, `stopZ`, `minEdgeBps`  ·  **Added in VERSION:** pending (VERSION bump needed in the combining step)

## Main idea
Don't fade a bar that is still pushing away from VWAP; wait for the first bar that turns back toward it while price is still stretched.

## Objective
- Removes / improves: entries made while liquidity-driven pressure is still pushing (R1), which then run against us.
- Success looks like: adverse excursion over the first 5 bars after entry goes down; reversion share goes up vs baseline.

## How it works for us
- Hooks in at: the entry idea, before the cost gate and entry filters.
- Inputs it reads: this bar's close, the previous bar's close, VWAP and z.
- Side: from z (above VWAP sell, below buy), not from bar direction. The bar must move toward VWAP vs the previous close.
- Missing data: no VWAP or sigma, z = 0, or a flat bar: no entry.

## Math
Sell if $z \ge z_e$, $|z| < z_s$, $C_t < C_{t-1}$, and $|C_t - VWAP|/C_t \cdot 10^4 \ge$ minEdgeBps (mirror for buys).

## Source
R1 liquidity research (`docs/team3/research/R1-liquidity.md`): reversal profits as payment for liquidity; entering after the pressure eases.

## Tests
`backend/src/tests/strategy/team3Reversal/turnEntry.test.ts`: default off; sells a turning down bar above VWAP (default skips it); buys mirror; skips a bar still moving away; keeps stretch/stop/edge/flat/no-VWAP checks; r1 metric math.

## Ablation rows
R1-03 (see `docs/team3/results/ledger-r1.md`)
