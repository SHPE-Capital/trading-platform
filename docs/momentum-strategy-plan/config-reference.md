# Momentum: configuration, scope and design decisions

Back to [README.md](README.md). Rule for the whole program: **every number below is a
field in one typed protocol config, never a constant in code.** Defaults are the guide's
provisional values. Until the Nov 21 freeze any value changes by editing the config; after
it, the config is hashed (T2-5) and a change needs a dated changelog entry.

## How configuration works (0-G)

- One pydantic model, `MomentumProtocol`, in research-python
  `src/shpe_research/config/momentum.py` (ADR 0008). `extra="forbid"`, so a misspelled key
  fails. Defaults live in `configs/momentum/protocol.default.yaml`; the frozen run uses
  `studies/momentum/rm9-weekly-calibration/protocol.yaml`.
- CLI overrides (`--set search.budget=4096`) are allowed in development, recorded in every
  artifact, and refused when `frozen=true`. The content hash covers the resolved config,
  including the grid domain once T2-1 adds it.
- Built so far: weights, score, search, surrogate, validation, acceptance, cache, compute,
  walk-forward. The other sections in the table are T2-1.

## Scope (lead decision, 2026-11-17)

**N = 500 selected weekly from a 1,500-ticker pool, over 5 years, computed on HiPerGator.**
1,000 × 10 stays the stretch and is not started.

| Key | Value | Note |
|---|---|---|
| `universe.n` | **500** | selected each week from the pool (A5, or the static fallback) |
| `universe.pool_max_symbols` | **1,500** | 3 × N; built by `configs/universe/momentum_pool1500_v0.yaml` (interim: one as-of date, so names that died before the window are missing) |
| `history.years` | **5** | plus a 3-month warm-up; reserved period excluded |
| `walkforward.reserved_start` | **not set** | lead decision 1; the walk-forward refuses to run without it |
| Pull | finished Nov 18 | numbers go in `docs/data/momentum_archive.md` (T1-1) |
| Panel | about 5 GB float32 for 500 × 5 (2.05 MB per stock-year) | fits in RAM |
| Replay RAM | about 2.3 GB per worker at N = 500 (E1, synthetic) | 16 to 24 workers fit in the 250 GB cap |

Compute host: HiPerGator, account and QOS `dream_team`, shared across every DTE project (32
CPUs, 250 GB, 4 GPUs, 744 h jobs). A 24 h run at 16 to 24 CPUs takes most of the CPU cap, so
tell the team first or use the burst QOS `dream_team-b` (low priority, 4-day limit). Group
storage is a shared 4 TB quota (about 1.1 TB free on Nov 17). Job scripts are in
research-python `scripts/momentum/hpg/`; setup is in `Neurospine/docs/hipergator.md`.

Still open: the free-plan rate limit (pilot numbers were paid-plan) and the reserved date.

## Parameters

| Section | Key | Default | Recommended | Read by | Decided in |
|---|---|---|---|---|---|
| **scope** | `universe.n_stocks` | 300 | **500** (decided) | A5, A6, C4 | 0-F |
| | `universe.pool_max_symbols` | none | **1,500** (decided) | A1, A4 | 0-F |
| | `universe.liquidity_bands`, `volatility_bands` | 3, 3 | keep | A5 | freeze |
| | `universe.hash_seed` | fixed | keep | A5 | freeze |
| | `data.analysis_years` | 5 | **5** (decided) | A1, A5 | 0-F |
| | `data.reserved_start` | date | declared before any evaluation | D8 guard | 0-F |
| | `data.feed` | sip | sip for research | A1 | A1 audit |
| **eligibility** | `eligibility.min_dollar_volume` | $10M median, 20 sessions | keep | A4 | freeze |
| | `eligibility.min_history_sessions` | 60 | keep | A4 | freeze |
| | `eligibility.min_bar_coverage` | 0.95 | keep | A4 | freeze |
| | `signals.warmup_multiple` | 5 | keep | B4 | freeze |
| **grid** | `grid.version` and the five component domains | Appendix A, 69,732 configs | keep for the first run; widen only as a new version | 0-B, D3 | freeze |
| | `signals.rvol_history_sessions`, `rvol_min_observations` | 20, 15 | keep | B3 | freeze |
| **fill and costs** | `fill.limit_markup` | 0.0020 | keep | C1 | freeze |
| | `costs.scenarios_bps` | [5, 10, 20] | add 30 | C1, E2 | freeze |
| | `costs.selection_bps` | 10 | 10, **and report 20 for every finalist** | D5 | freeze |
| **exits** | `exit.initial_stop_atr`, `trail_activation_atr`, `trail_distance_atr` | 1.5, 1.0, 1.5 | keep | C2 | freeze |
| | `exit.max_hold_minutes`, `session_exit_minutes_before_close` | 60, 5 | keep | C2 | freeze |
| **account** | `account.starting_cash` | 100,000 | keep | C4, D8 | freeze |
| | `account.max_positions` | 10 | test 10, 15, 20 at N = 500 | C3, C4 | freeze |
| | `account.per_stock_pct`, `risk_pct`, `total_exposure_cap` | 0.08, 0.0025, 0.80 | keep | C3 | freeze |
| | `account.liquidity_cap_pct`, `liquidity_lookback`, `liquidity_min_obs` | 1%, 20, 15 | keep | C3 | freeze |
| | `account.daily_halt_pct` | 0.01 | keep | C4 | freeze |
| | `account.ranking` | `dollar_volume_20d` | pluggable ([later ideas](later-ideas.md)) | C4 | freeze |
| **weights** | `weights.uniform_mix` | 0.20 | keep | D2 | freeze |
| | `weights.ess_target_fraction` | 0.60 | keep; test 0.4 and 0.8 on dev weeks | D2 | freeze |
| | `weights.descriptor_lookback`, `score.downside_coeff` | 20, 0.5 | keep | A7, D1 | freeze |
| **search** | `search.budget` | 2,048 logical | 2,048 protocol; 8,192 as a development comparison | D3 | T2-2 |
| | `search.seeds` | 3 fixed | 3 (a list, so 5 is a one-line change) | D3 | 0-F |
| | `search.initial_samples`, `population`, `proposals_per_round` | 256, 64, 1,024 | keep | D3 | freeze |
| | `search.mutation_share`, `evals_per_round`, `evals_split` | 0.75, 64, [32, 16, 16] | keep | D3 | freeze |
| | `search.surrogate_min_results` | 128 | keep | D3 | freeze |
| | `search.finalists_per_seed`, `max_finalists` | 12, 36 | test 12 vs 24 on dev weeks | D3, D5 | freeze |
| | `surrogate.*` (models, iterations, learning rate, leaves, min leaf, L2) | 5, 200, 0.05, 15, 20, 1 | keep | D4 | freeze |
| **validation** | `validation.sessions` | 63 | 63 protocol, 126 as a sensitivity | D7 | freeze |
| | `acceptance.search_min_trades`, `search_min_sessions` | 100, 50 | raise with N | D5 | freeze |
| | `acceptance.validation_min_trades`, `validation_min_sessions` | 30, 20 | **50, 30 at N = 500** | D5 | freeze |
| | `acceptance.max_drawdown`, `max_single_stock_share` | 0.10, 0.30 | keep | D5 | freeze |
| **evaluation** | `bootstrap.block_sessions`, `sensitivity_blocks`, `resamples` | 5, [10, 20], 2,000 | resamples 10,000 (cheap) | E2 | freeze |
| **quote replay** | `quote_replay.enabled`, `max_quote_age_s`, `max_spread_pct`, `limit_offset_pct`, `cancel_after_s` | off, 2, 0.10%, 0.05%, 2 | off unless the lead keeps C6 | C6 | 0-F |
| **compute** | `compute.workers`, `threads_per_worker`, `dtype`, `scratch_dir`, `rerun_reserve`, `max_wall_hours` | per host; 36 h for the first run, then `null` | set from T2-2 | D7, A6 | T2-2 |

## Run time limits (first weekend run, then long runs)

| Key | First run | Later runs (after the first result and E3) |
|---|---|---|
| `compute.max_wall_hours` | **36** | `null` or a host limit such as 168 |
| `search.budget` | 2,048 logical per seed | 2,048 protocol, plus the 8,192 and 5-seed comparison |
| `search.seeds` | 3 | 3 protocol, 5 for the comparison |
| Exhaustive precompute ([F4a](later-ideas.md)) | not run | allowed |
| Grid | current (69,732 configs) | grid v2, if E3 supports it |

1. **The limit picks a pre-declared budget; it does not cut a run mid-search.** Use the
   corrected E1 (T2-2) to choose the largest budget whose projected time is under 70% of
   `max_wall_hours`, and declare it in the config.
2. **The wall clock is only a safety stop**, checked at round boundaries. At the limit the
   search checkpoints, marks the run `INCOMPLETE_TIME_LIMIT`, reports best-so-far per seed and
   exits. An incomplete run is never a protocol result.
3. **Runs resume** from the checkpoint (cache, population, surrogate training set, seed state,
   round counter) and continue the same logical search.
4. **Cut order** if time runs short: seeds, then budget, then history length, then N. Record
   the cut in the protocol.
5. Longer runs before the freeze are development comparisons and cannot change the frozen
   budget, seeds or floors.

## Measured results (Nov 13 to 14, Ryzen 7 3700X, synthetic bars unless noted)

- **Account replay (C5 Numba kernel, 63 sessions after a 20-session warm-up, one thread):**
  0.025 s at N = 300, 0.041 s at 500, 0.049 s at 1,000; about 30 to 35 times the Python
  oracle with identical ledgers; about 10 times on 16 threads.
- **Per config-chunk with a prepared panel (25 sessions):** 8.9 ms at N = 300, 18.4 ms at
  1,000. Preparing once per chunk costs 88 ms and 285 ms. The first E1 runs prepared per config
  and per chunk, so **every time and weekend projection in the current `e1_table.md` is 10 to
  15 times too slow**; T2-2 replaces it.
- **Indicators:** one config's cold build on 300 stocks and 25 sessions is 1.65 s with Numba
  (20.8 s without). End to end, 8 and 16 threads were slower than 1 because NumPy indicator
  work holds the GIL, so parallelize across week chunks with processes.
- **Panel:** 38.8 KB per stock-week, 2.05 MB per stock-year (float32, five fields).
- **Week-chunk cache:** consecutive weeks reuse about 92% of (config, chunk) results.
- **Pilot pull (77 symbols, 2.25 years, SIP, paid plan):** 19.25M bars, 789 MB, 881 s, no
  429s, 6,901 bars per request, 41 bytes per row. Delisted names have minute bars back to
  2016; renamed tickers stop at the rename.

## Reusing work across runs and strategies (built in D6, D6b, D9)

Every trade closes the same session and sizing is a percentage of equity, so a config's
return on one session does not depend on other sessions apart from rounding and the liquidity
cap. Search and validation replays therefore use a fixed reference equity per session;
forward accounts carry real equity.

1. **Return paths per config and week chunk (D6).** An expanding window costs only the new
   week; the three policies, all seeds and later weekends share entries, because weights are
   not in the key. Selection at a cutoff never reads a chunk at or after it (guarded; E4 tests
   it).
2. **Mask-hash dedup (D6b).** Identical signal masks with identical account settings replay
   once; a `config_id` to `mask_hash` alias table keeps the audit trail.
3. **Chunk-major scheduling (D9).** Each panel chunk is opened and its indicators built once,
   then every strategy's candidates run against it.
4. **Persisted indicator arrays (B7)**, not built: only if T2-2 shows the indicator build
   dominates.

Reuse never crosses a change of universe or N, exits, sizing, costs or code version; those are
in the key.

## Widening the search space (grid v2, after the first run)

Only the five signal components are searched now (69,732 configs). Candidate additions:

| Dimension | Now | Proposed | Key |
|---|---|---|---|
| Breakout length n | {10, 20, 40, 60} | add 5, 15, 30, 90, 120 | `grid.breakout.n` |
| Breakout buffer b (ATR) | {0, 0.10, 0.25} | add 0.05, 0.15, 0.35, 0.50 | `grid.breakout.b` |
| ADX period, threshold | {7, 14, 21}, {15, 20, 25, 30} | add periods 10, 28; thresholds 10, 35, 40 | `grid.adx.*` |
| EMA fast, slow, d | {5, 8, 12}, {20, 35, 60}, {0, 0.10, 0.25} | add fast 3, 21; slow 90, 120; d 0.5 | `grid.ema.*` |
| RVOL window, v | {3, 5, 10}, {1, 1.5, 2} | add windows 15, 30; v 2.5, 3 | `grid.rvol.*` |
| VWAP band e | {1, 2, 3} | add 0.5, 1.5, 4 | `grid.vwap.e` |
| Initial stop, trail activation, trail distance (ATR) | 1.5, 1.0, 1.5 fixed | {1.0, 1.5, 2.0, 3.0}, {0.5, 1.0, 1.5, 2.0}, {1.0, 1.5, 2.0, 3.0} | `exit.*` |
| Max hold (minutes) | 60 fixed | {30, 60, 90, 120} | `exit.max_hold_minutes` |
| Max positions | 10 fixed | {5, 10, 15, 20} | `account.max_positions` |
| Entry window | none | earliest and latest entry minute | `signals.entry_window` |

Rules: a wider domain is a new `grid.version` (v1 stays the protocol); exits and account go
in a small **outer grid** around the normal search, not inside it; a bigger space puts more
weight on the surrogate, so E3 must show it helps; more dimensions mean more luck, so keep the
floors, report logical evaluations per finalist and prefer the center of a plateau.

## Where the code runs

| Piece | Where | Why |
|---|---|---|
| Indicators, signal rule, ranking, sizing, exits (decision logic) | **TypeScript in the platform**, matching Python on golden fixtures (P1-6 passes) | Strategies may not call external services |
| Account replay, search, surrogate, weights, bootstrap | **research-python (Numba)**, on HiPerGator | About 1,000 times faster than the platform backtest engine |
| Platform backtest engine | Cross-check of finalists only (T4-5) | Catches port bugs; too slow for search |
| Bars | Two separate stores (research Parquet, platform Supabase cache) | The only interfaces are the weekly artifact JSON and the golden fixtures |

**Several policies live:** the orchestrator handles many strategy instances, but there is one
paper account (shared cash), so one policy trades and the other two run as signal-only shadows
(P2-8). The free data plan may cap a stream at about 30 symbols; T4-1 measures it and picks the
live-universe option.

## Risks

- **Interim universe.** The 1,500 pool is screened at one as-of date (Nov 2025), so it is
  biased toward names alive then. A5 with point-in-time eligibility removes the bias; the
  static fallback must state it.
- **Feed.** Research uses SIP history; paper trading uses IEX quotes. Record the difference
  when comparing replay with paper results.
- **More search, more luck.** Keep validation floors and the deflated Sharpe check strict;
  report how many logical evaluations stood behind each finalist.
- **Spread and impact.** The weaker liquidity cells have wider spreads, so the 20 bps scenario
  matters.
