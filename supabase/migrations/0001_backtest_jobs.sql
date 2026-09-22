-- Part 02 — Durable backtest queue
--
-- Moves backtest execution off the request thread and out of the trading
-- process. The API inserts a job; a worker claims it with FOR UPDATE SKIP
-- LOCKED, heartbeats a lease while it runs, and writes the result.
--
-- Replaces the in-process `inFlightKeys` Map in backtestController.ts, which
-- cannot dedup across API replicas.

create type backtest_job_status as enum ('queued', 'running', 'succeeded', 'failed');

create table backtest_jobs (
  id                uuid primary key default gen_random_uuid(),

  -- Stable fingerprint from backtestConfigKey(). The partial unique index below
  -- is what actually prevents two replicas starting the same expensive run.
  config_key        text        not null,
  config            jsonb       not null,
  strategy_version  integer,

  status            backtest_job_status not null default 'queued',

  -- Lease: worker identity plus an expiry. A crashed worker's job is reclaimed
  -- once the lease lapses, rather than being stuck in 'running' forever.
  lease_owner       text,
  lease_expires_at  timestamptz,

  -- Result linkage and failure reporting.
  result_id         uuid,
  error_message     text,
  attempts          integer     not null default 0,

  requested_by      uuid,       -- FK added in 0003 once users exist
  created_at        timestamptz not null default now(),
  started_at        timestamptz,
  finished_at       timestamptz
);

-- Dedup: at most one live job per config fingerprint. Completed jobs are
-- excluded so an identical config can be re-run later (or forced).
create unique index backtest_jobs_active_key
  on backtest_jobs (config_key)
  where status in ('queued', 'running');

-- Claim path: workers scan for queued jobs, or running jobs whose lease lapsed.
create index backtest_jobs_claimable
  on backtest_jobs (status, lease_expires_at nulls first, created_at);

create index backtest_jobs_requested_by on backtest_jobs (requested_by, created_at desc);

-- Notify listeners on every state change so the API can relay SSE progress from
-- whichever replica holds the browser connection.
create or replace function notify_backtest_job_change() returns trigger as $$
begin
  perform pg_notify(
    'backtest_job',
    json_build_object('id', new.id, 'status', new.status, 'result_id', new.result_id)::text
  );
  return new;
end;
$$ language plpgsql;

create trigger backtest_jobs_notify
  after insert or update of status on backtest_jobs
  for each row execute function notify_backtest_job_change();
