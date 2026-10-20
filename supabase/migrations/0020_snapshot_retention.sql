-- Snapshot retention and a chart-sized equity history.
--
-- portfolio_snapshots and run_snapshots are written every minute a value
-- changes (and hourly otherwise), and nothing ever deleted them: on the free
-- plan's 500 MB database that is the next-largest grower after the old bar
-- cache. Exact history lives in orders and fills; snapshots only draw charts.
--
-- prune_snapshots keeps every row for p_full_detail_days, then the first row
-- of each hour per broker account / run. The paper-trading runtime calls it
-- daily. Running it twice changes nothing.
--
-- portfolio_equity_history returns at most ~p_points rows (the last snapshot in
-- each time bucket), newest window first-to-last, so a chart reads a few
-- hundred small rows instead of every minute of history. It runs with the
-- caller's rights, so the 0019 membership policies apply to browser calls.

create function prune_snapshots(p_full_detail_days integer default 14) returns integer
language plpgsql
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => p_full_detail_days);
  v_portfolio integer;
  v_runs integer;
begin
  delete from portfolio_snapshots s
   using (
     select id from (
       select id, row_number() over (
         partition by broker_account, date_trunc('hour', ts) order by ts
       ) as rn
       from portfolio_snapshots
       where ts < v_cutoff
     ) ranked
     where rn > 1
   ) extra
   where s.id = extra.id;
  get diagnostics v_portfolio = row_count;

  delete from run_snapshots s
   using (
     select id from (
       select id, row_number() over (
         partition by run_id, date_trunc('hour', ts) order by ts
       ) as rn
       from run_snapshots
       where ts < v_cutoff
     ) ranked
     where rn > 1
   ) extra
   where s.id = extra.id;
  get diagnostics v_runs = row_count;

  return v_portfolio + v_runs;
end;
$$;

revoke execute on function prune_snapshots(integer) from public, anon, authenticated;
grant execute on function prune_snapshots(integer) to service_role;

-- p_broker_account NULL reads snapshots that predate broker accounts (0016).
-- p_since NULL starts at the oldest snapshot.
create function portfolio_equity_history(
  p_broker_account text,
  p_since timestamptz default null,
  p_points integer default 500
) returns table (ts timestamptz, equity numeric, initial_capital numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with scoped as (
    select s.ts, s.equity, s.initial_capital
      from portfolio_snapshots s
     where s.broker_account is not distinct from p_broker_account
       and (p_since is null or s.ts >= p_since)
  ),
  bounds as (
    select min(ts) as first_ts from scoped
  ),
  bucket as (
    select greatest(
      interval '1 minute',
      (now() - coalesce(p_since, (select first_ts from bounds))) / greatest(p_points, 1)
    ) as width
  )
  select distinct on (date_bin((select width from bucket), scoped.ts, (select coalesce(p_since, first_ts) from bounds)))
         scoped.ts, scoped.equity, scoped.initial_capital
    from scoped
   order by date_bin((select width from bucket), scoped.ts, (select coalesce(p_since, first_ts) from bounds)),
            scoped.ts desc;
$$;

revoke execute on function portfolio_equity_history(text, timestamptz, integer) from public, anon;
grant execute on function portfolio_equity_history(text, timestamptz, integer) to authenticated, service_role;
