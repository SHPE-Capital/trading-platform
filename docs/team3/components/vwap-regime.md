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
VWAP-deviation regime classification (SSRN 6438039). **(citation unverified: no record of SSRN 6438039 found on 2026-11-22; confirm or replace before the paper)** Took: rules-only (no ML) classification into rotational vs trend. Changed: we use a crossing count as the rule, since the paper gives no implementation detail.

## Tests
`vwapRegime.test.ts`: blocks with no VWAP, blocks with few crossings, allows with enough. `vwap.test.ts`: VWAP math, daily reset, crossing count.

## Ablation rows
- **R2-02** (`useVwapRegime=true`, 4 / 60, VERSION 6 code vs V4 baseline, in-sample): Momentum net −1,647.82 → −1,166.47, trades 370 → 144, bps/trade −9.52 → −17.26, bootstrap share 0.887 (CI [−8.25, 40.74]), halves disagree (−22.49 / +52.57 $/day). Core −3,048.74 → −1,755.27, share 1.00. Time stops on trend days 65 → 18 (Mom), 93 → 32 (Core), as predicted. **Fails the keep rule** (halves). The filter removes trades instead of picking better ones. See [ledger-r2.md](../results/ledger-r2.md).
