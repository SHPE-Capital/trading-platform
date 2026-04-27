-- ================================================================
-- Migration: 002_strategy_configs.sql
-- Description: Introduces a `strategies` table as the authoritative
--              store for strategy definitions and their configs.
--              Adds a foreign key from strategy_runs.strategy_id so
--              every run is traceable back to a saved strategy.
-- Depends on: 001_initial.sql
-- Run with:   Supabase migrations or psql
-- ================================================================

-- ----------------------------------------------------------------
-- strategies
-- Stores named, reusable strategy definitions. Each row represents
-- a configured strategy that can be launched into one or more runs.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS strategies (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    strategy_type  TEXT NOT NULL,
    name           TEXT NOT NULL,
    config         JSONB NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategies_strategy_type ON strategies (strategy_type);
CREATE INDEX IF NOT EXISTS idx_strategies_created_at    ON strategies (created_at DESC);

-- ----------------------------------------------------------------
-- FK: strategy_runs.strategy_id → strategies.id
--
-- NOT VALID skips row-level validation so the constraint can be
-- applied to an existing table without requiring a full scan.
-- Run VALIDATE CONSTRAINT after backfilling any pre-existing rows.
-- ----------------------------------------------------------------
ALTER TABLE strategy_runs
    ADD CONSTRAINT fk_strategy_runs_strategy_id
    FOREIGN KEY (strategy_id)
    REFERENCES strategies (id)
    ON DELETE RESTRICT
    NOT VALID;
