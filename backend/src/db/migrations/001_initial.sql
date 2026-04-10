-- ================================================================
-- Migration: 001_initial.sql
-- Description: Initial schema for the trading platform.
--              Creates all core tables with appropriate constraints,
--              indexes, and foreign keys.
-- Run with: Supabase migrations or psql
-- ================================================================

-- Enable UUID generation extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------
-- instruments
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS instruments (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol       TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    asset_class  TEXT NOT NULL DEFAULT 'us_equity',
    exchange     TEXT,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_instruments_symbol ON instruments (symbol);
CREATE INDEX IF NOT EXISTS idx_instruments_is_active ON instruments (is_active);

-- ----------------------------------------------------------------
-- strategy_runs
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS strategy_runs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    strategy_id     UUID NOT NULL,
    strategy_type   TEXT NOT NULL,
    name            TEXT NOT NULL,
    config          JSONB NOT NULL,
    status          TEXT NOT NULL DEFAULT 'idle',
    execution_mode  TEXT NOT NULL DEFAULT 'paper',
    started_at      TIMESTAMPTZ,
    stopped_at      TIMESTAMPTZ,
    total_signals   INTEGER NOT NULL DEFAULT 0,
    total_orders    INTEGER NOT NULL DEFAULT 0,
    realized_pnl    NUMERIC(18, 6) NOT NULL DEFAULT 0,
    meta            JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategy_runs_strategy_id ON strategy_runs (strategy_id);
CREATE INDEX IF NOT EXISTS idx_strategy_runs_status ON strategy_runs (status);
CREATE INDEX IF NOT EXISTS idx_strategy_runs_started_at ON strategy_runs (started_at DESC);

-- ----------------------------------------------------------------
-- orders
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id                UUID PRIMARY KEY,
    broker_order_id   TEXT,
    intent_id         UUID NOT NULL,
    strategy_id       TEXT NOT NULL,
    symbol            TEXT NOT NULL,
    side              TEXT NOT NULL,
    qty               NUMERIC(18, 6) NOT NULL,
    filled_qty        NUMERIC(18, 6) NOT NULL DEFAULT 0,
    avg_fill_price    NUMERIC(18, 6),
    order_type        TEXT NOT NULL,
    limit_price       NUMERIC(18, 6),
    stop_price        NUMERIC(18, 6),
    time_in_force     TEXT NOT NULL,
    status            TEXT NOT NULL,
    submitted_at      TIMESTAMPTZ NOT NULL,
    updated_at        TIMESTAMPTZ NOT NULL,
    closed_at         TIMESTAMPTZ,
    meta              JSONB
);

CREATE INDEX IF NOT EXISTS idx_orders_strategy_id ON orders (strategy_id);
CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders (symbol);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_submitted_at ON orders (submitted_at DESC);

-- ----------------------------------------------------------------
-- fills
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fills (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    symbol      TEXT NOT NULL,
    side        TEXT NOT NULL,
    qty         NUMERIC(18, 6) NOT NULL,
    price       NUMERIC(18, 6) NOT NULL,
    notional    NUMERIC(18, 6) NOT NULL,
    commission  NUMERIC(18, 6) NOT NULL DEFAULT 0,
    ts          TIMESTAMPTZ NOT NULL,
    exchange    TEXT
);

CREATE INDEX IF NOT EXISTS idx_fills_order_id ON fills (order_id);
CREATE INDEX IF NOT EXISTS idx_fills_symbol ON fills (symbol);
CREATE INDEX IF NOT EXISTS idx_fills_ts ON fills (ts DESC);

-- ----------------------------------------------------------------
-- portfolio_snapshots
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ts                    TIMESTAMPTZ NOT NULL,
    cash                  NUMERIC(18, 6) NOT NULL,
    positions_value       NUMERIC(18, 6) NOT NULL,
    equity                NUMERIC(18, 6) NOT NULL,
    initial_capital       NUMERIC(18, 6) NOT NULL,
    total_unrealized_pnl  NUMERIC(18, 6) NOT NULL,
    total_realized_pnl    NUMERIC(18, 6) NOT NULL,
    total_pnl             NUMERIC(18, 6) NOT NULL,
    return_pct            NUMERIC(18, 8) NOT NULL,
    positions             JSONB NOT NULL DEFAULT '[]',
    position_count        INTEGER NOT NULL DEFAULT 0,
    strategy_run_id       UUID REFERENCES strategy_runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_ts ON portfolio_snapshots (ts DESC);
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_strategy_run_id ON portfolio_snapshots (strategy_run_id);

-- ----------------------------------------------------------------
-- backtest_results
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS backtest_results (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    config            JSONB NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pending',
    started_at        TIMESTAMPTZ NOT NULL,
    completed_at      TIMESTAMPTZ,
    error_message     TEXT,
    final_portfolio   JSONB,
    metrics           JSONB,
    equity_curve      JSONB,
    orders            JSONB,
    fills             JSONB,
    event_count       INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backtest_results_status ON backtest_results (status);
CREATE INDEX IF NOT EXISTS idx_backtest_results_started_at ON backtest_results (started_at DESC);

-- ----------------------------------------------------------------
-- event_logs
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_logs (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name         TEXT NOT NULL,
    description  TEXT,
    source       TEXT NOT NULL,
    run_id       UUID,
    event_count  INTEGER NOT NULL DEFAULT 0,
    events       JSONB NOT NULL DEFAULT '[]',
    start_date   TIMESTAMPTZ NOT NULL,
    end_date     TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_logs_run_id ON event_logs (run_id);
CREATE INDEX IF NOT EXISTS idx_event_logs_created_at ON event_logs (created_at DESC);
