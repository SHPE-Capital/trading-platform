# Baseline: VWAP Reversion (VERSION 3)

**Type:** baseline (entry + exit + sizing)  ·  **Files:** `rules.ts`, `history.ts`, `risk.ts`, `sizing.ts`, used in `team3ReversalStrategy.ts`
**Switch:** none (always on)  ·  **Knobs:** `entryZ` 2 · `minEdgeBps` 15 · `stopZ` 3.5 · `maxHoldBars` 30 · `skipOpenMinutes` 15 · `lastEntryMinutesBeforeClose` 15 · `flattenMinutesBeforeClose` 5 · `tradeUsd` 5000 · `maxPositionSizeUsd` 10000 · `maxGrossUsd` 40000
**Replaces:** Beginner Reversal ("fade every bar"), which is still available as the platform's `beginner_reversal` strategy for a reference row.

## Main idea
Fade a 1-minute move only when it leaves price stretched far from today's VWAP, then hold until price comes back to VWAP. Be flat by the close.

## Objective
- Removes: cost bleed from trading every bar (the old baseline lost thousands to costs alone), trades whose expected gain is smaller than costs, and overnight gap risk.
- Success looks like: far fewer trades, avg net bps/trade > 0 after costs, and a smaller max drawdown than Beginner Reversal on the same window.

## How it works for us
- **Data:** today's regular-session bars only. The first bar of the day has no "previous bar", so nothing fades the overnight gap.
- **Window:** no entries in the first `skipOpenMinutes` (VWAP sigma warms up) or the last `lastEntryMinutesBeforeClose`. Flatten in the last `flattenMinutesBeforeClose`.
- **Entry:** sell an up bar / buy a down bar if `z` is ≥ `entryZ` on that same side **and** the distance to VWAP is ≥ `minEdgeBps`. One position per symbol: no adding, no flipping.
- **Exit:** the first reason that applies wins: `stale` (opened on an earlier day), `close` (flatten window), `stop` (|z| ≥ `stopZ` against us), `target` (back to VWAP), `time` (`maxHoldBars`).
- **Size:** `floor(tradeUsd / price)` shares, or vol sizing if switched on. Then capped by $ per symbol and $ gross, shorts counted in full.
- **Missing data:** no VWAP or zero sigma → no entry. A held position can still exit on `stale`, `close` or `time`.

## VERSION 4 changes
- **No entry at or past the stop:** an entry needs `entryZ <= |z| < stopZ`. In VERSION 3, 19 Core and 11 Momentum IS entries started at |z| ≥ 3.5 and were stopped the next bar.
- Exit meta `pnlBps` is now `pnlBpsGross`: the exit bar's close vs the real entry fill, before the exit's own costs.
- Why steady trends rarely trigger entries: on a straight-line trend with equal volume, z settles at √3 ≈ 1.73 < `entryZ`. Entries happen on *accelerations*, and on a steady trend the time stop, not `stopZ`, ends a losing trade.

## Math
Typical price and session VWAP (since 9:30 today):
$$ p_t = \tfrac{h_t + l_t + c_t}{3}, \qquad VWAP = \frac{\sum p_t v_t}{\sum v_t} $$
Spread around VWAP, volume-weighted:
$$ \sigma = \sqrt{\frac{\sum p_t^2 v_t}{\sum v_t} - VWAP^2} $$
How stretched the close is:
$$ z = \frac{c_t - VWAP}{\sigma} $$
Expected gross gain if price returns to VWAP, in bps. It must beat round-trip costs (about 2 × (5 + 2) bps plus commission):
$$ edge = \frac{|c_t - VWAP|}{c_t} \times 10^4 \ge minEdgeBps $$
Enter a short if $c_t > c_{t-1}$ and $z \ge entryZ$; enter a long if $c_t < c_{t-1}$ and $z \le -entryZ$.

## Source
VWAP deviations as temporary order imbalances (SSRN 6438039). **(citation unverified: no record of SSRN 6438039 found on 2026-11-22; confirm or replace before the paper)** Took: fade stretches from session VWAP, with VWAP as the target. Changed: added a cost-aware edge gate, a z stop and a time stop, and flat by the close.

## Tests
- `rules.test.ts`: the session-window table, entry gates (side, z, edge, missing data) and the exit-reason order.
- `history.test.ts`: session-only bars, daily reset, idempotent ingest.
- `risk.test.ts`: per-symbol and gross caps, shorts counted.
- `team3ReversalStrategy.test.ts` (real engine): enters both sides, respects warm-up, edge and entryZ, one position per symbol, each exit reason, sizing.
- `contract.test.ts`: the platform contract (see `CONTRACT.md`).

## Ablation rows
(fill in after testing; A00 = `beginner_reversal` reference, A01 = this baseline)
