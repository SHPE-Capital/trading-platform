# Agent brief: contracts and setup (stream 0)

Suggested agent: `feature-implementer`, **one agent for all of 0-A to 0-D and 0-G** (they interlock). Owner: Person 2. Repo: **research-python**.
Full packets: [../../momentum-tasks-0-contracts.md](../../momentum-tasks-0-contracts.md).

Follow the shared rules in [../README.md](../README.md): one task, one branch, one worktree (`<name>/MO-<ID>`); exclusive Owns lists; stage your own files by path (no `git stash`, no `git add -A`); every tunable comes from the protocol config (0-G); never claim a check passed without seeing it run. End with: what changed (files), verification and results, unresolved risks.

## Goal
Small, fast interfaces that unblock every other stream. Types, docstrings, a stub or fixture; not implementations. All merged by **Nov 14**; the lead reviews all of them.

## Tasks
- **0-C** `trade/account_types.py` (`MarketPanel`, `AccountConfig`, `SignalMask`, `AccountResult`), an empty `calibration/` package, ADR 0013, the import-linter entry, and a stub `simulate_account` raising `NotImplementedError("TODO(MO-C4)")`. `AccountConfig` includes the ranking function name, optional entry-score threshold, size-multiplier input and a search-replay reference equity (defaults reproduce the guide).
- **0-A** `contracts/weekly_config.py`, the exported JSON Schema, and example selected and `no_deployment` artifacts.
- **0-B** `strategies/momentum/breakout/grid.py`: versioned domain loaded from config, `Config`, `config_id`, `enumerate_configs` (69,732 for the default grid, 14 subsets), `is_valid`, `feature_vector`.
- **0-G** `config/momentum.py` (`MomentumProtocol`, `extra="forbid"`, content hash, `--set` overrides refused when frozen) and `configs/momentum/protocol.default.yaml`. Parameter list: [../../momentum-config-reference.md](../../momentum-config-reference.md).
- **0-D** `docs/contracts/momentum_golden.md`: JSON Lines or CSV (not Parquet) layout both languages read; Person 1 approves.
- **0-E** (git work, not an agent job) merge `juancavallin/T1`; check which of T1 and T4 actually exist.

## Needs approval
The `calibration/` layer ADR. Ask before changing `contracts/`.

## Verify
`uv run pytest`, `uv run ruff check`, `lint-imports`.
