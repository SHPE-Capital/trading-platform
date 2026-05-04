-- ================================================================
-- Migration: 004_strategy_configs.sql
-- Description: Introduces the strategies table for storing named,
--              versioned strategy configs. version tracks the algorithm
--              version (set from hardcoded STRATEGY_DEFINITIONS at creation
--              time), not a per-edit counter — updated_at tracks edits.
--              Also adds strategy_version to strategy_runs (snapshot of the
--              algorithm version at launch time) and links backtest_results
--              back to the originating strategy definition via FK + version.
-- Depends on: 001_initial.sql, 002_backtest_order_tables.sql,
--             003_orders_is_paper.sql
-- ================================================================

-- ----------------------------------------------------------------
-- strategies: named, versioned strategy configs
--
-- version reflects the algorithm version at the time the config was
-- created (sourced from STRATEGY_DEFINITIONS in strategyDefaults.ts),
-- NOT an edit counter. updated_at tracks the last config edit.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS strategies (
    id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    strategy_type  TEXT        NOT NULL,
    version        INTEGER     NOT NULL DEFAULT 1,
    name           TEXT        NOT NULL,
    config         JSONB       NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategies_strategy_type ON strategies (strategy_type);
CREATE INDEX IF NOT EXISTS idx_strategies_created_at    ON strategies (created_at DESC);

-- GIN index enables efficient JSONB querying on strategy config fields
-- (e.g. find all configs with a given symbol, parameter range, etc.)
CREATE INDEX IF NOT EXISTS idx_strategies_config ON strategies USING GIN (config);

-- ----------------------------------------------------------------
-- strategy_runs: snapshot the algorithm version active at launch time
--
-- strategy_id FK already exists from 001_initial.sql.
-- strategy_version records which algorithm version was in use when the
-- run started, preserved independently of any later config edits.
-- ----------------------------------------------------------------
ALTER TABLE strategy_runs
    ADD COLUMN IF NOT EXISTS strategy_version INTEGER;

-- ----------------------------------------------------------------
-- backtest_results: link to the strategy definition that was tested
--
-- Both columns are nullable so pre-migration rows are not invalidated.
-- strategy_id is the FK to the strategies row used for the backtest.
-- strategy_version snapshots the algorithm version at backtest time.
-- ----------------------------------------------------------------
ALTER TABLE backtest_results
    ADD COLUMN IF NOT EXISTS strategy_id      UUID REFERENCES strategies (id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS strategy_version INTEGER;

-- Composite index supports the primary query pattern:
-- "find all backtests run against strategy X at algorithm version N"
CREATE INDEX IF NOT EXISTS idx_backtest_results_strategy
    ON backtest_results (strategy_id, strategy_version);
