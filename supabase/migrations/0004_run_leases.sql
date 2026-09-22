-- Part 05 — Live runner hardening
--
-- The live book is single-writer. Two runners submitting the same signals to the
-- same Alpaca account would each reserve the same cash through their own
-- CapitalReservationManager and overcommit. A deploy that overlaps the previous
-- process is the realistic way that happens.
--
-- Formalises the ad-hoc pattern already in findRunningStartupRun + startupKey.

alter table strategy_runs
  add column lease_owner      text,
  add column lease_expires_at timestamptz,
  add column last_heartbeat_at timestamptz;

-- At most one live runner per strategy. Partial: only active runs are exclusive,
-- so historical rows for the same strategy are unaffected.
create unique index strategy_runs_single_live
  on strategy_runs (strategy_id)
  where status = 'running';

create index strategy_runs_lease_expiry
  on strategy_runs (lease_expires_at)
  where status = 'running';

-- Strategies auto-disabled after repeated STRATEGY_ERROR events, so one member's
-- bad push degrades their own strategy rather than the shared runner.
alter table strategy_runs
  add column consecutive_errors integer not null default 0,
  add column disabled_reason    text;
