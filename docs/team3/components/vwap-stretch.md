> **Status: dropped in VERSION 3, folded into the baseline.** This component became the baseline's entry rule (entryZ, now with a cost-aware minEdgeBps gate). Code removed in VERSION 3.
> See [baseline.md](baseline.md). The text below is kept for the paper's history.

# VWAP Stretch (fade only far from VWAP)

**Type:** entry filter  ·  **File:** `filters/vwapStretch.ts` (+ `vwap.ts`)
**Switch:** `useVwapStretch`  ·  **Knobs:** `minVwapZ` = 1.5  ·  **Added in VERSION:** 2

## Main idea
A bar that pushes price far from VWAP is usually a temporary order imbalance, and those snap back toward VWAP.

## Objective
- Removes: fades of small, noisy moves near fair value (they mostly pay costs).
- Success looks like: avg net P&L per trade (bps) goes up; trades drop.

## How it works for us
- Hooks in at: entry filters, after `vwapRegime`.
- Reads: `input.vwap.z`, `input.side`.
- Rule: sell only when price is ≥ `minVwapZ` sigmas **above** VWAP; buy only when ≥ `minVwapZ` sigmas **below**.
- Missing data: no VWAP, or zero spread (z is null) → block.
- Overlaps `bigMove`: test both and keep the better one.

## Math
Spread of typical price around VWAP, weighted by volume:
$$ \sigma = \sqrt{\frac{\sum p^2 \cdot volume}{\sum volume} - VWAP^2} $$
How stretched the close is, in sigmas:
$$ z = \frac{close - VWAP}{\sigma} $$
Allow a sell when $z \ge minVwapZ$. Allow a buy when $z \le -minVwapZ$.

## Source
VWAP deviations as temporary imbalances (SSRN 6438039). Took: deviation from VWAP = short-term inefficiency. Changed: we use the standard volume-weighted sigma bands to make the threshold comparable across stocks.

## Tests
`vwapStretch.test.ts`: blocks without z, allows a sell far above / a buy far below, blocks the wrong direction.

## Ablation rows
(fill in after testing)
