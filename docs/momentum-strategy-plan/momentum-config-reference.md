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

### Size and time estimates (proxy-based, replace with E1 numbers)

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
