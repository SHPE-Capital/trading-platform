# Partway target (R4, feature #6)

Switch `usePartwayTarget` (default **off**), knob `tpFraction` (default 0.5, must be in (0, 1]).

- **Rule.** With z₀ = the entry signal bar's VWAP z, exit **the whole position** once z has come back
  `tpFraction` of the way toward 0: short `z ≤ (1 − tpFraction)·z₀`, long `z ≥ (1 − tpFraction)·z₀`.
  Exit reason `partway`.
- **Order.** `stale`, `close`, `stop`, `target` (z crossed 0) are checked first, then `partway`, then `time`.
  So a bar that reaches VWAP is still labelled `target`.
- **Where.** `rules.ts` (`partwayReached`, `exitReason`); the strategy remembers each symbol's entry z
  (`team3ReversalStrategy.ts`, `entryZ` map) and passes it in `HoldingView.entryZ`.
- **Why.** Research note [R4 §4.2](../research/R4-exit-geometry.md): trades win rate for payoff; the last
  0.5σ is the slowest part of an OU reversion and is where the time stop usually ends the trade.
- **Reversion share** for rows using it counts `target + partway` exits.
- Tests: `backend/src/tests/strategy/team3Reversal/partwayTarget.test.ts`.

## Scale-out variant (R4-03)
Switch `useScaleOut` (default **off**; can't be combined with `usePartwayTarget`). Same trigger and `tpFraction`,
but the `partway` exit closes floor(qty/2) shares (all if that is 0) and is flagged `meta.partial`. It fires once per
holding; the rest exits on `target`, `stop`, `time`, `close` or `stale`. The R4 metric re-pairs both legs into one trip.
Tests: `scaleOut.test.ts`.
