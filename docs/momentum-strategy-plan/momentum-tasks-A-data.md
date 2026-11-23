# Stream A: Data and universe

Back to [MOMENTUM_TASKS.md](MOMENTUM_TASKS.md). Repo: **research-python**.
Owns the historical archive and the point-in-time weekly universe. No strategy
logic here.

Existing code to build on: `data/alpaca.py`, `data/store.py`, `data/bars.py`,
`data/calendar.py`, `data/audit.py`, `data/corporate_actions.py`,
`data/security_master.py`, `data/universe.py`, `data/ticks.py`.

---

## A1 Archive coverage audit and bulk pull

- **Owns:** `scripts/momentum/pull_archive.py` (or a `shpe data` subcommand),
  `docs/data/momentum_archive.md` (data manifest and limitations)
- **Depends on:** nothing (sizing follows 0-F; start with a two-year pilot)
- **Spec:** §6 "What the archive contains", §13 "The data arithmetic", App. B
- **Work:**
  - Measure what Alpaca actually provides: minute bars for **inactive and
    delisted** symbols, how far back, the SIP vs IEX entitlement on our keys,
    and rate limits. This is one of the guide's open items (§ "Remaining
    evidence").
  - Build the candidate pool: every US common stock that could have been
    eligible at any point in the analysis window, not just today's listings.
  - Pull minute bars for the pool plus **SPY** (descriptor only, never traded)
    plus warm-up history. Record row counts, coverage and checksums in the
    store manifest.
- **Scale (added 2026-11-13):** the pool is about 3 × N symbols (**N recommended
  500 to 1,000**) over **5 to 10 years**, both read from the protocol config.
  Pull in stages (pilot, 300 × 2 years, 500 × 5, then up to 1,000 × 10), make the
  pull resumable, and **measure the real rate limit and bars per request**; the
  16-hour estimate for 2 billion rows assumes 200 requests per minute and 10,000
  bars per request. Use the SIP feed for research history (the free plan blocks
  only the latest 15 minutes) and record the feed in the manifest.
- **Before the big pull:** `data/store.py` rewrites its whole JSON manifest every
  20 units, which does not scale to about 240,000 units. Shard the manifest by
  year or move it to SQLite (**Coordinate** with the store owner; keep checksums).
  Check free disk (this machine has about 86 GB; a 2,000-symbol, 10-year pool is
  at most about 43 GB).
- **Done when:** the manifest lists coverage per symbol and year, and the doc
  states plainly whether delisted coverage is sufficient. If it is not, the
  narrowed claim is written down (§6 last paragraph). The doc also records pull
  time, bytes on disk and the real rate limit at each stage.
- **Status (2026-11-13):** `scripts/momentum/pull_archive.py` (staged, resumable, SQLite
  manifest by symbol-month) and a **pilot pull** are done on research-python
  `momentum-e1-real`; results in `docs/data/momentum_archive.md`. **Paid-plan numbers** (the
  key is paid; the project plans to switch to the free plan, so re-measure rate limits and
  SIP access after the switch): 77 symbols, 19.25M bars, 789 MB, 881 s, no 429s, 6,901 bars
  per request, 41 bytes per row, SIP and IEX both 200. Extrapolation at 190 requests/min:
  300 x 2 about 3 h and 8 GB, 500 x 5 about 11 h and 32 GB, **1,000 x 10 about 44 h and
  126 GB**. Delisted names have minute bars back to 2016, but renamed tickers stop at the
  rename (A3 must supply stable IDs). The pilot's delisted names were chosen from memory;
  the real pool needs a point-in-time listing source.
- **Added requirement (2026-11-13):** convert pulled Parquet to float32 week-chunk panels
  (A6) per stage and delete the Parquet afterward, or pull on a host with at least 200 GB
  disk. Time the Parquet to panel conversion in E1; it has not been measured.

## A2 Missing-bar classification

- **Owns:** `src/shpe_research/data/audit.py` (extension; **Coordinate** with D2's original owner)
- **Depends on:** A1 for real data; start on synthetic data now
- **Spec:** §6 "Dollar volume … Missing bars need classification"
- **Work:** tell a genuine no-trade minute apart from a failed or missing
  download (compare with daily volume, neighboring minutes, refetch outcome).
  Never fill gaps silently.
- **Done when:** every audited symbol-session gets `complete | no_trade_gaps |
  download_gaps | invalid`, and A4 can query it.

## A3 Corporate actions and identity history

- **Owns:** `src/shpe_research/data/corporate_actions.py` (normalization
  extension), `src/shpe_research/data/identity.py` (new)
- **Depends on:** A1 for real data
- **Spec:** §6 "Store prices consistently across splits … Stable identity
  connects symbol changes"
- **Work:**
  - Store prices consistently across splits (and dividends if used) so that no
    future adjustment creates an artificial signal earlier in the data.
  - Give each security a stable asset ID that survives renames and ticker
    changes; use IPO or first-trade dates for history requirements.
  - Exclude periods with unresolved actions or unreliable identity, and record
    the reason.
- **Done when:** tests cover a split, a ticker change and a delisting, and the
  security master (`security_master.py`) carries the stable ID.

## A4 Weekly eligibility screen

- **Owns:** `src/shpe_research/data/eligibility.py` (new)
- **Depends on:** A2, A3 (stubs are fine to start)
- **Spec:** §6 "Eligibility before selection"
- **Rule at each weekly selection date, using only prior data:**
  - US exchange-listed common stock (exclude ETFs, OTC, preferreds, warrants)
  - at least 60 preceding sessions of usable history plus indicator warm-up
  - median daily dollar volume of at least **$10M** over the preceding 20
    sessions
  - at least **95%** of expected regular-session minute bars over those 20
    sessions (early closes counted correctly)
  - no invalid prices, unresolved corporate actions or unreliable identity
- **Done when:** the output for any date lists every candidate with its
  measurements and exclusion reason, and a future-bar tamper test shows that
  changing data after the date does not change the result.

## A5 Weekly universe schedule (3 × 3 cells, stable hash)

- **Owns:** `src/shpe_research/data/weekly_universe.py` (new; reuse helpers from
  `data/universe.py` without changing its existing behavior)
- **Depends on:** A4
- **Spec:** §6 "Choosing the working N stocks"
- **Work:**
  - 3 liquidity bands, then 3 volatility bands inside each. Volatility is the
    std of daily **percentage** returns over 20 sessions; the existing builder
    uses log returns.
  - Select about N ÷ 9 per cell by a **stable hash of asset ID plus a fixed
    seed** (persistent priority limits churn).
  - Undersized cells contribute all their stocks; the unused places go to the
    other cells in a fixed cell order.
  - Membership is fixed for the week, except for data or tradability
    suspensions.
  - Produce the schedule over the full analysis window as a versioned Parquet
    file with a checksum.
- **Configurable:** N, bands per axis, hash seed, and the eligibility thresholds
  come from the protocol config. Extend the existing config-driven
  `data/universe.py` instead of rewriting it. Test at N = 30, 300, 500 and 1,000.
- **Done when:** the schedule is reproducible bit for bit, shows week-to-week
  churn statistics, and includes delisted names in the weeks they were
  eligible.

## A6 Memory-mappable market panel loader

- **Owns:** `src/shpe_research/data/panel.py` (new)
- **Depends on:** 0-C (`MarketPanel` type)
- **Spec:** §12 "Avoid having each worker load its own full archive. Share
  read-only arrays or memory-map chunks", §13
- **Work:** given a date range and the universe schedule, build the
  `MarketPanel` arrays (float64 or float32 per the decision in C5) once, save
  them as `.npy` or Arrow, and let worker processes memory-map them read-only.
  Report build time and size.
- **At scale:** 1,000 stocks × 10 years of five float32 fields is about 20 GB, more
  than this machine's RAM, so build and map the panel **per week chunk** and let
  workers read only the windows they replay. N = 500 over 5 years is about 5 GB.
  Report RSS per worker.
- **Done when:** a 300-stock × 1-year panel loads in seconds in a worker
  without copying (verified by watching RSS), it matches the store values, and a
  1,000-stock week chunk loads without exceeding the host's RAM budget.
- **Status (2026-11-13):** `data/panel.py` and `scripts/momentum/make_synth_panel.py` are done
  (8 tests). Measured: 300 x 252 sessions builds in 4.0 s (0.62 GB) and maps in 3.0 s with
  2.5 MB RSS growth; 1,000 x 252 is 2.05 GB; one 1,000-stock week chunk is 41 MB; 2.05 MB per
  stock-year, so 1,000 x 10 is about 20.5 GB. The store loader is only tested on synthetic
  bars. `panel.py` resolves `MarketPanel` with `importlib` because `data` sits below `trade`;
  moving `MarketPanel` into `contracts` would be cleaner.

## A7 Market descriptor inputs

- **Owns:** `src/shpe_research/data/market_descriptors.py` (new; inputs only,
  D2 owns the scaling and the weights)
- **Depends on:** A1 (SPY), A4 (eligible set for breadth); start on fixtures
- **Spec:** §8 "Use three market descriptors"
- **Work:** per session, using data through the **preceding** session only:
  (1) 20-session SPY return divided by its volatility; (2) 20-session SPY daily
  return volatility; (3) fraction of historically eligible stocks above their
  20-session moving average. Provide a separate "current" row using data
  through the latest completed session.
- **Done when:** a daily descriptor table exists for the whole archive, with a
  test that shifting future data leaves past rows unchanged.
