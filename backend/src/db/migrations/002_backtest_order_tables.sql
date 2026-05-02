-- 002_backtest_order_tables.sql
-- Dedicated tables for backtest orders and fills.
-- Keeps the live/paper orders and fills tables clean.

CREATE TABLE backtest_orders (
    id             UUID PRIMARY KEY,
    backtest_id    UUID NOT NULL REFERENCES backtest_results(id) ON DELETE CASCADE,
    strategy_id    TEXT NOT NULL,
    symbol         TEXT NOT NULL,
    side           TEXT NOT NULL,
    qty            NUMERIC(18, 6) NOT NULL,
    filled_qty     NUMERIC(18, 6) NOT NULL DEFAULT 0,
    avg_fill_price NUMERIC(18, 6),
    order_type     TEXT NOT NULL,
    limit_price    NUMERIC(18, 6),
    stop_price     NUMERIC(18, 6),
    status         TEXT NOT NULL,
    submitted_at   TIMESTAMPTZ NOT NULL,
    closed_at      TIMESTAMPTZ
);

CREATE TABLE backtest_fills (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    backtest_id  UUID NOT NULL REFERENCES backtest_results(id) ON DELETE CASCADE,
    order_id     UUID NOT NULL REFERENCES backtest_orders(id) ON DELETE CASCADE,
    symbol       TEXT NOT NULL,
    side         TEXT NOT NULL,
    qty          NUMERIC(18, 6) NOT NULL,
    price        NUMERIC(18, 6) NOT NULL,
    notional     NUMERIC(18, 6) NOT NULL,
    commission   NUMERIC(18, 6) NOT NULL DEFAULT 0,
    ts           TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_backtest_orders_backtest_id ON backtest_orders (backtest_id);
CREATE INDEX idx_backtest_fills_backtest_id  ON backtest_fills (backtest_id);
CREATE INDEX idx_backtest_fills_order_id     ON backtest_fills (order_id);

-- Drop the JSONB stubs from backtest_results — the dedicated tables above replace them.
-- These columns were always stripped before insert (insertBacktestResult deleted them
-- from the payload), so dropping them is safe.
ALTER TABLE backtest_results DROP COLUMN IF EXISTS orders;
ALTER TABLE backtest_results DROP COLUMN IF EXISTS fills;
