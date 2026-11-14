# Stream E: Evaluation, benchmarks and protocol

Back to [MOMENTUM_TASKS.md](MOMENTUM_TASKS.md). Repo: **research-python**
(code plus the study folder).

E5 and E6 can start immediately. E1 is the gate for the scope decision (0-F),
so it starts as soon as C4 has a first version. E2 and E3 can be built against
synthetic daily return series now and pointed at D8 output later.

Existing code to build on: `evaluation/stats.py` (`paired_block_bootstrap`,
`block_bootstrap`, `deflated_sharpe`), `evaluation/report.py`,
`evaluation/trading.py`.

---

## E1 Benchmark harness and compute projection

- **Owns:** `scripts/momentum/bench.py`, `studies/momentum/rm9-weekly-calibration/bench/` (results)
- **Depends on:** C4 (first version), B5, A6; C5 for the final numbers
- **Spec:** §13, §14 "The benchmark sequence"
- **Work:** run the guide's sequence:
  1. One stock over a few sessions (correctness).
  2. 30 stocks × 20 sessions (data loading and indicator profile).
  3. 300 stocks (or the 0-F N): one **early** and one **late** history
     calibration with at least 256 candidates, all three weighting
     calculations, finalist validation and account replay.
  4. Several consecutive weekly cycles (incremental reuse).

  Measure seconds per actual candidate replay (cold and warm cache), cache hit
  rate, peak RAM and I/O throughput. Project total wall time for the full run
  (weeks × policies × seeds × budget) at the measured rate with a **2× rerun
  reserve**, plus the weekend job time against the 24-hour target.

  **Scale matrix (added 2026-11-13):** repeat step 3 for N ∈ {300, 500, 1,000} and
  history ∈ {2, 5, 10} years as far as RAM and data allow. Record per cell:
  seconds per candidate-window at 1, 8 and 16 threads, **peak RAM per worker and
  total**, panel bytes, disk bytes and pull time. Project the full run **twice**:
  with the D6 week-chunk cache (expected) and without it, so the lead sees why
  the cache is required. Test the cache by running several consecutive weeks (step
  4) and report new chunks computed per week. A first proxy (synthetic data, this
  machine) is in [momentum-config-reference.md](momentum-config-reference.md);
  replace it with measured numbers.
- **Done when:** a one-page table with measured numbers and the projection
  exists; it goes to the lead for 0-F by **Nov 17**.

## E2 Policy comparison report

- **Owns:** `src/shpe_research/evaluation/policy_compare.py`, `scripts/momentum/report.py`, tests
- **Depends on:** D8 output format (build on synthetic series now)
- **Spec:** §9 "The reported results", "Uncertainty without treating trades as
  independent"
- **Report contents:**
  - Per policy: cumulative net return and ending equity, max drawdown, average
    daily return, downside variability, trade count, active days,
    no-deployment weeks, average holding time, exposure, turnover, rejected
    signals, concentration by stock and date, cost sensitivity (5, 10, 20 bps)
    and calibration runtime.
  - **Primary result:** daily net account return of Similarity − Recency on
    paired dates, with a paired block bootstrap (5-session blocks, plus 10 and
    20 as sensitivity, 2,000 resamples). Uniform is shown for context.
  - All three equity curves on the same calendar.
  - Whether the gains are concentrated in a few weeks or stocks.
  - Also emit a JSON summary for the dashboard (P3-3).
- **Done when:** the report renders from synthetic series, with a test that
  the bootstrap samples the **same blocks** for both policies.

## E3 Search diagnostics

- **Owns:** `src/shpe_research/evaluation/search_diagnostics.py`, tests
- **Depends on:** D3/D4 audit trail format
- **Spec:** §10 "Development checks search convergence …", §15 "Search checks
  during development"
- **Work:** score-vs-budget curves (smaller vs larger budgets on the same weeks),
  stability across seeds, how often optima sit on a parameter boundary,
  finalists that collapse on validation, a neighbor check around finalists,
  Jaccard similarity of signal masks (as a diversity diagnostic only), and
  surrogate rank correlation over time.
- **Done when:** the diagnostics run on development weeks and their findings
  feed into the protocol freeze (E5).

## E4 Leakage and reproducibility tests

- **Owns:** `tests/integration/momentum/test_no_lookahead.py`, `tests/integration/momentum/test_reproducible.py`
- **Depends on:** A4/A5, B5, D7 (can be written as skipped tests now)
- **Spec:** §15 "A deliberately altered future bar must not change an earlier
  signal, universe membership, or configuration"
- **Work:** tamper with a bar after a cutoff and assert that the signals,
  universe and artifact before the cutoff are unchanged. Run the same
  config and seed twice and require identical artifacts. Check that the
  search and validation cutoffs appear in every artifact. Also assert that
  selection at a cutoff never reads a D6 cache chunk at or after the cutoff.
- **Done when:** both tests pass in CI on fixture data.

## E5 Study folder, protocol and assumption register

- **Owns:** `studies/momentum/rm9-weekly-calibration/` (`README.md`,
  `protocol.md`, `assumptions.md`, `notes.md`), new rows in `docs/teams/momentum.md`
- **Depends on:** nothing to start; finalized at the **Nov 21 freeze**
- **Spec:** §17 "Keep an assumption register", §7 "Before opening the reserved
  results, freeze …", §15 "What a final evidence package contains", App. B
- **Work:**
  - Assumption register: each setting with its value, why it was chosen, the
    development evidence, and what would justify changing it (N, years, five
    components, unanimous agreement, 63-session validation, the exit package,
    sizing, search budget, cost scenarios, acceptance floors, ESS target).
  - Frozen protocol: the exact values plus a content hash. D8 checks that hash
    before touching the reserved period. The frozen file is the 0-G
    `MomentumProtocol` YAML (resolved, with the grid domain), so nothing is
    frozen that is not also configurable. Add the new **RM9** row to
    `docs/teams/momentum.md` (the study ID was renamed from RM1 to avoid the ORB
    program's RM1–RM8).
  - Changelog: any change after the freeze gets a date and a statement of
    whether the final evaluation remains untouched.
- **Done when:** the protocol is frozen, hashed and referenced by the reserved
  run.

## E6 Compute resource intake

- **Owns:** `docs/compute/momentum_resources.md`
- **Depends on:** nothing
- **Spec:** §13 "Initial machines to benchmark", "No allocation has been
  confirmed"
- **Reference machine (measured 2026-11-13):** Ryzen 7 3700X (8 cores, 16
  threads), 15.9 GB RAM (only about 2.4 GB free with the usual apps open), 2 TB
  NVMe with about 86 GB free, RTX 3070 Ti (unused by this plan). Fits N = 500
  over 5 years (about 5 GB panel); N = 1,000 over 10 years (about 20 GB) needs
  chunked memory-mapping or a larger-RAM host.
- **Work:** for each candidate host (AWS account, university HPC, team
  laptops), record usable cores, RAM, local scratch, wall-time limits, queue
  delay, credit limits, whether market data may be stored there, and how to
  launch a checkpointed job. Recommend a host for the research run and a
  separate host for the always-on paper service.
- **Done when:** the lead has what they need for 0-F.

## E7 Presentation package

- **Owns:** `studies/momentum/rm9-weekly-calibration/presentation/`
- **Depends on:** E2, D8; walkthroughs from P1/P2
- **Spec:** §16 "Practice explaining one trade, one weekend update, and one
  policy comparison", §15 "What a final evidence package contains"
- **Work:** charts (equity paths, paired difference with CI, cost
  sensitivity, runtime); one traced trade from bar to fill; one traced weekend
  update; a measured-limitations slide; evidence package checklist.
- **Done when:** rehearsal done by Nov 27.
