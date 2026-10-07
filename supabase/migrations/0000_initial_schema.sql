-- Reproducible baseline for fresh local, CI, staging and production databases.
-- This is the final state of the legacy backend/src/db/migrations/001-005
-- series. Those files predate the canonical supabase/migrations history and
-- were previously assumed to have been applied manually.

create extension if not exists "uuid-ossp";

create table instruments (
  id uuid primary key default uuid_generate_v4(),
  symbol text not null unique,
  name text not null,
  asset_class text not null default 'us_equity',
  exchange text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_instruments_symbol on instruments (symbol);
create index idx_instruments_is_active on instruments (is_active);

create table strategies (
  id uuid primary key default uuid_generate_v4(),
  strategy_type text not null,
  name text not null,
  config jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_strategies_strategy_type on strategies (strategy_type);
create index idx_strategies_created_at on strategies (created_at desc);
create index idx_strategies_config on strategies using gin (config);

create table strategy_runs (
  id uuid primary key default uuid_generate_v4(),
  strategy_id uuid not null,
  strategy_type text not null,
  strategy_version integer,
  config jsonb not null,
  status text not null default 'idle',
  execution_mode text not null default 'paper',
  started_at timestamptz,
  stopped_at timestamptz,
  total_signals integer not null default 0,
  total_orders integer not null default 0,
  realized_pnl numeric(18, 6) not null default 0,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index idx_strategy_runs_strategy_id on strategy_runs (strategy_id);
create index idx_strategy_runs_status on strategy_runs (status);
create index idx_strategy_runs_started_at on strategy_runs (started_at desc);

create table orders (
  id uuid primary key,
  broker_order_id text,
  intent_id uuid not null,
  strategy_id text not null,
  symbol text not null,
  side text not null,
  qty numeric(18, 6) not null,
  filled_qty numeric(18, 6) not null default 0,
  avg_fill_price numeric(18, 6),
  order_type text not null,
  limit_price numeric(18, 6),
  stop_price numeric(18, 6),
  time_in_force text not null,
  status text not null,
  submitted_at timestamptz not null,
  updated_at timestamptz not null,
  closed_at timestamptz,
  meta jsonb,
  is_paper boolean not null default true
);
create index idx_orders_strategy_id on orders (strategy_id);
create index idx_orders_symbol on orders (symbol);
create index idx_orders_status on orders (status);
create index idx_orders_submitted_at on orders (submitted_at desc);

create table fills (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references orders(id) on delete cascade,
  symbol text not null,
  side text not null,
  qty numeric(18, 6) not null,
  price numeric(18, 6) not null,
  notional numeric(18, 6) not null,
  commission numeric(18, 6) not null default 0,
  ts timestamptz not null,
  exchange text,
  is_paper boolean not null default true
);
create index idx_fills_order_id on fills (order_id);
create index idx_fills_symbol on fills (symbol);
create index idx_fills_ts on fills (ts desc);

create table portfolio_snapshots (
  id uuid primary key default uuid_generate_v4(),
  ts timestamptz not null,
  cash numeric(18, 6) not null,
  positions_value numeric(18, 6) not null,
  equity numeric(18, 6) not null,
  initial_capital numeric(18, 6) not null,
  total_unrealized_pnl numeric(18, 6) not null,
  total_realized_pnl numeric(18, 6) not null,
  total_pnl numeric(18, 6) not null,
  return_pct numeric(18, 8) not null,
  positions jsonb not null default '[]',
  position_count integer not null default 0,
  strategy_run_id uuid references strategy_runs(id) on delete set null
);
create index idx_portfolio_snapshots_ts on portfolio_snapshots (ts desc);
create index idx_portfolio_snapshots_strategy_run_id on portfolio_snapshots (strategy_run_id);

create table backtest_results (
  id uuid primary key default uuid_generate_v4(),
  strategy_id uuid references strategies(id) on delete set null,
  strategy_version integer,
  config jsonb not null,
  status text not null default 'pending',
  started_at timestamptz not null,
  completed_at timestamptz,
  error_message text,
  final_portfolio jsonb,
  metrics jsonb,
  equity_curve jsonb,
  event_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index idx_backtest_results_status on backtest_results (status);
create index idx_backtest_results_started_at on backtest_results (started_at desc);
create index idx_backtest_results_strategy on backtest_results (strategy_id, strategy_version);

create table backtest_orders (
  id uuid primary key,
  backtest_id uuid not null references backtest_results(id) on delete cascade,
  strategy_id text not null,
  symbol text not null,
  side text not null,
  qty numeric(18, 6) not null,
  filled_qty numeric(18, 6) not null default 0,
  avg_fill_price numeric(18, 6),
  order_type text not null,
  limit_price numeric(18, 6),
  stop_price numeric(18, 6),
  status text not null,
  submitted_at timestamptz not null,
  closed_at timestamptz
);
create index idx_backtest_orders_backtest_id on backtest_orders (backtest_id);

create table backtest_fills (
  id uuid primary key default uuid_generate_v4(),
  backtest_id uuid not null references backtest_results(id) on delete cascade,
  order_id uuid not null references backtest_orders(id) on delete cascade,
  symbol text not null,
  side text not null,
  qty numeric(18, 6) not null,
  price numeric(18, 6) not null,
  notional numeric(18, 6) not null,
  commission numeric(18, 6) not null default 0,
  ts timestamptz not null
);
create index idx_backtest_fills_backtest_id on backtest_fills (backtest_id);
create index idx_backtest_fills_order_id on backtest_fills (order_id);

create table event_logs (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  source text not null,
  run_id uuid,
  event_count integer not null default 0,
  events jsonb not null default '[]',
  start_date timestamptz not null,
  end_date timestamptz not null,
  created_at timestamptz not null default now()
);
create index idx_event_logs_run_id on event_logs (run_id);
create index idx_event_logs_created_at on event_logs (created_at desc);
