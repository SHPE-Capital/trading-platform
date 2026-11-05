-- Expire sandbox runs stranded on a broker account no runner trades anymore.
--
-- claim_orphaned_runs expired only runs on the calling runner's own broker
-- account. A sim account is `sim:<hostname>`, and a Docker container's default
-- hostname is its container id, so recreating the paper-trading container gave
-- the runner a new account. Runs on the old one were then never adopted and
-- never expired: they stayed `running` forever, with no runner trading them.
--
-- The sweep now also expires past-expiry runs of this execution mode on ANY
-- account, as long as no runner holds a live lease on them. An expired run must
-- not trade whoever owns it, and a run under a live lease is left to its
-- holder, which expires it itself. Adoption is unchanged: it stays limited to
-- this runner's account, because adopting means trading on it.
--
-- Same signature, so the backend needs no change and the order of applying this
-- migration and deploying does not matter.

create or replace function claim_orphaned_runs(
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
     and expires_at is not null and expires_at <= now()
     and ((broker_account = p_broker_account
           or (broker_account is null and runtime_origin = p_runtime_origin))
          or lease_owner is null or lease_expires_at is null or lease_expires_at < now());

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
