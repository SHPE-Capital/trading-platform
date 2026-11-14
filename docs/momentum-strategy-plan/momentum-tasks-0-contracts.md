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
- **Configurable:** the domain is loaded from the protocol config (0-G) with a
  `grid.version`; the Appendix A domain is the default. Widening the grid is a new
  grid version, never an edit in place, and the config ID includes the version.
- **Done when:** `len(list(enumerate_configs())) == 69_732` for the default grid;
  14 subsets; IDs are stable across Python sessions and platforms; the encoding
  round-trips; a different domain from config enumerates correctly.
- **Status (2026-11-13):** built on research-python `momentum-e1-real` (`grid.py`, 10 tests
  with the types). The guide's Appendix A was not available, so the **subset rule is
  inferred**: breakout always active plus 1 to 3 of ADX, EMA, RVOL, VWAP, all five
  excluded. It is the only rule that gives 14 subsets and exactly 69,732 configs, but ADX
  as the anchor fits the count equally well. **Person 2 must confirm against Appendix A**;
  correcting it is a new grid version. Config ID is 16 hex of SHA-256 over canonical JSON;
  the domain is loaded from a mapping until 0-G exists.

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
    fill model, daily halt, **ranking function name, optional entry-score
    threshold, optional size multiplier input and a search-replay reference
    equity** (the defaults reproduce the guide exactly; they are the seams for
    [stream F](momentum-tasks-F-later-ideas.md)). Built from the 0-G config.
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
- **Status (2026-11-13):** types, `calibration/` package, ADR 0013 (status Proposed, needs
  merge approval) and the `calibration` layer in `pyproject.toml` are on `momentum-e1-real`;
  `lint-imports` passes. `simulate_account` is now implemented (C4); the wrapper in
  `account_types.py` does not take `warmup_sessions` (see C4).

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
- **Status (2026-11-13): the branch `juancavallin/T1` does not exist locally or on origin
  of research-python** (only `main`, `JC`, `momentum-e1-bench`/`real`). A minimal T1 was
  **rebuilt**: `trade/exits.py` (`StopState`, `step_stop`) and `trade/exit_package.py`
  (C2). `simulate_trades` in `trade/simulate.py` is still the stub and the `docs/tasks.md`
  refresh was not done. If the real branch turns up, reconcile it with the rebuild.

## 0-F Scope decision and owner assignment

- **Repo:** docs (record the outcome in `studies/momentum/rm9-weekly-calibration/README.md`, created by E5)
- **Owner:** project lead
- **Depends on:** draft now, finalize after the first E1 benchmark (Nov 17)
- **Spec:** §13, §14 "If the forecast does not fit", §16
- **Decide and record:** N (**recommended 500, stretch 1,000**; 300 or reduced
  through the same stratified procedure is the fallback); analysis history
  (**recommended 5 to 10 years**, declared before evaluation; shorter is the
  fallback); the stage plan from [momentum-config-reference.md](momentum-config-reference.md)
  (pilot, 300 × 2, 500 × 5, 1,000 × 10) and the gate for each; search budget per
  weekend (2,048 protocol; the guide allows less) and number of seeds;
  finalists per seed; whether quote replay is in scope; the reserved-period
  boundary date; whether this program shares the ORB exit, cost and sizing
  studies (RM3, RM5, RM7) or replaces them; owner and reviewer per stream; compute
  host (AWS or HPC) with confirmed limits (from E6).
- **Inputs:** E1 numbers (time, RAM and disk per N and years), A1 coverage
  (including delisted names and the feed), E6.
- **Done when:** the decision is written, dated, and linked from the index, and
  each chosen value is entered in the protocol config (0-G).
- **Decision so far (lead, 2026-11-13):** final scope **N = 1,000 over 10 years**, with the
  staged gates kept. Measured needs (about 44 h and 126 GB pull, about 20.5 GB panel,
  workers limited by RAM) mean it requires a compute host with at least 200 GB disk and
  32 GB RAM, or the 500 × 5 fallback. Still open: the host, the reserved-period date,
  whether quote replay is in scope, and whether the ORB studies are shared. Record the host
  and the date here when decided.

## 0-G Protocol configuration

- **Repo:** research-python
- **Owns:** `src/shpe_research/config/momentum.py` (pydantic `MomentumProtocol`),
  `configs/momentum/protocol.default.yaml`, `tests/unit/config/test_momentum_config.py`
- **Depends on:** nothing (fields are added as each stream defines them; 0-C
  `AccountConfig` and 0-A artifact fields reference it)
- **Spec:** the parameter table in [momentum-config-reference.md](momentum-config-reference.md),
  guide §7 and §11 (freeze), ADR 0008 (typed configs)
- **Work:** one typed model with a section per area (universe, data, eligibility,
  grid, signals, fill, costs, exit, account, weights, score, search, surrogate,
  validation, acceptance, bootstrap, quote replay, compute). `extra="forbid"`,
  defaults equal to the guide's provisional values, a resolved-config content
  hash (used by E5), CLI `--set key=value` overrides that are recorded in the
  artifact and refused when `frozen=true`. Other streams read their numbers from
  this model; they do not define their own constants.
- **Done when:** the default YAML round-trips; a misspelled key fails; changing any
  single field changes the hash; N, years, budget, seeds, finalists per seed,
  validation sessions, cost scenarios and every account cap can be changed from
  the YAML with no code edit (tests for each); the artifact (0-A) stores the
  resolved config.
