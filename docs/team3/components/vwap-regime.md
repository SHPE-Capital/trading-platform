# VWAP Regime (choppy days only)

**Type:** entry filter  ·  **File:** `filters/vwapRegime.ts` (+ `vwap.ts`)
**Switch:** `useVwapRegime`  ·  **Knobs:** `minVwapCrossings` = 4, `vwapWindowBars` = 60  ·  **Added in VERSION:** 2

## Main idea
Fading works when price keeps swinging across VWAP. On trend days it stays on one side, and every fade loses.

## Objective
- Removes: fades on trend days (our worst losses).
- Success looks like: max drawdown and worst-day loss go down; win rate goes up; trade count drops.

## How it works for us
- Hooks in at: entry filters, right after `timeOfDay`.
- Reads: `input.vwap.crossings` (built by `SessionVwapTracker` from regular-session bars, reset each day).
- Missing data: no VWAP yet → block. Few bars early in the day → few crossings → acts as a warm-up.

## Math
Typical price of each bar:
$$ p = \frac{high + low + close}{3} $$
Session VWAP is the volume-weighted average of typical price since 9:30:
$$ VWAP = \frac{\sum p \cdot volume}{\sum volume} $$
Each bar's side is +1 if the close is above VWAP and −1 if below. A **crossing** is a change of side.
The trade is allowed when:
$$ \text{crossings in last } vwapWindowBars \text{ bars} \ \ge\ minVwapCrossings $$

## Source
VWAP-deviation regime classification (SSRN 6438039). Took: rules-only (no ML) classification into rotational vs trend. Changed: we use a crossing count as the rule, since the paper gives no implementation detail.

## Tests
`vwapRegime.test.ts`: blocks with no VWAP, blocks with few crossings, allows with enough. `vwap.test.ts`: VWAP math, daily reset, crossing count.

## Ablation rows
(fill in after testing)
