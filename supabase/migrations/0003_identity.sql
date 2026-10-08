-- Part 04 — Identity & tenancy
--
-- Shared-book model: members are AUTHORS, not tenants. Everyone trades the same
-- Alpaca account, so ownership here governs who may edit and who is accountable
-- for a strategy — it does NOT partition capital. Capital is governed in 0005.

create table app_users (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  display_name text,
  -- 'member' authors and backtests; 'lead' may promote a strategy to live.
  role        text not null default 'member' check (role in ('member', 'lead')),
  created_at  timestamptz not null default now()
);

alter table strategies      add column owner_id uuid references app_users (id);
alter table strategy_runs   add column owner_id uuid references app_users (id);
alter table backtest_results add column owner_id uuid references app_users (id);
alter table backtest_jobs
  add constraint backtest_jobs_requested_by_fkey
  foreign key (requested_by) references app_users (id);

create index strategies_owner on strategies (owner_id);
create index strategy_runs_owner on strategy_runs (owner_id);

-- ---------------------------------------------------------------------------
-- Row level security
--
-- The control plane talks to Postgres with a per-user JWT and is bound by these
-- policies. The live runner and backtest workers use the service-role key, which
-- bypasses RLS by design — they act on behalf of the whole club, not one member.
-- ---------------------------------------------------------------------------

alter table strategies       enable row level security;
alter table strategy_runs    enable row level security;
alter table backtest_results enable row level security;
alter table backtest_jobs    enable row level security;

-- Everyone can read everything: the book is shared, so results are shared.
-- Seeing each other's strategies is the point of a club.
create policy strategies_read_all on strategies for select using (auth.role() = 'authenticated');
create policy runs_read_all       on strategy_runs for select using (auth.role() = 'authenticated');
create policy backtests_read_all  on backtest_results for select using (auth.role() = 'authenticated');
create policy jobs_read_all       on backtest_jobs for select using (auth.role() = 'authenticated');

-- Writes are owner-scoped.
create policy strategies_insert_own on strategies for insert with check (owner_id = auth.uid());
create policy strategies_update_own on strategies for update using (owner_id = auth.uid());
create policy strategies_delete_own on strategies for delete using (owner_id = auth.uid());
create policy jobs_insert_own       on backtest_jobs for insert with check (requested_by = auth.uid());
