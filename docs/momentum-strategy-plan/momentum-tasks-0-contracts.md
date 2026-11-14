# Stream 0: Contracts and setup

Back to [MOMENTUM_TASKS.md](MOMENTUM_TASKS.md).

These are small, fast tasks that unblock everyone else. Each produces an
interface (types plus docstrings plus a stub or fixture), **not** the
implementation. Target: all merged by **Nov 14**. They can be done in parallel
by different people; the lead reviews all of them.

---

## 0-A Weekly configuration artifact schema

- **Repo:** research-python (source of truth), mirrored in trading-platform by P1-2
- **Owns:** `src/shpe_research/contracts/weekly_config.py`,
  `docs/contracts/weekly_config.v1.schema.json` (exported JSON Schema),
  `tests/unit/contracts/test_weekly_config.py`
- **Depends on:** nothing
- **Spec:** §1 "How the finding changes the program", §11 steps 5–6, App. B
  "Each weekly artifact records …"
- **Contents:** schema version; run ID; code commit; data version; policy
  (`uniform | recency | similarity`); decision cutoff; search and validation
  date ranges; activation week (start and end dates); universe (list of stable
  asset IDs plus symbols); selected configuration (config ID from 0-B plus the
  explicit filter subset and parameter values) **or** `no_deployment` with a
  reason; acceptance results; realized weight concentration (ESS); logical and
  actual evaluation counts; seeds; account and exit settings (so the platform
  never relies on its own defaults); runtime and memory.
- **Done when:** a pydantic model round-trips to and from JSON; the JSON Schema
  is exported by a script and checked in; one example `selected` artifact and
  one `no_deployment` artifact live under `tests/fixtures/weekly_config/`.

## 0-B Configuration grid and stable config ID

- **Repo:** research-python
- **Owns:** `src/shpe_research/strategies/momentum/breakout/grid.py` (interface
  plus the Appendix A domain as data), `tests/unit/strategies/momentum/test_grid.py`
- **Depends on:** nothing
- **Spec:** App. A (grid), §2 "Why five components", §10 (repair needs the
  domain)
- **Contents:** the domain as a versioned data structure (grid version string);
  a `Config` value type (subset plus parameters); `config_id(config)` as a stable
  hash independent of dict ordering; `enumerate_configs()`; `is_valid(config)`;
  a `feature_vector(config)` encoding with explicit inactive-component markers
  (used by D4).
- **Done when:** `len(list(enumerate_configs())) == 69_732`; 14 subsets; IDs are
  stable across Python sessions and platforms; the encoding round-trips.

## 0-C Account simulator I/O contract and the `calibration/` layer

- **Repo:** research-python
- **Owns:** `src/shpe_research/trade/account_types.py` (dataclasses only),
  `src/shpe_research/calibration/__init__.py` (empty package),
  `docs/adr/0013-weekly-calibration-layer.md`, import-linter entry in
  `pyproject.toml` (**Coordinate** with whoever owns C1l)
- **Depends on:** nothing
- **Spec:** §3 "Each completed minute", §4, §9, §12 "What is cached"
- **Contents:**
  - `MarketPanel`: per-week arrays (symbol × minute) for open, high, low,
    close and volume, plus session index and eligibility mask, with stable asset
    IDs. The format is designed so A6 can memory-map it.
  - `AccountConfig`: starting cash, max positions, per-stock percentage, total
    percentage, risk percentage, liquidity cap, exit package, cost scenario,
    fill model, daily halt.
  - `SignalMask`: boolean (symbol × minute) plus the ATR array at each minute.
  - `AccountResult`: daily net returns (every session, including zero-trade
    days), ledger, rejection log with reasons, flags (ambiguous bars,
    unresolved positions), summary metrics.
  - The function signature `simulate_account(panel, mask, cfg) -> AccountResult`
    as a stub that raises `NotImplementedError("TODO(MO-C4)")`.
  - The ADR records that `calibration/` sits above `trade/` and `strategies/`,
    and that for this strategy research defines the semantics and the platform
    ports them (an explicit exception to ADR 0009).
- **Done when:** types import cleanly, the ADR is merged, and `lint-imports`
  knows the new layer.

## 0-D Golden parity fixture format

- **Repo:** research-python (writer), trading-platform (reader)
- **Owns:** `docs/contracts/momentum_golden.md`, an empty example under
  `tests/fixtures/momentum_golden/`
- **Depends on:** nothing
- **Spec:** §12 "Strategy and portfolio core", §15 "A replay of recorded paper
  events must reproduce strategy decisions"
- **Contents:** a file layout both languages can read without extra libraries
  (JSON Lines or CSV, not Parquet): input bar events (first-seen values), the
  weekly config used, expected per-bar indicator values (with a tolerance per
  indicator), expected signals, expected ranked and sized orders given a
  scripted account state.
- **Done when:** both the P1 and B owners have approved the format.

## 0-E Merge the T1 trade simulator branch

- **Repo:** research-python
- **Owns:** merge of `juancavallin/T1` into `JC` (`trade/exits.py`,
  `trade/simulate.py`, tests)
- **Depends on:** nothing
- **Done when:** merged, `uv run pytest` and `uv run ruff check` pass, and the
  T1 row in `docs/tasks.md` is marked Done. While there, also refresh the
  stale statuses (C1f, C1h, C1i are merged but listed as Open).

## 0-F Scope decision and owner assignment

- **Repo:** docs (record the outcome in `studies/momentum/rm1-weekly-calibration/README.md`, created by E5)
- **Owner:** project lead
- **Depends on:** draft now, finalize after the first E1 benchmark (Nov 17)
- **Spec:** §13, §14 "If the forecast does not fit", §16
- **Decide and record:** N (300 or reduced through the same stratified
  procedure); analysis history (5 years or shorter, declared before
  evaluation); search budget per weekend (2,048 or less) and number of seeds;
  whether quote replay is in scope; the reserved-period boundary date; owner
  and reviewer per stream; compute host (AWS or HPC) with confirmed limits
  (from E6).
- **Done when:** the decision is written, dated, and linked from the index.
