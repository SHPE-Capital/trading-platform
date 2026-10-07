-- Execution safety and direct-client access hardening.

-- Local development and deployed processes must never consume each other's
-- work or adopt each other's live runs even when they share a database.
alter table backtest_jobs add column runtime_origin text not null default 'legacy';
alter table strategy_runs add column runtime_origin text not null default 'legacy';
alter table backtest_jobs add column build_sha text not null default 'unknown';
alter table backtest_jobs add column build_dirty boolean not null default false;
alter table backtest_results add column runtime_origin text not null default 'legacy';
alter table backtest_results add column build_sha text not null default 'unknown';
alter table backtest_results add column build_dirty boolean not null default false;
alter table strategy_runs add column build_sha text not null default 'unknown';
alter table strategy_runs add column build_dirty boolean not null default false;

drop index if exists backtest_jobs_active_key;
create unique index backtest_jobs_active_key
  on backtest_jobs (runtime_origin, config_key)
  where status in ('queued', 'running');

drop function if exists claim_backtest_job(text, integer, integer, integer);
create function claim_backtest_job(
  p_worker         text,
  p_lease_seconds  integer default 60,
  p_max_attempts   integer default 3,
  p_per_user_cap   integer default 2,
  p_runtime_origin text default 'local'
) returns setof backtest_jobs
language plpgsql
set search_path = public
as $$
begin
  update backtest_jobs
     set status = 'failed', finished_at = now(), lease_owner = null,
         lease_expires_at = null,
         error_message = coalesce(error_message,
           format('Abandoned after %s attempts — the worker lease expired before the run finished', attempts))
   where status = 'running' and runtime_origin = p_runtime_origin
     and lease_expires_at < now() and attempts >= p_max_attempts;

  return query
  update backtest_jobs j
     set status = 'running', lease_owner = p_worker,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         started_at = coalesce(j.started_at, now()), attempts = j.attempts + 1,
         progress = null
   where j.id = (
     select c.id from backtest_jobs c
      where c.runtime_origin = p_runtime_origin
        and (c.status = 'queued' or (c.status = 'running' and c.lease_expires_at < now()))
        and (p_per_user_cap is null or c.requested_by is null or (
          select count(*) from backtest_jobs r
           where r.requested_by = c.requested_by and r.runtime_origin = p_runtime_origin
             and r.status = 'running' and r.lease_expires_at >= now()) < p_per_user_cap)
      order by c.created_at limit 1 for update skip locked)
  returning j.*;
end;
$$;

drop function if exists claim_orphaned_runs(text, text, integer);
create function claim_orphaned_runs(
  p_owner text,
  p_execution_mode text,
  p_runtime_origin text,
  p_lease_seconds integer default 90
) returns setof strategy_runs
language plpgsql
set search_path = public
as $$
begin
  return query
  update strategy_runs r
     set lease_owner = p_owner,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         last_heartbeat_at = now()
   where r.id in (
     select o.id from strategy_runs o
      where o.status = 'running' and o.execution_mode = p_execution_mode
        and o.runtime_origin = p_runtime_origin
        and (o.lease_owner is null or o.lease_expires_at is null or o.lease_expires_at < now())
      for update skip locked)
  returning r.*;
end;
$$;

revoke execute on function claim_backtest_job(text, integer, integer, integer, text) from public, anon, authenticated;
revoke execute on function claim_orphaned_runs(text, text, text, integer) from public, anon, authenticated;
grant execute on function claim_backtest_job(text, integer, integer, integer, text) to service_role;
grant execute on function claim_orphaned_runs(text, text, text, integer) to service_role;

-- Paper and real-money runs are separate books. Each may have one active run
-- for a strategy; neither should block the other merely because strategy_id is
-- shared.
drop index if exists strategy_runs_single_live;
create unique index strategy_runs_single_live
  on strategy_runs (strategy_id, execution_mode, runtime_origin)
  where status = 'running';

-- The application writes exclusively through the service-role backend. Remove
-- older owner-scoped direct PostgREST policies so a browser token cannot mutate
-- proposal heads/statuses or other workflow state outside controller checks.
drop policy if exists strategies_insert_own on strategies;
drop policy if exists strategies_update_own on strategies;
drop policy if exists strategies_delete_own on strategies;
drop policy if exists jobs_insert_own on backtest_jobs;
drop policy if exists versions_insert_own on strategy_versions;
drop policy if exists proposals_insert_own on strategy_proposals;
drop policy if exists proposals_update_own_or_lead on strategy_proposals;
drop policy if exists runs_write_lead on strategy_runs;
drop policy if exists comments_insert_own on proposal_comments;
drop policy if exists backtests_insert_own on backtest_results;
