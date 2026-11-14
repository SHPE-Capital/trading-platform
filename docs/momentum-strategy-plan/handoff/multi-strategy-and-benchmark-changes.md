# Handoff: benchmark findings, plan changes, and running several strategies

Written 2026-11-13. Back to [README.md](README.md). Read after your person file. This
note records what the first real E1 benchmarks found, what must change in the plan, and how
to run **several strategies at once** without multiplying the cost.

**Evidence levels.** *Measured* means a number from real code on this machine (Ryzen 7 3700X,
8 cores and 16 threads, 16 GB RAM, about 70 GB free disk), with synthetic minute bars unless
noted. *Estimate* means arithmetic on measured components, not a benchmark output. The
rerun on `p1/MO-D6-bench` (256 candidates, real D6 cache, per-stage timings) will replace the
estimates. Pull numbers are from a **paid** Alpaca plan; the project plans to move to the free
plan, so re-measure the rate limit and SIP access then.

## 1. Final scope

Lead decision: **N = 1,000 stocks, 10 years** (staged: pilot, 300 x 2, 500 x 5, then
1,000 x 10). All other numbers stay at the protocol defaults until E5 freezes them. See
"Final settings" in [../momentum-config-reference.md](../momentum-config-reference.md).

**It does not fit the development machine.** Measured or derived: pull about 44 h and 126 GB
(3 x N pool, Parquet, 190 requests/min), float32 panel about 20.5 GB, replay RAM about 4.6 GB
per worker at one thread. The final run needs a **compute host with at least 200 GB disk and
32 GB RAM** (AWS inside the credit budget, or HPC), or the 500 x 5 fallback (about 11 h pull,
32 GB). Person 1 owns the host decision through E6; record it in 0-F.

## 2. What the benchmarks showed (measured unless marked)

| Finding | Number | Consequence |
|---|---|---|
| Numba account replay (63 sessions, 1 thread) | 0.025 s (N=300), 0.041 s (500), 0.049 s (1,000); 30 to 35 times the Python oracle; exact parity | C5 is done; keep the oracle for tests |
| Kernel thread scaling | about 10 times on 16 threads | parallelize across candidates |
| End-to-end thread scaling | 8 and 16 threads were slower than 1 (indicator work holds the GIL) | parallelize across week chunks with processes sharing memory-mapped arrays |
| Cold indicator build, one config, 300 stocks, 25 sessions | 20.8 s before, 1.65 s after the Numba pass | the indicator build, not replay, is the cost floor and is shared by all candidates in a chunk |
| Week-chunk cache | one new chunk per config per week; about 92% reuse over consecutive weeks | D6 works as designed |
| Panel size | 2.05 MB per stock-year; one 1,000-stock week is 41 MB | 1,000 x 10 is about 20.5 GB, chunk and map it |
| Pilot pull (77 symbols, 2.25 years) | 19.25M bars, 789 MB, 881 s, no 429s, 6,901 bars per request, 41 bytes per row | the plan assumed 10,000 bars per request and about 22 bytes per row, so pull time and disk are about 2.5 and 2 times worse |
| Delisted coverage | minute bars back to 2016 for TWTR, SIVB, ATVI and others; renamed tickers stop at the rename | A3 stable asset IDs are required |
| First full matrix (64 candidates) | projected 20 to 247 h per weekend with the cache | **do not cite**: the shared indicator cost was charged per candidate on a small sample |

## 3. Plan changes (each is a task edit; the packets already carry the status notes)

1. **B7 persisted indicator cache (new).** Persist indicator and signal arrays per week
   chunk, memory-mapped. The indicator build becomes a once-per-chunk cost shared by every
   config, strategy and weekend, and RAM per worker drops. Highest value.
2. **D6 extensions.** Deduplicate by signal-mask hash plus account settings; optional
   per-session keys (positions are flat every night); put the warm-up prefix length in the
   key or code version. A stand-in D6 is on `p1/MO-D6-bench`; **Person 2 confirms they have not
   started D6 before either version is adopted.**
3. **A6 conversion step.** Convert pulled Parquet to float32 week-chunk panels per stage and
   delete the Parquet, or pull on a host with 200 GB or more disk. Time the conversion (never
   measured).
4. **Pool is 3 x N for pull cost.** Use 3 x N symbols in every size and time estimate.
5. **B5 follow-up.** Pass the cached RVOL ratio into `readiness_masks` (recomputed today,
   about 1.2 s of the cold build).
6. **D7 calls the fast path directly** with a prepared panel; decide who supplies the
   20-session history prefix to a week chunk (`warmup_sessions` is not on the
   `account_types` wrapper).
7. **Do not set the D5 trade-count floors until a real panel run.** Synthetic prices cannot
   tell real trades per week. Run steps 3 and 4 on the pilot panel (`--panel-dir`).
8. **Treat the surrogate (D4) as a projection knob** (`search_replay_fraction`). Replay costs
   milliseconds per candidate; the surrogate only pays if replay or search overhead dominates.
9. **C7 gaps.** Add the halt-prevents-exit scenario; the engine never blocks exits today.
10. **E1 changes.** Report the indicator build per chunk; add a benchmark-level check against
    hand-worked trades (it currently checks determinism only); time Parquet to panel conversion.

## 4. Please confirm (assumptions made without the guide's Appendix A or the T1 branch)

For **Person 2**:

- Grid subset rule: breakout always on, plus 1 to 3 of ADX, EMA, RVOL, VWAP, all five
  excluded (the only rule that gives 14 subsets and 69,732 configs; ADX as anchor fits too).
- Indicator seeding (mean of the first n valid inputs), reset on non-finite input, which
  indicators carry across sessions, RVOL needing contiguous same-session bars.
- Within-bar exit order: gap through the stop at the open, then timed exit at the open, then
  a low crossing the stop; ambiguity flag rule.
- Worked sizing example (160 shares): assumed equity 100k, price 50, ATR 1.0.
- Daily halt at equity at or below 99% of start-of-day, liquidation at the next open.
- `juancavallin/T1` is missing; `trade/exits.py` was rebuilt minimally. Reconcile if found.

For the **lead**: the `numba` and `psutil` dependencies and ADR 0013 (status Proposed).

## 5. Running several strategies at once

Assume 10 strategies, each with its own signal grid and search budget (2,048 evaluations,
3 seeds, 3 policies, at most 18,432 distinct evaluations per weekend each).

### What is shared and what is not

| Shared across strategies | Not shared |
|---|---|
| Panel chunks, universe schedule, ranking tables | Replays of different configs |
| Indicator arrays, when strategies use the same indicators and settings (B7) | Anything whose cache key differs |
| Return paths of identical configs with identical account settings | Results across a different N or universe (stocks compete for cash) |
| Identical signal masks (mask-hash dedupe) | Results after any change to exits, sizing, costs or code version |

### Cost model (estimate, 16 threads, per weekly calibration)

Replay is about 15 to 30 min per strategy at 5 years (N = 300 to 1,000) and about double at
10 years; the indicator build is about 5 to 30 min and is shared.

| Setting | Ten strategies separately | Ten strategies sharing indicators and panel | With about 50% config reuse from last week |
|---|---|---|---|
| N = 300, 5 years | about 3.5 h | about 2.5 h | about 1.5 h |
| N = 1,000, 5 years | about 7.5 to 10 h | about 3.5 to 5.5 h | about 2 to 3 h |
| **N = 1,000, 10 years (final)** | about 12 to 16 h | about 8 to 12 h | about 4 to 6 h |

The first weekend is always cold. A one-year walk-forward is 52 weekends, so 10 strategies at
1,000 x 10 do not fit in one weekend; they need the levers below, or a larger host.

### Levers, in order of value

1. **B7 persisted indicators and mask-hash dedupe** (build first; they help every run).
2. **Return-path cache across weeks** (D6, built on the stand-in branch).
3. **Staged evaluation:** screen all candidates on a short recent window, replay only the top
   fraction over the full window.
4. **Coarser calibration step:** recalibrate every 2 or 4 weeks instead of weekly (2 to 4
   times less walk-forward).
5. **Smaller budget or fewer seeds** for the weaker strategies (the guide allows less than
   2,048).
6. **Surrogate (D4)** if replay turns out to dominate after the cache.
7. **Process-level parallelism over week chunks** with memory-mapped inputs, to use all 16
   threads on the indicator work.

### Live side

The platform can register many instances, but the single paper account shares cash and the free
plan allows one data stream per account. The plan runs **one** policy live and the others as
signal-only shadow instances (P2-8). With several strategies, shadow all but the top one or two.

## 6. Ownership and order

| Order | Task | Owner | Notes |
|---|---|---|---|
| 1 | Finish the rerun on `p1/MO-D6-bench`; paste the table into E1 | Person 1 | replaces the estimates above |
| 1 | Confirm Appendix A items (section 4) | Person 2 | blocks sign-off on B1 to B5, C2, C4 |
| 1 | Confirm D6 ownership; adopt one cache | Person 2 and Person 1 | |
| 2 | B7, D6b (mask-hash dedupe), D9 (strategy registry), B5 follow-up | Person 2 | brief: [agents/r6-reuse.md](agents/r6-reuse.md); cache-key spec is in that brief; packets in the B and D stream files |
| 2 | Compute host decision and `--panel-dir` run on the pilot panel | Person 1 | 0-F input |
| 3 | A6 conversion timing, E1 table changes, C7 halt scenario | Person 1 / Person 2 | |

Rules from the README apply: stage by explicit path, no `git stash`, no broker calls or data
pulls as incidental checks, every number a field in the protocol config.
