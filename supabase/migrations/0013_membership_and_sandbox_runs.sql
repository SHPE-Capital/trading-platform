-- Active club membership and bounded, self-service paper sandbox runs.

-- A Supabase login is authentication, not club membership. Existing leads stay
-- active so the rollout cannot lock out every administrator; existing members
-- and newly created profiles stay pending until explicitly verified.
alter table app_users
  add column membership_status text not null default 'pending'
  check (membership_status in ('pending', 'active', 'suspended'));

update app_users set membership_status = 'active' where role = 'lead';

create index app_users_membership_status on app_users (membership_status);

create or replace function handle_new_auth_user() returns trigger as $$
begin
  insert into public.app_users (id, email, display_name, membership_status)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'full_name',
      split_part(new.email, '@', 1)
    ),
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Sandbox runs expire automatically. The runner enforces this while it owns a
-- lease; orphan claiming below also closes runs that expired while no runner
-- was healthy.
alter table strategy_runs add column expires_at timestamptz;
create index strategy_runs_sandbox_expiry
  on strategy_runs (expires_at)
  where status = 'running' and expires_at is not null;

drop function if exists claim_orphaned_runs(text, text, text, integer);
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
  update strategy_runs
     set status = 'stopped', stopped_at = now(), lease_owner = null,
         lease_expires_at = null,
         disabled_reason = coalesce(disabled_reason, 'Paper sandbox run expired')
   where status = 'running' and execution_mode = p_execution_mode
     and runtime_origin = p_runtime_origin
     and expires_at is not null and expires_at <= now();

  return query
  update strategy_runs r
     set lease_owner = p_owner,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         last_heartbeat_at = now()
   where r.id in (
     select o.id from strategy_runs o
      where o.status = 'running' and o.execution_mode = p_execution_mode
        and o.runtime_origin = p_runtime_origin
        and (o.expires_at is null or o.expires_at > now())
        and (o.lease_owner is null or o.lease_expires_at is null or o.lease_expires_at < now())
      for update skip locked)
  returning r.*;
end;
$$;

revoke execute on function claim_orphaned_runs(text, text, text, integer) from public, anon, authenticated;
grant execute on function claim_orphaned_runs(text, text, text, integer) to service_role;
