-- 003_orders_is_paper.sql
-- Adds is_paper flag to orders and fills to distinguish paper trades from live trades.
-- Defaults to false. All callers must pass the flag explicitly.

ALTER TABLE orders ADD COLUMN is_paper BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE fills  ADD COLUMN is_paper BOOLEAN NOT NULL DEFAULT true;
