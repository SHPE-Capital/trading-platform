-- Runtime support for Parts 02 / 03 / 05, plus RLS hardening
--
-- Everything the backend needs to coordinate between processes lives here as
-- SQL functions called over PostgREST (supabase.rpc). That keeps the backend on
-- the service-role key alone: no direct Postgres connection, so no LISTEN and no
-- session-mode pooler requirement. Row locking (FOR UPDATE SKIP LOCKED) and
-- lease expiry both evaluate against the database clock, never a caller's.

-- ===========================================================================
-- Part 02 — backtest job queue
-- ===========================================================================

-- Written by the worker at most ~1/s. The API's SSE relay polls this column, so
-- progress survives a worker handoff and reaches whichever API replica holds
-- the browser connection — the job row is the only shared channel needed.
alter table backtest_jobs
  add column progress          jsonb,
  add column result_expires_at timestamptz;

-- A finished run's output, staged until someone saves it or the save window
-- closes (0009 keeps backtest_results for explicitly saved runs only). Split into
-- chunks so no single PostgREST request carries an unbounded orders/fills array.
create table backtest_job_artifacts (
  job_id   uuid    not null references backtest_jobs (id) on delete cascade,
  kind     text    not null check (kind in ('summary', 'orders', 'fills')),
  seq      integer not null default 0,
  payload  jsonb   not null,
  primary key (job_id, kind, seq)
);

alter table backtest_job_artifacts enable row level security;
-- No policies: staged output is read by the API with the service-role key only.

-- ---------------------------------------------------------------------------
-- Claim the oldest runnable job. Runnable = queued, or running with a lapsed
-- lease (its worker died). A per-member cap on concurrently running jobs keeps
-- one member's sweep from starving the queue during a meeting; it is soft — two
-- workers claiming at the same instant can exceed it by one.
-- ---------------------------------------------------------------------------
create or replace function claim_backtest_job(
  p_worker        text,
  p_lease_seconds integer default 60,
  p_max_attempts  integer default 3,
  p_per_user_cap  integer default 2
) returns setof backtest_jobs
language plpgsql
set search_path = public
as $$
begin
  -- A job whose lease lapsed on every attempt is poison (it kills or hangs its
  -- worker). Fail it rather than hand it to yet another worker.
  update backtest_jobs
     set status = 'failed',
         finished_at = now(),
         lease_owner = null,
         lease_expires_at = null,
         error_message = coalesce(
           error_message,
           format('Abandoned after %s attempts — the worker lease expired before the run finished', attempts))
   where status = 'running'
     and lease_expires_at < now()
     and attempts >= p_max_attempts;

  return query
  update backtest_jobs j
     set status = 'running',
         lease_owner = p_worker,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         started_at = coalesce(j.started_at, now()),
         attempts = j.attempts + 1,
         progress = null
   where j.id = (
     select c.id
       from backtest_jobs c
      where (c.status = 'queued' or (c.status = 'running' and c.lease_expires_at < now()))
        and (p_per_user_cap is null or c.requested_by is null or (
              select count(*)
                from backtest_jobs r
               where r.requested_by = c.requested_by
                 and r.status = 'running'
                 and r.lease_expires_at >= now()
            ) < p_per_user_cap)
      order by c.created_at
      limit 1
      for update skip locked)
  returning j.*;
end;
$$;

-- Heartbeat + progress in one write. Returns false when this worker no longer
-- holds the lease (it lapsed and another worker reclaimed the job) — the caller
-- must abandon the run without writing anything.
create or replace function touch_backtest_job(
  p_job           uuid,
  p_worker        text,
  p_lease_seconds integer default 60,
  p_progress      jsonb default null
) returns boolean
language plpgsql
set search_path = public
as $$
begin
  update backtest_jobs
     set lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         progress = coalesce(p_progress, progress)
   where id = p_job and lease_owner = p_worker and status = 'running';
  return found;
end;
$$;

create or replace function complete_backtest_job(
  p_job                uuid,
  p_worker             text,
  p_result_ttl_seconds integer default 1800
) returns boolean
language plpgsql
set search_path = public
as $$
begin
  update backtest_jobs
     set status = 'succeeded',
         result_id = p_job,
         finished_at = now(),
         lease_owner = null,
         lease_expires_at = null,
         result_expires_at = now() + make_interval(secs => p_result_ttl_seconds)
   where id = p_job and lease_owner = p_worker and status = 'running';
  return found;
end;
$$;

create or replace function fail_backtest_job(
  p_job    uuid,
  p_worker text,
  p_error  text
) returns boolean
language plpgsql
set search_path = public
as $$
begin
  update backtest_jobs
     set status = 'failed',
         error_message = p_error,
         finished_at = now(),
         lease_owner = null,
         lease_expires_at = null
   where id = p_job and lease_owner = p_worker and status = 'running';
  return found;
end;
$$;

-- Graceful worker shutdown: hand the job straight back instead of making it
-- wait out the lease. The attempt it consumed is refunded — it did not fail.
create or replace function release_backtest_job(
  p_job    uuid,
  p_worker text
) returns boolean
language plpgsql
set search_path = public
as $$
begin
  update backtest_jobs
     set status = 'queued',
         lease_owner = null,
         lease_expires_at = null,
         progress = null,
         attempts = greatest(attempts - 1, 0)
   where id = p_job and lease_owner = p_worker and status = 'running';
  return found;
end;
$$;

-- Drops staged output whose save window closed, then finished jobs past the
-- retention horizon (their artifacts cascade). Returns rows removed.
create or replace function sweep_backtest_jobs(p_keep_finished_hours integer default 72)
returns integer
language plpgsql
set search_path = public
as $$
declare
  n_artifacts integer;
  n_jobs      integer;
begin
  delete from backtest_job_artifacts a
   using backtest_jobs j
   where a.job_id = j.id
     and j.result_expires_at < now();
  get diagnostics n_artifacts = row_count;

  delete from backtest_jobs
   where status in ('succeeded', 'failed')
     and finished_at < now() - make_interval(hours => p_keep_finished_hours);
  get diagnostics n_jobs = row_count;

  return n_artifacts + n_jobs;
end;
$$;

-- ===========================================================================
-- Part 03 — bar cache read path
--
-- One call returns a whole range as a single JSON array of
-- [ts_ms, open, high, low, close, volume, trade_count, vwap] tuples. A set-
-- returning query would be capped at PostgREST's max-rows (1000 by default),
-- which turns a year of minute bars into hundreds of round trips — slower than
-- the Alpaca download the cache exists to avoid. The loader asks for bounded
-- slices so each response stays a few MB.
-- ===========================================================================
create or replace function get_bars(
  p_symbol    text,
  p_timeframe text,
  p_start     timestamptz,
  p_end       timestamptz
) returns json
language sql
stable
set search_path = public
as $$
  select coalesce(
    json_agg(
      json_build_array(
        (extract(epoch from ts) * 1000)::bigint,
        open, high, low, close, volume, trade_count, vwap)
      order by ts),
    '[]'::json)
  from bars
  where symbol = p_symbol
    and timeframe = p_timeframe
    and ts >= p_start
    and ts < p_end;
$$;

-- ===========================================================================
-- Part 05 — live run leases
--
-- One lease per strategy_runs row. A runner only trades runs it holds; it
-- heartbeats every held lease, and adopts running runs of its own execution
-- mode whose lease is missing or lapsed. Two runners booting together therefore
-- split nothing: the conditional UPDATE lets exactly one of them take each run.
-- ===========================================================================
create or replace function acquire_run_lease(
  p_run           uuid,
  p_owner         text,
  p_lease_seconds integer default 90
) returns boolean
language plpgsql
set search_path = public
as $$
begin
  update strategy_runs
     set lease_owner = p_owner,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         last_heartbeat_at = now()
   where id = p_run
     and status = 'running'
     and (lease_owner is null
          or lease_owner = p_owner
          or lease_expires_at is null
          or lease_expires_at < now());
  return found;
end;
$$;

create or replace function claim_orphaned_runs(
  p_owner          text,
  p_execution_mode text,
  p_lease_seconds  integer default 90
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
     select o.id
       from strategy_runs o
      where o.status = 'running'
        and o.execution_mode = p_execution_mode
        and (o.lease_owner is null or o.lease_expires_at is null or o.lease_expires_at < now())
      for update skip locked)
  returning r.*;
end;
$$;

-- Extends every lease the caller still holds; returns exactly those run ids.
-- Anything the caller sent that is missing from the result was lost (lapsed and
-- adopted by another runner, or stopped) and must stop trading immediately.
create or replace function heartbeat_run_leases(
  p_owner         text,
  p_runs          uuid[],
  p_lease_seconds integer default 90
) returns setof uuid
language plpgsql
set search_path = public
as $$
begin
  return query
  update strategy_runs
     set lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         last_heartbeat_at = now()
   where id = any(p_runs)
     and lease_owner = p_owner
     and status = 'running'
  returning id;
end;
$$;

create or replace function release_run_lease(
  p_run   uuid,
  p_owner text
) returns boolean
language plpgsql
set search_path = public
as $$
begin
  update strategy_runs
     set lease_owner = null,
         lease_expires_at = null
   where id = p_run and lease_owner = p_owner;
  return found;
end;
$$;

-- ===========================================================================
-- Every function above is backend-only. Supabase's default privileges grant
-- EXECUTE on new public functions to anon and authenticated, which would let
-- anyone holding the (public) anon key claim jobs or steal run leases.
-- ===========================================================================
revoke execute on function claim_backtest_job(text, integer, integer, integer) from public, anon, authenticated;
revoke execute on function touch_backtest_job(uuid, text, integer, jsonb)       from public, anon, authenticated;
revoke execute on function complete_backtest_job(uuid, text, integer)           from public, anon, authenticated;
revoke execute on function fail_backtest_job(uuid, text, text)                  from public, anon, authenticated;
revoke execute on function release_backtest_job(uuid, text)                     from public, anon, authenticated;
revoke execute on function sweep_backtest_jobs(integer)                         from public, anon, authenticated;
revoke execute on function get_bars(text, text, timestamptz, timestamptz)       from public, anon, authenticated;
revoke execute on function acquire_run_lease(uuid, text, integer)               from public, anon, authenticated;
revoke execute on function claim_orphaned_runs(text, text, integer)             from public, anon, authenticated;
revoke execute on function heartbeat_run_leases(text, uuid[], integer)          from public, anon, authenticated;
revoke execute on function release_run_lease(uuid, text)                        from public, anon, authenticated;

grant execute on function claim_backtest_job(text, integer, integer, integer) to service_role;
grant execute on function touch_backtest_job(uuid, text, integer, jsonb)       to service_role;
grant execute on function complete_backtest_job(uuid, text, integer)           to service_role;
grant execute on function fail_backtest_job(uuid, text, text)                  to service_role;
grant execute on function release_backtest_job(uuid, text)                     to service_role;
grant execute on function sweep_backtest_jobs(integer)                         to service_role;
grant execute on function get_bars(text, text, timestamptz, timestamptz)       to service_role;
grant execute on function acquire_run_lease(uuid, text, integer)               to service_role;
grant execute on function claim_orphaned_runs(text, text, integer)             to service_role;
grant execute on function heartbeat_run_leases(text, uuid[], integer)          to service_role;
grant execute on function release_run_lease(uuid, text)                        to service_role;

-- ===========================================================================
-- RLS hardening
--
-- Supabase grants anon and authenticated full table privileges on the public
-- schema, so a table WITHOUT row level security is readable and writable by
-- anyone holding the anon key — which ships in the frontend bundle. The worst
-- case today is app_users: a signed-in member could PATCH their own row to
-- role = 'lead' through PostgREST and approve their own proposals.
--
-- The backend uses the service-role key and bypasses RLS, and the frontend only
-- uses Supabase for auth, so enabling RLS here breaks no current code path.
-- Read access for signed-in members matches the shared-book model (0003);
-- writes stay service-role only.
-- ===========================================================================
alter table app_users           enable row level security;
alter table orders              enable row level security;
alter table fills               enable row level security;
alter table portfolio_snapshots enable row level security;
alter table backtest_orders     enable row level security;
alter table backtest_fills      enable row level security;
alter table instruments         enable row level security;
alter table event_logs          enable row level security;
alter table bars                enable row level security;
alter table bar_coverage        enable row level security;
alter table risk_rejections     enable row level security;

create policy app_users_read_all   on app_users           for select using (auth.role() = 'authenticated');
create policy orders_read_all      on orders              for select using (auth.role() = 'authenticated');
create policy fills_read_all       on fills               for select using (auth.role() = 'authenticated');
create policy snapshots_read_all   on portfolio_snapshots for select using (auth.role() = 'authenticated');
create policy bt_orders_read_all   on backtest_orders     for select using (auth.role() = 'authenticated');
create policy bt_fills_read_all    on backtest_fills      for select using (auth.role() = 'authenticated');
create policy instruments_read_all on instruments         for select using (auth.role() = 'authenticated');
create policy bars_read_all        on bars                for select using (auth.role() = 'authenticated');
create policy coverage_read_all    on bar_coverage        for select using (auth.role() = 'authenticated');
create policy rejections_read_all  on risk_rejections     for select using (auth.role() = 'authenticated');
-- event_logs: no policy — internal diagnostics only.

-- Views run with their owner's privileges by default, which bypasses the RLS on
-- every table they read. security_invoker makes them respect the caller's.
alter view pending_approvals       set (security_invoker = true);
alter view proposal_timeline       set (security_invoker = true);
alter view proposal_summaries      set (security_invoker = true);
alter view member_contention_daily set (security_invoker = true);
