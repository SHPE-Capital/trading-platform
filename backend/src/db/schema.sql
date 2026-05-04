-- ================================================================
-- schema.sql — READ ONLY
--
-- Canonical snapshot of the full database schema after all applied
-- migrations. Do not run this file directly; apply individual
-- migration files in order instead:
--
--   001_initial.sql
--   002_backtest_order_tables.sql
--   003_orders_is_paper.sql
--   004_strategy_configs.sql
--
-- Update this file whenever a new migration is applied.
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------
-- instruments
-- ----------------------------------------------------------------
CREATE TABLE instruments (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol       TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    asset_class  TEXT NOT NULL DEFAULT 'us_equity',
    exchange     TEXT,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_instruments_symbol    ON instruments (symbol);
CREATE INDEX idx_instruments_is_active ON instruments (is_active);

-- ----------------------------------------------------------------
-- strategies
-- version is incremented by the application on each config change.
-- The full config snapshot is always stored with each run/backtest
-- so history is preserved even though rows are mutable.
-- ----------------------------------------------------------------
CREATE TABLE strategies (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    strategy_type  TEXT        NOT NULL,
    version        INTEGER     NOT NULL DEFAULT 1,
    name           TEXT        NOT NULL,
    config         JSONB       NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_strategies_strategy_type ON strategies (strategy_type);
CREATE INDEX idx_strategies_created_at    ON strategies (created_at DESC);
CREATE INDEX idx_strategies_config        ON strategies USING GIN (config);

-- ----------------------------------------------------------------
-- strategy_runs
-- strategy_version snapshots the version active at launch time,
-- independent of any subsequent config edits to the strategy row.
-- ----------------------------------------------------------------
CREATE TABLE strategy_runs (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    strategy_id      UUID NOT NULL REFERENCES strategies (id) ON DELETE RESTRICT,
    strategy_version INTEGER,
    strategy_type    TEXT NOT NULL,
    name             TEXT NOT NULL,
    config           JSONB NOT NULL,
    status           TEXT NOT NULL DEFAULT 'idle',
    execution_mode   TEXT NOT NULL DEFAULT 'paper',
    started_at       TIMESTAMPTZ,
    stopped_at       TIMESTAMPTZ,
    total_signals    INTEGER       NOT NULL DEFAULT 0,
    total_orders     INTEGER       NOT NULL DEFAULT 0,
    realized_pnl     NUMERIC(18, 6) NOT NULL DEFAULT 0,
    meta             JSONB,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_strategy_runs_strategy_id ON strategy_runs (strategy_id);
CREATE INDEX idx_strategy_runs_status      ON strategy_runs (status);
CREATE INDEX idx_strategy_runs_started_at  ON strategy_runs (started_at DESC);

-- ----------------------------------------------------------------
-- orders
-- is_paper distinguishes paper-mode trades from live broker orders.
-- Defaults to true (fail-safe: untagged orders are treated as paper).
-- ----------------------------------------------------------------
CREATE TABLE orders (
    id               UUID PRIMARY KEY,
    broker_order_id  TEXT,
    intent_id        UUID          NOT NULL,
    strategy_id      TEXT          NOT NULL,
    symbol           TEXT          NOT NULL,
    side             TEXT          NOT NULL,
    qty              NUMERIC(18, 6) NOT NULL,
    filled_qty       NUMERIC(18, 6) NOT NULL DEFAULT 0,
    avg_fill_price   NUMERIC(18, 6),
    order_type       TEXT          NOT NULL,
    limit_price      NUMERIC(18, 6),
    stop_price       NUMERIC(18, 6),
    time_in_force    TEXT          NOT NULL,
    status           TEXT          NOT NULL,
    submitted_at     TIMESTAMPTZ   NOT NULL,
    updated_at       TIMESTAMPTZ   NOT NULL,
    closed_at        TIMESTAMPTZ,
    is_paper         BOOLEAN       NOT NULL DEFAULT true,
    meta             JSONB
);

CREATE INDEX idx_orders_strategy_id  ON orders (strategy_id);
CREATE INDEX idx_orders_symbol       ON orders (symbol);
CREATE INDEX idx_orders_status       ON orders (status);
CREATE INDEX idx_orders_submitted_at ON orders (submitted_at DESC);

-- ----------------------------------------------------------------
-- fills
-- is_paper mirrors the parent order's paper/live classification.
-- ----------------------------------------------------------------
CREATE TABLE fills (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id    UUID          NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    symbol      TEXT          NOT NULL,
    side        TEXT          NOT NULL,
    qty         NUMERIC(18, 6) NOT NULL,
    price       NUMERIC(18, 6) NOT NULL,
    notional    NUMERIC(18, 6) NOT NULL,
    commission  NUMERIC(18, 6) NOT NULL DEFAULT 0,
    ts          TIMESTAMPTZ   NOT NULL,
    exchange    TEXT,
    is_paper    BOOLEAN       NOT NULL DEFAULT true
);

CREATE INDEX idx_fills_order_id ON fills (order_id);
CREATE INDEX idx_fills_symbol   ON fills (symbol);
CREATE INDEX idx_fills_ts       ON fills (ts DESC);

-- ----------------------------------------------------------------
-- portfolio_snapshots
-- ----------------------------------------------------------------
CREATE TABLE portfolio_snapshots (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ts                    TIMESTAMPTZ    NOT NULL,
    cash                  NUMERIC(18, 6) NOT NULL,
    positions_value       NUMERIC(18, 6) NOT NULL,
    equity                NUMERIC(18, 6) NOT NULL,
    initial_capital       NUMERIC(18, 6) NOT NULL,
    total_unrealized_pnl  NUMERIC(18, 6) NOT NULL,
    total_realized_pnl    NUMERIC(18, 6) NOT NULL,
    total_pnl             NUMERIC(18, 6) NOT NULL,
    return_pct            NUMERIC(18, 8) NOT NULL,
    positions             JSONB          NOT NULL DEFAULT '[]',
    position_count        INTEGER        NOT NULL DEFAULT 0,
    strategy_run_id       UUID REFERENCES strategy_runs (id) ON DELETE SET NULL
);

CREATE INDEX idx_portfolio_snapshots_ts              ON portfolio_snapshots (ts DESC);
CREATE INDEX idx_portfolio_snapshots_strategy_run_id ON portfolio_snapshots (strategy_run_id);

-- ----------------------------------------------------------------
-- backtest_results
-- strategy_id links to the strategy definition that was tested.
-- strategy_version snapshots the version at the time of the run.
-- Both are nullable so pre-migration rows are not invalidated.
-- ----------------------------------------------------------------
CREATE TABLE backtest_results (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    strategy_id      UUID REFERENCES strategies (id) ON DELETE SET NULL,
    strategy_version INTEGER,
    config           JSONB       NOT NULL,
    status           TEXT        NOT NULL DEFAULT 'pending',
    started_at       TIMESTAMPTZ NOT NULL,
    completed_at     TIMESTAMPTZ,
    error_message    TEXT,
    final_portfolio  JSONB,
    metrics          JSONB,
    equity_curve     JSONB,
    event_count      INTEGER     NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_backtest_results_status     ON backtest_results (status);
CREATE INDEX idx_backtest_results_started_at ON backtest_results (started_at DESC);
CREATE INDEX idx_backtest_results_strategy   ON backtest_results (strategy_id, strategy_version);

-- ----------------------------------------------------------------
-- backtest_orders
-- Dedicated table for orders placed during a backtest simulation.
-- Kept separate from the live/paper orders table to avoid pollution.
-- ----------------------------------------------------------------
CREATE TABLE backtest_orders (
    id             UUID PRIMARY KEY,
    backtest_id    UUID          NOT NULL REFERENCES backtest_results (id) ON DELETE CASCADE,
    strategy_id    TEXT          NOT NULL,
    symbol         TEXT          NOT NULL,
    side           TEXT          NOT NULL,
    qty            NUMERIC(18, 6) NOT NULL,
    filled_qty     NUMERIC(18, 6) NOT NULL DEFAULT 0,
    avg_fill_price NUMERIC(18, 6),
    order_type     TEXT          NOT NULL,
    limit_price    NUMERIC(18, 6),
    stop_price     NUMERIC(18, 6),
    status         TEXT          NOT NULL,
    submitted_at   TIMESTAMPTZ   NOT NULL,
    closed_at      TIMESTAMPTZ
);

CREATE INDEX idx_backtest_orders_backtest_id ON backtest_orders (backtest_id);

-- ----------------------------------------------------------------
-- backtest_fills
-- ----------------------------------------------------------------
CREATE TABLE backtest_fills (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    backtest_id UUID          NOT NULL REFERENCES backtest_results (id) ON DELETE CASCADE,
    order_id    UUID          NOT NULL REFERENCES backtest_orders (id) ON DELETE CASCADE,
    symbol      TEXT          NOT NULL,
    side        TEXT          NOT NULL,
    qty         NUMERIC(18, 6) NOT NULL,
    price       NUMERIC(18, 6) NOT NULL,
    notional    NUMERIC(18, 6) NOT NULL,
    commission  NUMERIC(18, 6) NOT NULL DEFAULT 0,
    ts          TIMESTAMPTZ   NOT NULL
);

CREATE INDEX idx_backtest_fills_backtest_id ON backtest_fills (backtest_id);
CREATE INDEX idx_backtest_fills_order_id    ON backtest_fills (order_id);

-- ----------------------------------------------------------------
-- event_logs
-- ----------------------------------------------------------------
CREATE TABLE event_logs (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name         TEXT        NOT NULL,
    description  TEXT,
    source       TEXT        NOT NULL,
    run_id       UUID,
    event_count  INTEGER     NOT NULL DEFAULT 0,
    events       JSONB       NOT NULL DEFAULT '[]',
    start_date   TIMESTAMPTZ NOT NULL,
    end_date     TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_event_logs_run_id     ON event_logs (run_id);
CREATE INDEX idx_event_logs_created_at ON event_logs (created_at DESC);
