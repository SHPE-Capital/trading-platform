-- Run analytics.
--
-- A run's numbers are derived from what it actually did (its orders, fills and
-- signals in the ledger), not counters the runtime was meant to maintain.

-- Capital set aside for the run when it started: the denominator of its returns.
alter table strategy_runs add column allocated_capital numeric(18, 6);

-- Per-run book, sampled by the runtime that holds the run's lease.
create table run_snapshots (
  id               bigserial primary key,
  run_id           uuid not null references strategy_runs (id) on delete cascade,
  ts               timestamptz not null,
  realized_pnl     numeric(18, 6) not null,
  unrealized_pnl   numeric(18, 6) not null,
  gross_exposure   numeric(18, 6) not null,
  net_exposure     numeric(18, 6) not null,
  positions        jsonb not null default '[]'
);
create index run_snapshots_run_ts on run_snapshots (run_id, ts);

-- Derived per-run figures, refreshed by the ledger after each sync and when a
-- run is read without one.
create table strategy_run_stats (
  run_id          uuid primary key references strategy_runs (id) on delete cascade,
  signals         integer not null default 0,
  orders          integer not null default 0,
  filled_orders   integer not null default 0,
  fills           integer not null default 0,
  rejections      integer not null default 0,
  closed_trades   integer not null default 0,
  realized_pnl    numeric(18, 6) not null default 0,
  unrealized_pnl  numeric(18, 6) not null default 0,
  fees            numeric(18, 6) not null default 0,
  open_positions  jsonb not null default '[]',
  last_fill_at    timestamptz,
  updated_at      timestamptz not null default now()
);

-- What happened to a run outside its trading: which runner adopted or lost
-- it, error streaks, auto-disable, expiry, stop. The run page's timeline.
create table run_events (
  id      bigserial primary key,
  run_id  uuid not null references strategy_runs (id) on delete cascade,
  ts      timestamptz not null default now(),
  type    text not null,
  detail  text
);
create index run_events_run_ts on run_events (run_id, ts);

-- Never maintained: written once as 0 at run creation and never updated.
alter table strategy_runs drop column total_signals;
alter table strategy_runs drop column total_orders;
alter table strategy_runs drop column realized_pnl;

-- Backend (service role) only.
alter table run_snapshots      enable row level security;
alter table strategy_run_stats enable row level security;
alter table run_events         enable row level security;
