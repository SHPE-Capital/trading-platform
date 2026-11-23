# Stream F: Later ideas (learned components)

Back to [MOMENTUM_TASKS.md](MOMENTUM_TASKS.md). Repo: **research-python** (and
**trading-platform** for ONNX use). Written 2026-11-13.

**Nothing here is in the Nov 30 deliverable and nothing here may touch the frozen
protocol.** The Nov 30 plan is rules plus statistics, with one small ML piece (the
D4 surrogate that chooses which configs to replay). These are follow-on
experiments. Each one is a new pre-registered study against the frozen baseline,
with its own trial count, and reuses tooling that already exists in
research-python.

## What research-python already gives us

Read from `research-python` (main, 2026-11-13):

| Existing piece | Where | Use here |
|---|---|---|
| Random forest, MLP (done), LightGBM (M1b, open) | `models/` (`--extra ml` for LightGBM) | candidate models |
| Config sweeps, seed ensembles, MLflow (M2, done) | `experiments/sweep.py` | run F studies |
| ONNX export with golden rows (M3, done) | `models/export_onnx.py` | ship a model to the platform |
| Purged walk-forward fit schemes | `validation/` | leakage-safe training |
| Triple-barrier labels on T1 (C1c, open) | `labels/` | labels for entry model |
| Meta-labeling the ORB (W4) and cross-sectional ranker (W3) workshop notebooks | `workshop/` | worked examples to copy |
| R1 ORB selectors A–D and **RM6 meta-labeling** | `docs/teams/momentum.md` | same method, different rule |
| Kelly and vol-scaled sizing (T2 done, P6 wires them in the platform) | `trade/sizing.py` | sizing experiment |
| Platform ONNX selector wrapper P2 and `metaModelPath` | platform tasks | live use |

Because of this, the learned ideas are mostly **wiring and pre-registration**, not
new infrastructure.

## Seams to leave in the Nov 30 work (cheap, do now)

These make stream F additive instead of a rewrite. They cost almost nothing and
change no results.

1. **Ranker hook (C4).** Ranking of simultaneous signals is a function
   `rank(candidates, state) -> order`, selected by `account.ranking`. The default
   is 20-session median dollar volume with the asset ID tie-break.
2. **Entry-filter hook (C4).** An optional `entry_score(candidate) -> float` and a
   `min_score` threshold (default off). When off, behavior is identical.
3. **Sizing hook (C3).** `size(candidate, equity, ...)` selected by config. The
   default is the guide's min-of-caps rule. A score-based size multiplier is an
   optional input (default 1.0).
4. **Candidate features in the ledger (B5, C4).** B5 already keeps indicator
   values. Record them per signal and per rejected signal, with the realized
   outcome, so a model can train on the same events the account saw.
5. **Training table export (D7).** Write per-cutoff candidate tables with only
   information known at the decision time. This is the leakage-critical piece;
   E4's tamper test covers it.

## F1 Learned signal ranking

- **Idea:** when more signals fire than the 10-position cap allows, rank by a
  model's predicted net return (or probability of a profitable trade) instead of
  dollar volume.
- **Why it is the best first experiment:** it only changes which signals win a
  scarce slot, so it is local, cheap to test, and the paired comparison is clean.
  It matters more at N of 500 to 1,000, where many more signals compete.
- **Design:** target is the realized net trade return from the account ledger, not
  a price forecast. Features known at signal time: the five indicator values,
  dollar volume, spread proxy, time of day, SPY descriptors, signal age. Train
  with purged walk-forward (`validation/`), refit weekly on data before the
  cutoff. Start with LightGBM or a ridge on rank-transformed features; compare
  with dollar-volume and random ranking.
- **Test:** same weekly configs and universe, only the ranker changes. Primary
  result is the paired block bootstrap of daily net returns (E2), plus trades per
  day and capital use. It must beat dollar volume after 20 bps costs.
- **Platform:** score is computed inside P1's strategy via an ONNX model (M3
  golden rows, P2 wrapper), or approximated by a few rules if the model is small.
- **Risks:** ranker overfits the few reserved weeks; a score that only learns
  dollar volume again; extra latency live.

## F2 Learned entry model (meta-label filter)

- **Idea:** after the five-component signal fires, a model estimates whether this
  specific entry is worth taking, and the account skips entries below a threshold
  (`min_score` hook).
- **Reuse:** this is RM6/W4 meta-labeling applied to the new rule. Copy the R1
  selector setup (RF, MLP, LightGBM; 3 seeds; `triple_barrier` labels from the
  account's exit package; net of costs).
- **Design:** train on the candidate table (seam 5). Use calibrated probability,
  not raw score. Choose the threshold on validation weeks only, as part of the
  weekly calibration (it becomes one more searched parameter, so it adds to the
  trial count).
- **Test:** against the unfiltered baseline, same configs; report trades skipped,
  net return, hit rate, drawdown, and the paired bootstrap difference.
- **Risks:** high. Fewer trades means thinner validation floors; the filter can
  silently remove the winning tail; training labels depend on the exit package,
  so a changed exit means retraining.

## F3 Learned sizing

- **Idea:** scale position size by model confidence, for example
  `size = 2Φ(z) − 1` from the entry model (López de Prado ch. 10, already noted in
  the team guide), capped by the existing 8%, 0.25% risk and 80% caps.
- **Order:** only after F2 shows the score is calibrated and adds value.
  Otherwise use simpler, already-built options: vol-scaled or fractional Kelly
  from T2 (`kelly_fractional`), and `maxPositions` and `riskPct` sweeps.
- **Test:** same signals and same entry rule; vary only size. Compare net return,
  max drawdown, and capital use. Sizing must not increase the chance of breaching
  the 1% daily halt.
- **Platform:** needs P6 (sizers wired) before it can run live.

## F4 Other follow-ups worth keeping on the list

| ID | Idea | Why | Depends on |
|---|---|---|---|
| F4a | **Exhaustive grid precompute** (all 69,732 configs, per-week chunks) | ground truth for search diagnostics; makes later cutoffs cheap | D6 chunked cache, C5 |
| F4b | **Better surrogate** (add descriptors, more trees, or Bayesian optimization) | only if E3 shows the surrogate rank correlation is low | E3 |
| F4c | **Learned fill model** from quote replay | if C6 shows a large gap between bar-proxy and quote fills | C6 |
| F4d | **Second ranker input: signal strength** | cheap non-ML alternative to F1 | C4 hook |
| F4e | **Longer or second validation window** | reduces selection noise | D7 |
| F4f | **Short side** | the guide is long-only; shorting needs borrow, locates and its own risk limits | new protocol |

## Order and gates

1. Leave seams 1–5 in place (inside existing tasks).
2. Run **F4a** if compute allows after the first weekend run, to calibrate trust in
   the search.
3. **F1** next, then **F2**, then **F3**. Each stage starts only if the previous
   one improved the paired net-return difference after 20 bps costs.
4. Each study gets its own pre-registration, trial count and protocol hash before
   it touches the reserved period. A reserved period already used is gone for
   that question, so F-studies need a new untouched period (for example, the
   weeks after Nov 30 as live paper forward data).
