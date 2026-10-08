-- Part 06 — Shared-book governance
--
-- Two problems that only exist because the book is shared:
--   1. One member must not be able to consume the club's whole capacity.
--   2. Direct P&L hides opportunity cost — a strategy that reserves 40% of the
--      book and sits flat makes another member's strategy fail its budget check
--      and never book the trade it would have won.

-- --------------------------------------------------------------------------
-- 1. Per-member allocation — the tier between club limits and strategy budgets
-- --------------------------------------------------------------------------
create table member_allocations (
  user_id           uuid primary key references app_users (id) on delete cascade,
  -- Fraction of total book equity this member's strategies may hold in aggregate.
  max_capital_pct   numeric(5,4) not null check (max_capital_pct > 0 and max_capital_pct <= 1),
  max_open_orders   integer,
  updated_by        uuid references app_users (id),
  updated_at        timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- 2. Promotion — a live run must cite the backtest that justified it
-- --------------------------------------------------------------------------
alter table strategy_runs
  add column backtest_result_id uuid references backtest_results (id),
  add column approved_by        uuid references app_users (id),
  add column approved_at        timestamptz;

-- --------------------------------------------------------------------------
-- 3. Contention — persist rejections so blocked orders are visible per member
-- --------------------------------------------------------------------------
create table risk_rejections (
  id            bigserial primary key,
  ts            timestamptz not null default now(),
  strategy_id   uuid,
  owner_id      uuid references app_users (id),
  symbol        text,
  -- Which check fired: STRATEGY_BUDGET, CASH_RESERVE, CONCENTRATION, COOLDOWN, ...
  failed_check  text not null,
  reason        text,
  intent        jsonb
);

create index risk_rejections_owner_ts on risk_rejections (owner_id, ts desc);
create index risk_rejections_check    on risk_rejections (failed_check, ts desc);

-- Feeds the contention dashboard: "your strategy was blocked N times by capital
-- contention" turns an invisible fairness problem into a number.
create view member_contention_daily as
select
  owner_id,
  date_trunc('day', ts) as day,
  failed_check,
  count(*) as rejections
from risk_rejections
group by owner_id, date_trunc('day', ts), failed_check;
