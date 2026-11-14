# Stream D: Calibration (weights, score, search, weekly loop)

Back to [MOMENTUM_TASKS.md](MOMENTUM_TASKS.md). Repo: **research-python**,
package `src/shpe_research/calibration/` (created by 0-C).

D1, D2 and D4 work on synthetic return series and do not need the simulator.
D3, D5 and D6 can use a fake `simulate_account` that returns random daily
returns for a config. D7 and D8 integrate everything.

---

## D1 Common score J

- **Owns:** `calibration/score.py`, tests
- **Depends on:** nothing
- **Spec:** §8 "The common score"
- **Work:** `J = Σ(w × r) − 0.5 × sqrt(Σ(w × min(r, 0)²))` over daily net
  returns r (zero-trade days included) with normalized weights w. Keep the
  coefficient in config.
- **Done when:** hand-worked tests pass, and uniform weights reproduce the
  plain mean and downside terms.

## D2 Weighting policies

- **Owns:** `calibration/weights.py`, `calibration/descriptor_scaling.py`, tests
- **Depends on:** A7 for real descriptors (synthetic to start)
- **Spec:** §8 "Three ways to assign weights", "Preventing a handful of days
  from dominating"
- **Work:**
  - **Uniform:** 1/n.
  - **Recency:** raw weight = 2^(−age / half-life).
  - **Similarity:** raw weight = exp(−d² / (2 × bandwidth²)), where d is the
    Euclidean distance in robust-scaled descriptor space. Medians and IQRs are
    fitted on **search history only** and applied unchanged to validation.
    Handle a zero scale with a documented floor or by dropping that descriptor.
  - Mix 20% uniform with 80% normalized raw weight.
  - A deterministic solver picks the half-life or bandwidth so that ESS =
    1/Σw² ≈ 60% of the stage length. Solve separately for search and for
    validation, **without looking at returns**.
  - If the target cannot be reached, use the closest concentration and log it.
    Invalid weights fall back to Uniform.
- **Done when:** tests show ESS within tolerance for both policies, the scaling
  never sees validation data, and the fallback path is exercised.

## D3 Group-aware evolutionary search

- **Owns:** `calibration/search.py`, tests
- **Depends on:** 0-B (grid, validity, repair); a fake evaluator until C4 lands
- **Spec:** §10 "The starting search budget", "Final selection"
- **Work:**
  - Start with 256 distinct configs sampled across subsets and the grid; keep
    a population of 64 promising, varied configs.
  - Each round proposes 1,024 valid, distinct candidates: about 75% from
    mutation or recombination, 25% from broad sampling, with repair to the
    allowed domain.
  - Evaluate 64 per round: 32 with high predicted score, 16 with high model
    disagreement, 16 random. Before the surrogate is ready (fewer than 128
    feasible results), use the evolutionary and broad proposals only.
  - Count adjustments for duplicates or an exhausted pool follow a recorded
    deterministic rule.
  - Stop at a budget of 2,048 **logical** evaluations; a cache hit still
    counts. Three fixed seeds.
  - Keep up to 12 top feasible configs per seed and hand them to D5.
  - Writing a small implementation is fine; pymoo is optional (needs approval
    as a new dependency).
- **Done when:** the search is deterministic for a given seed, the audit trail
  records every proposal, evaluation and selection reason, and it finds the
  planted optimum on a synthetic objective.

## D4 Surrogate model

- **Owns:** `calibration/surrogate.py`, tests
- **Depends on:** 0-B (`feature_vector`)
- **Spec:** §10 "What the surrogate learns"
- **Work:** five `HistGradientBoostingRegressor`s (200 iterations, learning
  rate 0.05, max 15 leaves, min 20 samples per leaf, L2 = 1), each fitted on a
  bootstrap sample of (config features → observed search score). Return the
  mean prediction and the disagreement (std across the five). Refit after each
  batch. The target is the candidate's search score, **not** stock returns.
- **Done when:** the model fits and predicts on synthetic data, the seeds are
  fixed, and there is a usefulness metric (rank correlation of predictions vs
  actual scores on the next batch) that E3 can track.

## D5 Acceptance rules and finalist selection

- **Owns:** `calibration/acceptance.py`, tests
- **Depends on:** 0-C (`AccountResult`)
- **Spec:** §9 "Eligibility and finalist acceptance", §10 "Final selection"
- **Work:**
  - Search-stage floor: at least 100 filled trades across at least 50
    sessions.
  - Validation floor: at least 30 trades across at least 20 sessions, J > 0
    under the 10 bps scenario, and max drawdown ≤ 10%.
  - Always reject invalid accounting, unresolved data errors, or more than 30%
    of entries in one stock.
  - Deduplicate finalists across seeds (at most 36) and pick the highest
    validation J. Ties go to fewer filters, then the stable config ID.
  - If nothing qualifies, the result is `no_deployment` with reasons.
- **Done when:** every rule has a pass and a fail test, and every rejection
  reason is carried into the artifact.

## D6 Evaluation cache

- **Owns:** `calibration/cache.py`, tests
- **Depends on:** 0-C
- **Spec:** §12 "What is cached", §11 "Reusing a cached account return path
  and applying new weights is legitimate when …"
- **Work:** cache the exact daily return path per candidate. The key must
  include the data version, date range, universe schedule version, config ID,
  execution model, portfolio settings and code version. A weight change reuses
  the path; any other change invalidates it. Store on local scratch (Parquet or
  SQLite), safe to read from several processes.
- **Done when:** tests show a hit for a weight-only change and a miss for each
  key component, and hit-rate counters exist for E1.

## D7 Weekend calibrator (one cutoff → one artifact)

- **Owns:** `calibration/weekly.py`, `calibration/artifact.py`, CLI subcommand
  `shpe momentum calibrate` (**Coordinate** on `cli.py`)
- **Depends on:** D1–D6, C4, B5, A5, 0-A
- **Spec:** §7 "Every historical weekend", §11 steps 1–6
- **Work:**
  1. Lock the cutoff to the last completed session.
  2. Load the coming week's universe from A5.
  3. Define the expanding search window (archive start up to the start of
     validation) and validation (the most recent 63 sessions).
  4. Compute the weights for the policy.
  5. Run the search under its budget, process-parallel and with bounded
     threads.
  6. Validate the finalists, select one, and write the 0-A artifact or a
     `no_deployment` artifact with all reproducibility fields.
- **Done when:** one weekend runs end to end on the 30 × 20 pilot and on a 300 ×
  early-history window, and the artifact validates against the schema.

## D8 Walk-forward driver and forward accounts

- **Owns:** `calibration/walkforward.py`, CLI subcommand `shpe momentum walkforward`
- **Depends on:** D7
- **Spec:** §7 "Development and the final reserved period", §9 "The three
  selected policies then each maintain their own forward account", §11
  "Failure and inactivity are different"
- **Work:**
  - Loop over every historical weekend × 3 policies: calibrate (D7), then
    replay the next week with the chosen config on that policy's **forward
    account**.
  - Each forward account starts at $100,000 and flat at the start of the
    reserved period, and its equity carries across weeks (no weekly resets).
  - A `no_deployment` week is kept in the record as inactive. A crashed job is
    an **operational failure**: resume it from the checkpoint and never fill
    it with an invented result.
  - Hard guard: refuse to calibrate or replay past `reserved_start` unless the
    run is marked `frozen=true` with the protocol hash from E5.
  - Write the App. B run records.
- **Done when:** it runs over several consecutive development weeks with
  resume-after-kill verified, and the per-policy daily account series are
  written for E2.
