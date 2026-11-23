-- Momentum audit trail (plan P2-6).
--
-- Every order connects the first-seen data event to the signal, risk decision,
-- order request, acknowledgment, fill or cancellation, and the resulting
-- account state. Bars as the live engine first saw them live in
-- momentum_audit_bars; later Alpaca bar corrections (updatedBars) live apart in
-- momentum_bar_corrections and never overwrite what the engine saw.
--
-- All three tables are append-only (a trigger rejects UPDATE and DELETE) and
-- use flat typed columns so they export cleanly to Parquet for research.
-- Backend (service role) only. Number 0020 was the next free one when written;
-- renumber if another migration landed first.

-- The bar as first seen by the live engine.
create table momentum_audit_bars (
  id            bigserial primary key,
  run_id        uuid references strategy_runs (id) on delete set null,
  symbol        text not null,
  timeframe     text not null,
  bar_ts        timestamptz not null,  -- exchange period start
  first_seen_at timestamptz not null,  -- local clock when the engine received it
  open          numeric(18, 6) not null,
  high          numeric(18, 6) not null,
  low           numeric(18, 6) not null,
  close         numeric(18, 6) not null,
  volume        numeric(20, 4) not null,
  vwap          numeric(18, 6),
  trade_count   integer
);
-- One first-seen row per run, symbol, timeframe and bar; a repeat is ignored, never merged.
create unique index momentum_audit_bars_key
  on momentum_audit_bars (coalesce(run_id, '00000000-0000-0000-0000-000000000000'::uuid), symbol, timeframe, bar_ts);
create index momentum_audit_bars_symbol_ts on momentum_audit_bars (symbol, bar_ts);

-- One row per step of an order's chain. Join on signal_id / intent_id / order_id.
create table momentum_audit_events (
  id               bigserial primary key,
  run_id           uuid references strategy_runs (id) on delete set null,
  stage            text not null check (stage in (
    'signal', 'risk_rejected', 'capital_unavailable', 'order_request', 'submitted',
    'ack', 'partial_fill', 'fill', 'cancel', 'reject', 'expire', 'account_state'
  )),
  ts               timestamptz not null,  -- local clock when the stage was recorded
  symbol           text,
  signal_id        uuid,
  intent_id        uuid,
  order_id         uuid,
  broker_order_id  text,
  -- The first-seen bar the signal chain started from.
  bar_symbol       text,
  bar_timeframe    text,
  bar_ts           timestamptz,
  bar_first_seen_at timestamptz,
  qty              numeric(18, 6),        -- fill or order quantity, where the stage has one
  price            numeric(18, 6),        -- fill or limit price, where the stage has one
  detail           jsonb not null default '{}'
);
create index momentum_audit_events_intent on momentum_audit_events (intent_id, id);
create index momentum_audit_events_signal on momentum_audit_events (signal_id, id);
create index momentum_audit_events_order on momentum_audit_events (order_id, id);
create index momentum_audit_events_run_ts on momentum_audit_events (run_id, ts);

-- Alpaca corrected bars, kept apart from the first-seen bars.
create table momentum_bar_corrections (
  id          bigserial primary key,
  run_id      uuid references strategy_runs (id) on delete set null,
  symbol      text not null,
  timeframe   text not null,
  bar_ts      timestamptz not null,
  received_at timestamptz not null,
  open        numeric(18, 6) not null,
  high        numeric(18, 6) not null,
  low         numeric(18, 6) not null,
  close       numeric(18, 6) not null,
  volume      numeric(20, 4) not null,
  vwap        numeric(18, 6),
  trade_count integer
);
create index momentum_bar_corrections_symbol_ts on momentum_bar_corrections (symbol, bar_ts, received_at);

create function momentum_audit_append_only() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

create trigger momentum_audit_bars_append_only
  before update or delete on momentum_audit_bars
  for each row execute function momentum_audit_append_only();
create trigger momentum_audit_events_append_only
  before update or delete on momentum_audit_events
  for each row execute function momentum_audit_append_only();
create trigger momentum_bar_corrections_append_only
  before update or delete on momentum_bar_corrections
  for each row execute function momentum_audit_append_only();

-- Backend (service role) only.
alter table momentum_audit_bars       enable row level security;
alter table momentum_audit_events     enable row level security;
alter table momentum_bar_corrections  enable row level security;
