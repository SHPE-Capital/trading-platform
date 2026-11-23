# Crowd Split

**Type:** sizing  ·  **File:** `sizing.ts` (`crowdSize`, `crowdSplitQty`; used in `team3ReversalStrategy.ts`, step 6)
**Switch:** `useCrowdSplit` (default off)  ·  **Knobs:** none (uses `entryZ`, `vwapWindowBars`)  ·  **Added:** Stage 2 branch `team3/r5` (VERSION bump needed at combine)

## Main idea
When several symbols stretch from VWAP the same way in the same minute, it is mostly one market move. Treat them as one bet and split one trade's size across them.

## How it works
- After the base sizer (fixed or vol), count `crowd` = symbols in `symbols` whose VWAP z this minute is `<= -entryZ` (buy) or `>= entryZ` (sell), this symbol included.
- `want = max(1, floor(base / crowd))` when `base >= 1`; otherwise unchanged. Then the usual caps.
- Order-independent: history ingests every symbol's bar before any decision, so the count is the same for every symbol in the minute.
- Entry meta records `crowd` and `qtyBase` when on.

## Source
R5 research (`docs/team3/research/R5-portfolio.md` §1, §4 candidate 1): effective number of bets (Meucci 2009), downside correlation asymmetry (Ang & Chen 2002).

## Tests
`crowdSplit.test.ts`: same-side counting, floor with 1-share minimum, default off and validation, r5 metric arithmetic.

## Ablation rows
See `docs/team3/results/ledger-r5.md` (R5-02).
