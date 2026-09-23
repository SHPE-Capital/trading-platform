-- Auth provisioning + retiring the first-pass governance columns
--
-- Two unrelated-but-small things that both belong after 0007:
--   1. app_users rows must appear automatically when someone signs up.
--   2. member_allocations and the approval columns 0005 put on strategy_runs are
--      superseded by strategy_proposals.

-- ---------------------------------------------------------------------------
-- 1. Auto-provision app_users from auth.users
--
-- Enforced by a trigger, not application code. This schema already carries one
-- soft-reference that drifted (strategy_runs.strategy_id, documented in
-- repositories.ts as "no FK constraint... not all IDs resolve") — the identity
-- chain is the last place to repeat that.
--
-- security definer: the trigger runs as the function owner so it can insert into
-- public.app_users during a signup, when there is no authenticated role yet.
-- ---------------------------------------------------------------------------
create or replace function handle_new_auth_user() returns trigger as $$
begin
  insert into public.app_users (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'full_name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- Backfill anyone who signed up before this trigger existed.
insert into app_users (id, email, display_name)
select u.id, u.email, split_part(u.email, '@', 1)
from auth.users u
where not exists (select 1 from app_users a where a.id = u.id)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Retire the superseded governance pieces
--
-- Dropped here rather than by editing 0005 in place. 0005 is already committed
-- and a teammate may have applied it locally; rewriting an applied migration
-- silently diverges their database from the file. Append-only is the safe path,
-- at the cost of these columns briefly existing during a fresh replay.
--
-- member_allocations: a fixed per-member capital cap assumed individuals rather
-- than teams sharing a strategy, and a static number rather than one negotiated
-- per approval. Capital now lives on strategy_proposals.approved_capital_pct and
-- is enforced by the existing RiskEngine.checkStrategyBudget path.
-- ---------------------------------------------------------------------------
drop table if exists member_allocations;
drop view if exists member_contention_daily;
create view member_contention_daily as
select
  owner_id,
  date_trunc('day', ts) as day,
  failed_check,
  count(*) as rejections
from risk_rejections
group by owner_id, date_trunc('day', ts), failed_check;

-- Approval state moved to strategy_proposals, which can hold a rejected or
-- withdrawn request without implying anything ever traded.
alter table strategy_runs drop column if exists backtest_result_id;
alter table strategy_runs drop column if exists approved_by;
alter table strategy_runs drop column if exists approved_at;

-- ---------------------------------------------------------------------------
-- 3. TODO(teams) — deferred until the review workflow has run in paper for a
-- while. When it lands:
--     create table teams (id uuid primary key, name text not null);
--     create table team_members (team_id uuid, user_id uuid, primary key (...));
--     alter table strategies add column team_id uuid references teams (id);
-- Ownership stays individual (strategies.owner_id, strategy_versions.created_by)
-- until then, and approval authority stays club-wide via app_users.role.
-- ---------------------------------------------------------------------------
