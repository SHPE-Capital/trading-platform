-- Broker accounts and one active run per strategy per account.
--
-- A trading runtime resolves the account it trades at boot (Alpaca
-- account_number, or sim:<hostname> for a local simulated book) and refuses to
-- start against an account registered to another runtime origin. The club's
-- shared account is additionally pinned in code (config/protectedAccounts.ts),
-- because a fresh local database has no row for it.

create table broker_accounts (
  id                     text primary key,
  kind                   text not null check (kind in ('alpaca_paper', 'alpaca_live', 'sim')),
  label                  text,
  allowed_runtime_origin text not null,
  created_at             timestamptz not null default now()
);

-- Backend (service role) only.
alter table broker_accounts enable row level security;

-- The production account is registered by its runtime on first boot. To
-- register it ahead of time instead:
--   insert into broker_accounts (id, kind, label, allowed_runtime_origin)
--   values ('PA3BE0J2FC01', 'alpaca_paper', 'SHPE Capital club paper book', 'aws-prod');

alter table strategy_runs add column broker_account text references broker_accounts(id);
create index strategy_runs_broker_account on strategy_runs (broker_account);

-- One active run per strategy per broker account: two runs of the same strategy
-- on one account would each believe they own its positions. Rows from before
-- broker accounts keep the previous (mode, origin) scope.
drop index if exists strategy_runs_single_live;
create unique index strategy_runs_single_live
  on strategy_runs (strategy_id, coalesce(broker_account, execution_mode || ':' || runtime_origin))
  where status = 'running';

-- Runners adopt only runs on the account they trade. Rows without an account
-- (from before this migration) are still adopted by origin, as before.
drop function if exists claim_orphaned_runs(text, text, text, integer);
create function claim_orphaned_runs(
  p_owner text,
  p_execution_mode text,
  p_runtime_origin text,
  p_lease_seconds integer default 90,
  p_broker_account text default null
) returns setof strategy_runs
language plpgsql
set search_path = public
as $$
begin
  update strategy_runs
     set status = 'stopped', stopped_at = now(), lease_owner = null,
         lease_expires_at = null,
         disabled_reason = coalesce(disabled_reason, 'Paper sandbox run expired')
   where status = 'running' and execution_mode = p_execution_mode
     and (broker_account = p_broker_account
          or (broker_account is null and runtime_origin = p_runtime_origin))
     and expires_at is not null and expires_at <= now();

  return query
  update strategy_runs r
     set lease_owner = p_owner,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         last_heartbeat_at = now()
   where r.id in (
     select o.id from strategy_runs o
      where o.status = 'running' and o.execution_mode = p_execution_mode
        and (o.broker_account = p_broker_account
             or (o.broker_account is null and o.runtime_origin = p_runtime_origin))
        and (o.expires_at is null or o.expires_at > now())
        and (o.lease_owner is null or o.lease_expires_at is null or o.lease_expires_at < now())
      for update skip locked)
  returning r.*;
end;
$$;

revoke execute on function claim_orphaned_runs(text, text, text, integer, text) from public, anon, authenticated;
grant execute on function claim_orphaned_runs(text, text, text, integer, text) to service_role;
