-- ================================================================
-- Migration: 005_drop_strategies_version.sql
-- Description:
--   1. Drops the `version` column from the `strategies` table.
--   2. Drops the `name` column from the `strategy_runs` table.
--
-- Rationale for (1): `strategies.version` was a stale snapshot of the
-- algorithm version at config creation time. It required manual migration
-- every time the strategy algorithm changed and drifted out of sync with the
-- actual class VERSION constant (PairsStrategy.VERSION). The algorithm version
-- is now derived at runtime from the strategy class.
--
-- Rationale for (2): `strategy_runs.name` duplicated the strategy config name.
-- When a config was renamed the run rows went stale. The backend now resolves
-- the run name by joining strategy_runs → strategies at read time, so the
-- column is redundant. strategy_runs.strategy_id already carries the FK link.
--
-- Note: strategy_runs.strategy_version and backtest_results.strategy_version
-- are intentionally preserved — those columns record which algorithm version
-- executed a specific run or backtest, which is a meaningful historical fact.
--
-- Depends on: 004_strategy_configs.sql
-- ================================================================

ALTER TABLE strategies    DROP COLUMN IF EXISTS version;
ALTER TABLE strategy_runs DROP COLUMN IF EXISTS name;
