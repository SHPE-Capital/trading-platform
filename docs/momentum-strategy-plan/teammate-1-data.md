# Teammate 1: Data and universe

Back to [README.md](README.md). Repo: **research-python**. Paths below are under
`src/shpe_research/` unless they start with `scripts/`, `tests/`, `configs/` or `docs/`.

Goal: replace the calibrator's stand-ins with real, point-in-time data on HiPerGator by
**Nov 20**. The calibrator already accepts the two interfaces you implement:
`calibration/universe.py` (`UniverseProvider`) and `calibration/descriptors.py`
(`DescriptorProvider`). No strategy logic here.

Existing code to build on: `data/alpaca.py`, `data/store.py`, `data/bars.py`,
`data/calendar.py`, `data/audit.py`, `data/corporate_actions.py`, `data/security_master.py`,
`data/universe.py` (config-driven 3 × 3 builder), `data/panel.py`.

HiPerGator: everything lives under `/blue/dream_team/$USER/momentum` (`research-python/`,
`store/`, `universe_1500/`, `logs/`); the conda env is `/blue/dream_team/$USER/envs/momentum`.
Job scripts are in `scripts/momentum/hpg/`; general setup is in `Neurospine/docs/hipergator.md`.

**Fallback.** If T1-3 to T1-6 cannot land by Nov 20, the lead freezes with a static universe
from the interim pool and states the survivor bias (see decision 2 in the README). T1-1, T1-2
and T1-7 are needed either way.

---

## T1-1 Audit the 500 × 5 pull (closes A1)

- **Owns:** `docs/data/momentum_archive.md` (new 500 × 5 section)
- **Depends on:** nothing (the pull finished Nov 18)
- **Work:** from the store's SQLite manifest, report coverage per symbol and year, rows,
  bytes on disk, wall time, 429 count, bars per request and the real request rate. Record the
  plan the key is on (the pilot numbers were paid-plan) and the feed (SIP). List symbols with
  gaps or no data, and state plainly how many delisted names have usable history. Confirm the
  date range actually pulled (script default end 2025-10-31) and that SPY is present.
- **Done when:** the doc has the 500 × 5 numbers and the gap list, and the lead has the
  date range for the reserved-period decision.

## T1-2 Build panels from the store on HPG

- **Owns:** `scripts/momentum/build_panel.py` (CLI over `data.panel.build_from_store`),
  `scripts/momentum/hpg/build_panel.sbatch`, tests for the CLI
- **Depends on:** T1-1
- **Spec:** §12 "Share read-only arrays or memory-map chunks", §13
- **Work:** build float32 week-chunk panels for **all pool symbols** (the weekly universe
  is a subset chosen later) over the full window, on `/blue`. Keep the Parquet (group storage
  has room). Time the Parquet-to-panel conversion (E1 needs it) and record the size.
- **Done when:** panel chunks exist for the full window, spot checks match store values, and
  build time and bytes are in `docs/data/momentum_archive.md`. Tell Teammate 2 the path.

## T1-3 Missing-bar classification (A2)

- **Owns:** extension of `data/audit.py`, tests
- **Depends on:** T1-1 for real data; synthetic data to start
- **Spec:** §6 "Missing bars need classification"
- **Work:** tell a genuine no-trade minute from a failed or missing download (compare with
  daily volume, neighboring minutes, refetch outcome). Never fill gaps silently.
- **Done when:** every audited symbol-session is `complete | no_trade_gaps | download_gaps |
  invalid`, queryable by T1-5.

## T1-4 Corporate actions and stable identity (A3)

- **Owns:** extension of `data/corporate_actions.py`, `data/identity.py` (new), tests
- **Depends on:** T1-1
- **Spec:** §6 "Store prices consistently across splits … Stable identity connects symbol
  changes"
- **Work:** prices consistent across splits (and dividends if used) so no later adjustment
  creates an earlier artificial signal; a stable asset ID that survives renames and ticker
  changes (the pilot showed renamed tickers stop at the rename); IPO or first-trade dates for
  history requirements; exclude periods with unresolved actions or unreliable identity, with
  the reason.
- **Done when:** tests cover a split, a ticker change and a delisting, and
  `security_master.py` carries the stable ID.

## T1-5 Weekly eligibility screen (A4)

- **Owns:** `data/eligibility.py` (new), tests
- **Depends on:** T1-3, T1-4 (stubs to start)
- **Spec:** §6 "Eligibility before selection"
- **Rule at each weekly selection date, using only prior data:** US exchange-listed common
  stock (no ETFs, OTC, preferreds, warrants); at least 60 preceding sessions of usable history
  plus indicator warm-up; median daily dollar volume of at least $10M over the preceding 20
  sessions; at least 95% of expected regular-session minute bars over those 20 sessions
  (early closes counted correctly); no invalid prices, unresolved corporate actions or
  unreliable identity. Thresholds come from the protocol config (send the field list to
  Teammate 2, who owns `config/momentum.py`).
- **Done when:** the output for any date lists every candidate with its measurements and
  exclusion reason, and a future-bar tamper test shows later data does not change it.

## T1-6 Weekly universe schedule (A5) and its provider

- **Owns:** `data/weekly_universe.py` (new; reuse helpers from `data/universe.py` without
  changing its behavior), a `WeeklyUniverseProvider` in a new module next to it, tests
- **Depends on:** T1-5
- **Spec:** §6 "Choosing the working N stocks"
- **Work:** 3 liquidity bands, then 3 volatility bands inside each (volatility = std of daily
  **percentage** returns over 20 sessions; the existing builder uses log returns). About N ÷ 9
  per cell by a stable hash of asset ID plus a fixed seed. Undersized cells give all their
  stocks; spare places go to the other cells in a fixed order. Membership is fixed for the week
  except for data or tradability suspensions. Write the schedule as a versioned Parquet file
  with a checksum. The provider implements `calibration.universe.UniverseProvider` (picklable,
  `version` goes into every cache key) and replaces `StaticUniverseProvider`.
- **Done when:** the schedule is reproducible bit for bit at N = 500 from the 1,500 pool,
  reports week-to-week churn, includes delisted names in the weeks they were eligible, and
  `shpe momentum calibrate` runs with the new provider.

## T1-7 Market descriptors (A7) and their provider

- **Owns:** `data/market_descriptors.py` (new; inputs only, `calibration/descriptor_scaling.py`
  owns scaling), a provider implementing `calibration.descriptors.DescriptorProvider`, tests
- **Depends on:** T1-1 (SPY); T1-5 for true breadth (use the pool to start)
- **Spec:** §8 "Use three market descriptors"
- **Work:** per session, from data through the **preceding** session: (1) 20-session SPY
  return divided by its volatility; (2) 20-session SPY daily-return volatility; (3) fraction of
  eligible stocks above their 20-session moving average. A separate `current(cutoff)` row uses
  data through the cutoff. Replaces `PanelProxyDescriptors`.
- **Done when:** a daily descriptor table covers the archive, a test shows shifting future
  data leaves past rows unchanged, and the calibrator runs with the real provider.
