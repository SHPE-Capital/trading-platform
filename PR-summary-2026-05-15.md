# PR Summary: Changes Since May 15, 2026

## Overview
This document summarizes the post-merge work completed from May 15, 2026 onward. The changes span backend strategy/versioning improvements, backtest streaming and deduplication, frontend UX fixes, database refactors, logging, and test updates.

## Key changes

- **Strategy versioning and cointegration**
  - Replaced the R² gate with the Engle-Granger cointegration test for strategy selection and bumped strategy versioning to v3.
  - Introduced a single source of truth for `algorithmVersion` from the strategy class constant.
  - Added a version field to `IStrategy` and bumped `PairsStrategy` to v2.

- **Backend and OMS refactor**
  - Derived strategy run names from the strategies table using an app-level join for more consistent naming.
  - Removed a dead `OrderManagerService` code path and added kill-switch protections.
  - Updated the backend to silence verbose per-order loggers in execution and capital reservation flows.

- **Backtest & streaming improvements**
  - Added an async streaming backtest engine with safe-horizon windowing and per-timestamp batching.
  - Added an SSE stream manager with a relay and typed complete payloads.
  - Updated the test suite for streaming engine and backtest deduplication refactor.
  - Fixed backtest dedup race conditions, derived strategy version from class metadata, and added DB search logging.

- **Frontend updates**
  - Show algorithm version badges and fix strategy form layout.
  - Cap progress bar display at 99% and fetch result by canonical ID when SSE completes.
  - Replace slippage with spread buffer in the frontend and move that option to the risk config section.

- **Risk and order management fixes**
  - Resolved four risk engine bugs and added a preflight check.
  - Removed `slippageBps` and simplified the risk configuration.
  - Fixed run name resolution for single-run lookups and corrected stale test fixtures.

- **Tests and documentation**
  - Updated tests for OMS consolidation, risk engine refactors, and strategy/run handling.
  - Updated backend environment documentation in `.env` example.

## Commit summary

- `8ea6f09` feat(strategy): replace R² gate with Engle-Granger cointegration test; bump to v3; fix 3 bugs
- `479e85b` fix(strategy): resolve run name for single-run lookups; fix stale test fixtures
- `60feae2` refactor(db): derive strategy run name from strategies table via app-level join
- `bed30f8` feat(ui): show algorithm version badges and fix strategy form layout
- `37700d4` refactor(strategy): make algorithmVersion single source of truth from class constant
- `d56337e` test: update test suite for streaming engine and backtest dedup refactor
- `ef9957a` refactor: silence per-order verbose loggers in execution and capital reservation
- `d9102d7` fix(frontend): cap progress bar at 99%, fetch result by canonical ID on SSE complete
- `d97e798` fix(backtest): resolve dedup race, derive strategy version from class, add DB search logging
- `90dbbef` feat(backtest): SSE stream manager with relay and typed complete payload
- `63cf090` feat(backtest): async streaming engine with safe-horizon window and per-timestamp batching
- `ade708c` feat(frontend): replace slippage with spread buffer, move to risk config section
- `5c4a9cb` feat(strategy): add version field to IStrategy, bump PairsStrategy to v2
- `9e403f3` refactor(oms): remove dead OrderManagerService path, add kill switch protections
- `1f04006` fix(risk): resolve four risk engine bugs, add preflight check, remove slippageBps
- `34e7e28` test: update test suite for OMS consolidation and risk engine refactors
- `0c84341` doc: updated backend .env
