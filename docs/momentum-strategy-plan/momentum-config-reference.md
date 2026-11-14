# Momentum: configuration reference and scope recommendations

Back to [MOMENTUM_TASKS.md](MOMENTUM_TASKS.md). Written 2026-11-13.

Rule for the whole program: **every number below is a field in one typed
protocol config, never a constant in code.** The defaults are the guide's
provisional values; the "Recommended" column is the proposal for 0-F. Until the
Nov 21 freeze any value can change by editing the config. After the freeze the
config is hashed (E5) and a change needs a dated changelog entry.

## How configuration works (task 0-G)

- One pydantic model, `MomentumProtocol`, in `src/shpe_research/config/momentum.py`
  (the repo already types configs with pydantic, ADR 0008). `extra="forbid"`, so a
  misspelled key fails loudly.
- Default values live in `configs/momentum/protocol.default.yaml`. The frozen run
  uses `studies/momentum/rm9-weekly-calibration/protocol.yaml`.
- CLI overrides (`--set search.budget=4096`) are allowed in development, are
  recorded in every artifact, and are refused when `frozen=true`.
- The content hash covers the full resolved config including the grid domain.
- Review rule: a numeric literal that is a tunable in module code is a defect.
  Sections below map to the packets that read them.

## Parameters

| Section | Key | Default | Recommended | Read by | Decided in |
|---|---|---|---|---|---|
| **scope** | `universe.n_stocks` | 300 | **500 start, 1000 stretch**; 300 only as fallback | A5, A6, C4 | 0-F |
| | `universe.pool_max_symbols` | none | about 3 × N | A1, A4 | 0-F |
| | `universe.liquidity_bands`, `volatility_bands` | 3, 3 | keep | A5 | E5 |
| | `universe.hash_seed` | fixed | keep | A5 | E5 |
| | `data.analysis_years` | 5 | **5 to 10**: pull 5 first, extend toward 10 if A1 coverage and disk allow | A1, A5 | 0-F |
| | `data.reserved_start` | date | declared before any evaluation | D8 guard | 0-F |
| | `data.feed` | sip | sip for research (see risks) | A1 | A1 audit |
| **eligibility** | `eligibility.min_dollar_volume` | $10M median, 20 sessions | keep, or scale with N | A4 | E5 |
| | `eligibility.min_history_sessions` | 60 | keep | A4 | E5 |
| | `eligibility.min_bar_coverage` | 0.95 | keep | A4 | E5 |
| | `signals.warmup_multiple` | 5 | keep | B4 | E5 |
| **grid** | `grid.version` and the five component domains (n, b, ADX period and q, EMA fast/slow/d, RVOL window and v, VWAP e) | Appendix A, 69,732 configs | keep for the first run; widen later only as a new grid version | 0-B, D3 | before freeze |
| | `signals.rvol_history_sessions`, `rvol_min_observations` | 20, 15 | keep | B3 | E5 |
| **fill and costs** | `fill.limit_markup` | 0.0020 | keep | C1 | E5 |
| | `costs.scenarios_bps` | [5, 10, 20] | add 30 | C1, E2 | E5 |
| | `costs.selection_bps` | 10 | 10, **and report 20 for every finalist** | D5 | E5 |
| **exits** | `exit.initial_stop_atr`, `trail_activation_atr`, `trail_distance_atr` | 1.5, 1.0, 1.5 | keep | C2 | E5 |
| | `exit.max_hold_minutes`, `session_exit_minutes_before_close` | 60, 5 | keep | C2 | E5 |
| **account** | `account.starting_cash` | 100,000 | keep | C4, D8 | E5 |
| | `account.max_positions` | 10 | scale with N, test 10, 15, 20 | C3, C4 | E5 |
| | `account.per_stock_pct`, `risk_pct`, `total_exposure_cap` | 0.08, 0.0025, 0.80 | keep | C3 | E5 |
| | `account.liquidity_cap_pct`, `liquidity_lookback`, `liquidity_min_obs` | 1%, 20, 15 | keep | C3 | E5 |
| | `account.daily_halt_pct` | 0.01 | keep | C4 | E5 |
| | `account.ranking` | `dollar_volume_20d` | pluggable (see stream F) | C4 | E5 |
| **weights** | `weights.uniform_mix` | 0.20 | keep | D2 | E5 |
| | `weights.ess_target_fraction` | 0.60 | keep, test 0.4 and 0.8 on dev weeks | D2 | E5 |
| | `weights.descriptor_lookback`, `score.downside_coeff` | 20, 0.5 | keep | A7, D1 | E5 |
| **search** | `search.budget` | 2,048 logical | **2,048 for protocol, 8,192 as a development comparison** | D3 | 0-F |
| | `search.seeds` | 3 fixed | 3 (list, so 5 is a one-line change) | D3 | 0-F |
| | `search.initial_samples`, `population`, `proposals_per_round` | 256, 64, 1,024 | keep | D3 | E5 |
| | `search.mutation_share`, `evals_per_round`, `evals_split` | 0.75, 64, [32, 16, 16] | keep | D3 | E5 |
| | `search.surrogate_min_results` | 128 | keep | D3 | E5 |
| | `search.finalists_per_seed`, `max_finalists` | 12, 36 | test 12 vs 24 on dev weeks | D3, D5 | E5 |
| | `surrogate.*` (models, iterations, learning rate, leaves, min leaf, L2) | 5, 200, 0.05, 15, 20, 1 | keep | D4 | E5 |
| **validation** | `validation.sessions` | 63 | **63 as the protocol, 126 as a sensitivity** | D7 | E5 |
| | `acceptance.search_min_trades`, `search_min_sessions` | 100, 50 | scale with N (more stocks give more trades) | D5 | E5 |
| | `acceptance.validation_min_trades`, `validation_min_sessions` | 30, 20 | raise to 50, 30 at N of 500 or more | D5 | E5 |
| | `acceptance.max_drawdown`, `max_single_stock_share` | 0.10, 0.30 | keep | D5 | E5 |
| **evaluation** | `bootstrap.block_sessions`, `sensitivity_blocks`, `resamples` | 5, [10, 20], 2,000 | resamples 10,000 (cheap) | E2 | E5 |
| **quote replay** | `quote_replay.enabled`, `max_quote_age_s`, `max_spread_pct`, `limit_offset_pct`, `cancel_after_s` | on/off, 2, 0.10%, 0.05%, 2 | enable for finalists | C6 | 0-F |
| **compute** | `compute.workers`, `threads_per_worker`, `dtype`, `scratch_dir`, `rerun_reserve` | per host | measure in E1 | D7, A6 | E1, E6 |

## Final settings (lead decision, 2026-11-13)

The lead set the final run to **N = 1,000 stocks over 10 years**. Everything else
stays at the defaults in the tables above until E5 freezes the protocol. Put these in the
protocol config (0-G); they are not code constants.

| Key | Final value | Note |
|---|---|---|
| `universe.n` | **1,000** | pool to pull is about 3 × N = 3,000 symbols |
| `history.years` | **10** | declared before evaluation; reserved period excluded |
| `search.budget`, `seeds`, `finalists_per_seed` | 2,048, 3, 12 | unchanged protocol |
| `validation.sessions` | 63 | unchanged |
| `acceptance.validation_min_trades` / `min_sessions` | 50 / 30 | raised for N of 500 or more, see table above |
| `compute.rerun_reserve` | 2.0 | unchanged |

**This setting does not fit on the development machine as measured (Nov 13).** The
requirements it creates are in the next table; the lead must resolve them (0-F) before the
big pull:

| Need at 1,000 × 10 | Measured or derived | This machine (16 GB RAM, ~70 GB free disk) |
|---|---|---|
| Pull, Parquet on disk | about 44 h and about 126 GB at 190 requests/min, 41 bytes/row (paid plan; free plan unverified) | **Does not fit on disk.** |
| Panel, float32 week chunks | about 20.5 GB (2.05 MB per stock-year), must be chunked and memory-mapped | Exceeds RAM; fits disk if Parquet is converted and deleted per stage |
| Replay RAM, one worker, N = 1,000 | about 4.6 GB per worker at 1 thread, 12.6 GB total at 16 threads (projected) | Limits workers to 2 to 3 unless indicators are memory-mapped (B7) |
| Weekly calibration at 1,000 stocks, 5 years | about 45 to 60 min cold, 30 to 45 min with reuse (estimate, not yet measured) | 52 weekends do not fit in one weekend |

So the final run needs a **compute host with at least 200 GB disk and 32 GB RAM** (AWS
within the credit budget, or HPC), or a reduced fallback from the stage plan below. Keep
the stage gates: do not start the 1,000 × 10 pull until 300 × 2 and 500 × 5 have passed
their gates. Fall back to 500 × 5 (about 11 h pull, 32 GB) if the host or the freeze date
does not allow it. Record the choice and the date in 0-F.

## Scope recommendation (for 0-F)

Go bigger, but stage it so a failure is cheap and the freeze date stays safe.

| Stage | N | Years | Purpose | Gate to move on |
|---|---|---|---|---|
| Pilot | 30 | few sessions | correctness (E1 step 1, C7 scenarios) | C7 green |
| Mid | 300 | 2 | profile the engine (E1 steps 2 and 3) | speed per replay recorded |
| **Full, first target** | **500** | **5** | development weeks, search diagnostics (E3) | E1 projection fits the calendar |
| **Stretch** | **1000** | **10** | final run, only if E1 and A1 allow | A1 coverage, disk, RAM, E1 time |

The pool of symbols to pull is larger than N because the weekly universe rotates
and must include names that later delisted. Set `pool_max_symbols` to about 3 × N.

### Why more stocks and years are worth it

- More stocks produce more breakout events per week. The acceptance floors
  (trades and sessions) are met more reliably, J is less noisy, and one stock
  matters less.
- More years give Similarity weighting more past regimes to match and the
  surrogate more training weeks. Recency gains nothing from length, so a longer
  history is a fairer test of the Similarity − Recency question.
- More history does not by itself raise live returns. It reduces the chance of
  deploying a lucky config. Treat it as evidence quality, not alpha.

### Measured results so far (2026-11-13, this machine, paid Alpaca plan)

These replace the proxy figures below where they overlap. All come from real code on
synthetic minute bars unless noted; trade density on real data will differ.

- **Account replay (C5 Numba kernel, 63 sessions after a 20-session warm-up, 1 thread):**
  0.025 s at N = 300, 0.041 s at 500, 0.049 s at 1,000, about 30 to 35 times the pure
  Python oracle, with exactly matching ledgers. 16 threads give about 10 times
  (the proxy predicted 2.5 times). Timings were taken while other jobs ran, so they are
  noisy upward.
- **Indicators:** the cold indicator and mask build, not the account replay, is the cost
  floor. After the Numba pass one config's cold build on 300 stocks and 25 sessions fell from about 20.8 s to
  1.65 s. This cost is shared by every candidate in a chunk, so it must not be charged
  per candidate in projections. The first E1 matrix run did charge it per candidate on a
  sample of 64, which makes its 20 to 247 h weekend projections far too pessimistic; rerun
  with at least 256 candidates and the D6 cache (branch `p1/MO-D6-bench`).
- **Threads:** the kernel scales about 10 times on 16 threads, but the end-to-end path
  was slower with 8 and 16 threads than with 1 (NumPy indicator work holds the GIL).
  Parallelize across week chunks with processes sharing memory-mapped arrays.
- **Panel:** 38.8 KB per stock-week and 2.05 MB per stock-year (float32, five fields).
  1,000 stocks over 10 years is about 20.5 GB. One 1,000-stock week chunk is 41 MB.
- **Week-chunk cache:** consecutive weeks reuse about 92% of (config, chunk) results; a
  window advanced one week computes exactly one new chunk per config.
- **Pilot pull (77 symbols, 2.25 years, SIP, paid plan):** 19.25 million bars, 789 MB,
  881 s, no errors, no 429s. 6,901 bars per request (the plan assumed 10,000), 41 bytes
  per row. The 190 requests/min is our own throttle, so the real limit is unknown.
  Delisted names have minute bars back to 2016; renamed tickers stop at the rename.

### Size and time estimates (proxy-based, superseded by the measurements above)

The proxy (synthetic minute bars, Numba account loop, this Ryzen 7 3700X, 16
threads, 63-session window per candidate) measured:

| N | 1 thread | 16 threads | scaling |
|---|---|---|---|
| 300 | 0.061 s | 74 candidates/s | 4.5× |
| 1,000 | 0.114 s | 21.6 candidates/s | 2.5× |

Cost grows far less than N (3.3× stocks cost about 1.9×), but multi-thread
scaling falls with N, which points to memory bandwidth. Estimates built on it:

- **Search window cost.** A 5-year search window (1,260 sessions) at N = 1000 is
  about 1.1 candidates/s on 16 threads. 2,048 evaluations take about 32 minutes
  per seed; 3 seeds take about 1.6 hours per policy per cutoff. Without reuse,
  about 40 weekly cutoffs × 3 policies would take **about 190 hours**. This does
  not fit the calendar. **Reuse is therefore required, not an optimization**
  (next section).
- **Panel memory.** One year of five float32 fields for 1,000 stocks is about
  2 GB. Ten years is about 20 GB, more than this machine's 16 GB RAM. Memory-map
  and read by week chunk. N = 500 over 5 years is about 5 GB and fits.
- **Disk.** Upper bound about 22 bytes per row measured on incompressible data
  (real bars should compress better). A pool of 2,000 symbols over 10 years is
  about 2 billion rows and at most about 43 GB. Free disk is about 86 GB.
- **Pull time.** If the free plan allows 200 requests per minute at 10,000 bars
  per request (Alpaca defaults, **A1 must verify**), 2 billion rows take about 16
  hours. Start the pull early and make it resumable.

### Required design change: cache by week chunk (D6, C4)

Every trade closes the same session (exit at close − 5 minutes), and sizing is a
percentage of equity, so a config's return on one session does not depend on
other sessions apart from integer rounding and the liquidity cap. The consequence:

1. Key the evaluation cache **per config and per week chunk**, not per whole date
   range. An expanding window then costs only the one new week for every config
   already seen.
2. Search and validation replays start every session from a fixed reference
   equity (a config field), so past chunks never change. Forward accounts still
   carry real equity. Lead to confirm against guide §12 before relying on it.
3. The three policies share the cache, because weights apply to cached returns.
4. Selection at a cutoff may only read chunks before that cutoff. Add this to the
   E4 leakage tests.

With this, later cutoffs are close to a lookup plus weights plus validation. The
whole grid is only 69,732 configs, so an **exhaustive precompute** of all of
them over the history is about 18 hours (5 years) to 36 hours (10 years) at
N = 1000 by the proxy. Keep the 2,048 search budget as the protocol, because it
mirrors what a team could run weekly. Use the exhaustive result as ground truth
for E3: does the search find the true top configs, and is the surrogate helping?

## Reusing work across runs and strategies (added 2026-11-13)

Benchmarks showed the week-chunk return cache alone is not enough. Four reuse levels, in
the order to build them (full detail and the multi-strategy cost model are in
[handoff/multi-strategy-and-benchmark-changes.md](handoff/multi-strategy-and-benchmark-changes.md)):

1. **Return-path cache per config and week chunk (D6).** Shared by the three policies,
   all seeds and every later weekend. Weights are not in the key.
2. **Persisted indicator arrays per week chunk (new task B7).** Key: data version,
   indicator and parameter setting, warm-up length. Memory-mapped, so every config,
   strategy and weekend reuses them and RAM per worker drops.
3. **Mask-hash deduplication (D6 extension).** Identical signal masks with the same
   account settings give identical returns; replay each unique mask once.
4. **Per-session keys (optional D6 granularity).** Positions are flat every night, so a
   session is independent given its 20-session history; this survives window changes.

Reuse never crosses a change of universe or N (stocks compete for cash), exits, sizing,
costs or the code version, because those are in the key.

## Widening the search space (grid v2, exits and account as parameters)

Today only the five signal components are searched (about 3 to 4 values each,
69,732 configs). Everything below is **fixed** in the guide, so it is where the
largest unexplored range is.

| Dimension | Now | Proposed to test | Key |
|---|---|---|---|
| Breakout length n | {10, 20, 40, 60} | add 5, 15, 30, 90, 120 | `grid.breakout.n` |
| Breakout buffer b (ATR) | {0, 0.10, 0.25} | add 0.05, 0.15, 0.35, 0.50 | `grid.breakout.b` |
| ADX period, threshold | {7, 14, 21}, {15, 20, 25, 30} | add periods 10, 28; thresholds 10, 35, 40 | `grid.adx.*` |
| EMA fast, slow, d | {5, 8, 12}, {20, 35, 60}, {0, 0.10, 0.25} | add fast 3, 21; slow 90, 120; d 0.5 | `grid.ema.*` |
| Relative volume window, v | {3, 5, 10}, {1, 1.5, 2} | add windows 15, 30; v 2.5, 3 | `grid.rvol.*` |
| VWAP band e | {1, 2, 3} | add 0.5, 1.5, 4 | `grid.vwap.e` |
| **Initial stop (ATR)** | 1.5 fixed | {1.0, 1.5, 2.0, 3.0} | `exit.initial_stop_atr` |
| **Trail activation (ATR)** | 1.0 fixed | {0.5, 1.0, 1.5, 2.0} | `exit.trail_activation_atr` |
| **Trail distance (ATR)** | 1.5 fixed | {1.0, 1.5, 2.0, 3.0} | `exit.trail_distance_atr` |
| **Max hold (minutes)** | 60 fixed | {30, 60, 90, 120} | `exit.max_hold_minutes` |
| Max positions | 10 fixed | {5, 10, 15, 20} | `account.max_positions` |
| Entry window | not constrained | earliest and latest entry minute | `signals.entry_window` |
| Limit markup | 0.20% fixed | {0.10%, 0.20%, 0.30%} | `fill.limit_markup` |

How to do it safely:

1. **Versioned, never edited in place.** A wider domain is a new `grid.version`
   (v2); the config ID includes the version. v1 stays the protocol; v2 runs as a
   development comparison and only enters the freeze if it holds up on the
   validation weeks.
2. **Exits and account first as a small outer grid**, not inside the evolutionary
   search: for each outer cell (for example 4 stops × 4 holds × 3 position caps =
   48) run the normal search. This mirrors the ORB team's RM3 and RM5 and keeps the
   trial count countable. Only add exit parameters to the searched vector if the
   outer grid shows they matter.
3. **The space gets too big to enumerate.** Five-component v2 alone is in the tens
   of millions of configs; with exits it is far larger. The exhaustive precompute
   (stream F, F4a) stops being possible, so the surrogate (D4) carries more of the
   load and E3 must show it is helping (rank correlation, convergence versus
   budget). Raise `search.budget` with the space (development comparison 8,192 or
   more), and keep the neighbor-stability check (E3).
4. **Overfitting grows with the space.** More dimensions and finer steps make a
   lucky config more likely. Keep validation floors, report logical evaluations
   per finalist, and prefer the center of a plateau (the RM2 rule) over the single
   best cell. Finer steps are worthwhile mainly where the score surface is already
   smooth.
5. **Cache cost.** Exits and account parameters change the replay, so each new
   value multiplies the number of cached chunks (D6). Plan disk for the cache
   (per config per week) and prune by LRU.

## Where the code runs (decision)

| Piece | Where | Why |
|---|---|---|
| Indicators, signal rule, ranking, sizing, exits (decision logic) | **TypeScript in the platform** (P1), matching Python on golden fixtures | Strategies may not call external services |
| Account replay, weekly search, surrogate, weights, bootstrap | **research-python (Numba)** | About 1,000 times faster than the platform backtest engine (rough: 118k frames/s synthetic against a 29.5M-bar year) |
| Platform backtest engine | Independent **cross-check** of finalists only (E8) | Catches port bugs; too slow and too job-oriented for search |
| Bars | **Two separate stores, no sharing** (research Parquet, platform Supabase bar cache) | Different access patterns; the only interface is the weekly config JSON (0-A) plus the golden fixtures |

## Running several algorithms at once

- **Platform:** the orchestrator registers many strategy instances and the risk
  engine has per-strategy budgets. CPU is not the limit for minute bars. The limit
  is the **single paper account** (shared cash) and the data-stream limits. The
  plan runs **one** policy live and the other two as signal-only shadow instances
  (P2-8). Verify the free-plan symbol cap first (P2-7); if it is about 30, the live
  universe is a top-K subset of the weekly universe, or bars are polled by REST,
  or a paid plan is used.
- **Research:** `compute.workers` and `threads_per_worker` are config. Proxy
  scaling flattened beyond about 8 threads (memory bound), so prefer more
  processes sharing a memory-mapped panel over more threads, and measure in E1.

### Risks that grow with scale

- **Alpaca manifest.** `data/store.py` keeps one JSON manifest and rewrites all of
  it every 20 units. At 2,000 symbols × 120 months that is about 240,000 units
  rewritten again and again. Shard the manifest by year or move it to SQLite
  before A1's large pull.
- **Feed.** Research pulls should use SIP history, which the free plan allows
  except for the latest 15 minutes. Paper trading uses IEX quotes that go quiet.
  Record the difference when comparing replay with paper results (C6, P2-7).
- **More search, more luck.** A larger budget finds better in-sample configs.
  Keep validation floors and the deflated Sharpe check strict. Report how many
  logical evaluations stood behind each finalist.
- **Spread and impact.** At N of 1,000 the weaker liquidity cells have wider
  spreads. The 20 bps scenario and C6 quote replay matter more, not less.
