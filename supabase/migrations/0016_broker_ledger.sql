-- Broker ledger.
--
-- The broker (Alpaca) is the source of truth for what executed: orders, fills,
-- fees, cash and positions. This database is the source of truth for why: which
-- run sent each order, from which signal, at what decision price. Orders are
-- journaled here before they are sent; the sync job copies the broker's orders
-- and fills back, keyed so a re-run is a no-op; the drift check compares what
-- the broker holds with what the runs believe they hold.

-- ---------------------------------------------------------------------------
-- Orders: attributed to a run, and matched to the broker by client order id
-- (`<runId>:<intentId>`) or broker order id.
-- ---------------------------------------------------------------------------
alter table orders
  add column run_id          uuid references strategy_runs (id) on delete set null,
  add column broker_account  text references broker_accounts (id),
  add column client_order_id text,
  add column signal_id       uuid,
  add column decision_price  numeric(18, 6),
  add column source          text not null default 'runtime'
    check (source in ('runtime', 'sync', 'backfill'));

alter table orders add constraint orders_broker_client_order_id unique (broker_account, client_order_id);
alter table orders add constraint orders_broker_order_id unique (broker_account, broker_order_id);
create index orders_run on orders (run_id, submitted_at);

-- ---------------------------------------------------------------------------
-- Fills: one row per broker execution (Alpaca FILL activity id), so the sync
-- can copy them repeatedly without duplicating.
-- ---------------------------------------------------------------------------
alter table fills
  add column run_id         uuid references strategy_runs (id) on delete set null,
  add column broker_account text references broker_accounts (id),
  add column broker_fill_id text,
  add column source         text not null default 'runtime'
    check (source in ('runtime', 'sync', 'backfill'));

alter table fills add constraint fills_broker_fill_id unique (broker_account, broker_fill_id);
create index fills_run on fills (run_id, ts);
create index fills_broker_account on fills (broker_account, ts);

-- Account-level charges (regulatory fees). Alpaca does not tie them to orders.
create table broker_fees (
  broker_account text not null references broker_accounts (id),
  id             text not null,
  ts             timestamptz not null,
  amount         numeric(18, 6) not null,
  description    text,
  primary key (broker_account, id)
);

-- ---------------------------------------------------------------------------
-- Signals: every signal a run emitted and what became of it.
-- ---------------------------------------------------------------------------
create table signals (
  id             uuid primary key,
  run_id         uuid references strategy_runs (id) on delete cascade,
  strategy_id    text not null,
  broker_account text references broker_accounts (id),
  ts             timestamptz not null,
  symbol         text,
  direction      text,
  payload        jsonb not null,
  outcome        text not null default 'pending'
    check (outcome in ('pending', 'submitted', 'risk_rejected', 'capital_unavailable', 'dropped')),
  outcome_reason text,
  updated_at     timestamptz not null default now()
);
create index signals_run on signals (run_id, ts);

alter table risk_rejections add column signal_id uuid;
alter table risk_rejections add column run_id uuid references strategy_runs (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Sync bookkeeping and drift.
-- ---------------------------------------------------------------------------
create table broker_sync_state (
  broker_account text primary key references broker_accounts (id),
  orders_cursor  timestamptz,
  fills_cursor   timestamptz,
  fees_cursor    timestamptz,
  last_synced_at timestamptz,
  last_error     text,
  updated_at     timestamptz not null default now()
);

-- Per symbol: what the broker holds, split into what running runs, stopped
-- runs, and no run at all account for. Only rows with something wrong are kept.
create table broker_drift (
  broker_account   text not null references broker_accounts (id),
  symbol           text not null,
  broker_qty       numeric(18, 6) not null,
  running_qty      numeric(18, 6) not null,
  stopped_qty      numeric(18, 6) not null,
  unattributed_qty numeric(18, 6) not null,
  checked_at       timestamptz not null default now(),
  primary key (broker_account, symbol)
);

-- Net position per run and symbol, from the ledger's fills.
create view ledger_run_positions with (security_invoker = true) as
select f.broker_account,
       f.run_id,
       f.symbol,
       sum(case when f.side = 'buy' then f.qty else -f.qty end) as qty
  from fills f
 where f.broker_account is not null
 group by f.broker_account, f.run_id, f.symbol;

-- The equity curve of a sim book comes from its own snapshots; keep accounts apart.
alter table portfolio_snapshots add column broker_account text references broker_accounts (id);
create index portfolio_snapshots_broker_account on portfolio_snapshots (broker_account, ts desc);

-- Backend (service role) only.
alter table broker_fees       enable row level security;
alter table signals           enable row level security;
alter table broker_sync_state enable row level security;
alter table broker_drift      enable row level security;
