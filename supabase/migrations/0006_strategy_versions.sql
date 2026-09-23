-- Strategy versions — immutable config history
--
-- Today updateStrategyConfig() overwrites strategies.config in place, leaving no
-- trace of what changed or why. Every edit now inserts a row here instead.
--
-- Deliberately NOT a composite key on `strategies` itself: strategies.id is the
-- stable identity that orchestrator.hasStrategyWithConfigId(), strategy_runs.
-- strategy_id, and the order/fill soft-refs all depend on meaning "one strategy".
-- Making that table multi-row-per-strategy would silently break live dedup.
-- Instead strategies.id stays exactly as it is, and (strategy_id, version_number)
-- lives here as the natural key for browsing history.

create table strategy_versions (
  -- Own row identity, so other tables FK a single column rather than a composite.
  id              uuid primary key default gen_random_uuid(),

  strategy_id     uuid not null references strategies (id) on delete cascade,

  -- 1, 2, 3... within this strategy_id. Assigned by the trigger below.
  -- Named version_number, NOT version_id: strategy_runs.strategy_version already
  -- exists and means the algorithm's code version (PairsStrategy.VERSION).
  version_number  integer not null,

  config          jsonb   not null,

  -- "explain the strategy or changes" — the commit message for this edit.
  change_summary  text,

  created_by      uuid references app_users (id),
  created_at      timestamptz not null default now(),

  unique (strategy_id, version_number)
);

-- History query: every version of one strategy, newest first.
create index strategy_versions_history
  on strategy_versions (strategy_id, version_number desc);

create index strategy_versions_created_by
  on strategy_versions (created_by, created_at desc);

-- ---------------------------------------------------------------------------
-- Auto-assign version_number per strategy_id.
--
-- Doing this in the database rather than the app avoids a read-then-write race
-- between two members editing the same strategy at once. The unique constraint
-- above is the backstop if two inserts still collide — the loser retries.
-- ---------------------------------------------------------------------------
create or replace function next_strategy_version_number() returns trigger as $$
begin
  select coalesce(max(version_number), 0) + 1
    into new.version_number
    from strategy_versions
   where strategy_id = new.strategy_id;
  return new;
end;
$$ language plpgsql;

create trigger strategy_versions_assign_number
  before insert on strategy_versions
  for each row
  when (new.version_number is null)
  execute function next_strategy_version_number();

-- ---------------------------------------------------------------------------
-- Tag backtests with the exact version they tested.
--
-- This is what removes the need for a proposal↔backtest join table: a version is
-- immutable and a backtest runs against exactly one of them, so "which backtests
-- support this proposal" is just a lookup on the proposal's head version.
--
-- Soft reference (no FK), consistent with how backtest_results.strategy_id
-- already works — results are written by a worker that may outlive the config.
-- ---------------------------------------------------------------------------
alter table backtest_results add column strategy_version_id uuid;

create index backtest_results_version
  on backtest_results (strategy_version_id, completed_at desc);

-- ---------------------------------------------------------------------------
-- RLS — same shape as 0003: everyone reads (the book is shared), authors write.
-- ---------------------------------------------------------------------------
alter table strategy_versions enable row level security;

create policy versions_read_all on strategy_versions
  for select using (auth.role() = 'authenticated');

create policy versions_insert_own on strategy_versions
  for insert with check (created_by = auth.uid());

-- No update/delete policy: versions are immutable by design. Fixing a mistake
-- means creating the next version, which is the whole point of the history.
