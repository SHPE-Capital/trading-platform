-- Database reads require ACTIVE club membership, not just a Supabase login.
--
-- Every read policy so far was `auth.role() = 'authenticated'`. The backend
-- also checks app_users.membership_status = 'active' (requireAuth), but RLS did
-- not, so a pending (invited, not yet verified) or suspended account could read
-- orders, fills, proposals and every member's email straight from PostgREST
-- with the anon key that ships in the frontend bundle. The frontend now reads
-- history tables directly, which makes these policies the primary gate.
--
-- is_active_member() is SECURITY DEFINER so the policy on app_users can call it
-- without recursing into its own policy. It reads only the caller's own row.
--
-- Also: members may read the analytics tables the run pages show (signals,
-- run_snapshots, strategy_run_stats, run_events), and backtest_jobs joins the
-- Realtime publication so the browser can follow a job instead of polling.
-- Writes stay service-role only (0012).

create function is_active_member() returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from app_users
     where id = auth.uid() and membership_status = 'active'
  );
$$;

revoke execute on function is_active_member() from public, anon;
grant execute on function is_active_member() to authenticated, service_role;

-- `(select ...)` evaluates the function once per statement, not once per row.
drop policy strategies_read_all on strategies;
create policy strategies_read_all on strategies for select using ((select is_active_member()));
drop policy runs_read_all on strategy_runs;
create policy runs_read_all on strategy_runs for select using ((select is_active_member()));
drop policy backtests_read_all on backtest_results;
create policy backtests_read_all on backtest_results for select using ((select is_active_member()));
drop policy jobs_read_all on backtest_jobs;
create policy jobs_read_all on backtest_jobs for select using ((select is_active_member()));
drop policy versions_read_all on strategy_versions;
create policy versions_read_all on strategy_versions for select using ((select is_active_member()));
drop policy proposals_read_all on strategy_proposals;
create policy proposals_read_all on strategy_proposals for select using ((select is_active_member()));
drop policy comments_read_all on proposal_comments;
create policy comments_read_all on proposal_comments for select using ((select is_active_member()));
drop policy orders_read_all on orders;
create policy orders_read_all on orders for select using ((select is_active_member()));
drop policy fills_read_all on fills;
create policy fills_read_all on fills for select using ((select is_active_member()));
drop policy snapshots_read_all on portfolio_snapshots;
create policy snapshots_read_all on portfolio_snapshots for select using ((select is_active_member()));
drop policy bt_orders_read_all on backtest_orders;
create policy bt_orders_read_all on backtest_orders for select using ((select is_active_member()));
drop policy bt_fills_read_all on backtest_fills;
create policy bt_fills_read_all on backtest_fills for select using ((select is_active_member()));
drop policy instruments_read_all on instruments;
create policy instruments_read_all on instruments for select using ((select is_active_member()));
drop policy bars_read_all on bars;
create policy bars_read_all on bars for select using ((select is_active_member()));
drop policy coverage_read_all on bar_coverage;
create policy coverage_read_all on bar_coverage for select using ((select is_active_member()));
drop policy rejections_read_all on risk_rejections;
create policy rejections_read_all on risk_rejections for select using ((select is_active_member()));

-- A pending member can still see their own profile (the "awaiting approval"
-- state); only active members see the roster.
drop policy app_users_read_all on app_users;
create policy app_users_read_all on app_users for select
  using (id = auth.uid() or (select is_active_member()));

create policy signals_read_active      on signals            for select using ((select is_active_member()));
create policy run_snapshots_read_active on run_snapshots     for select using ((select is_active_member()));
create policy run_stats_read_active    on strategy_run_stats for select using ((select is_active_member()));
create policy run_events_read_active   on run_events         for select using ((select is_active_member()));

-- Realtime: postgres_changes respects the policies above per subscriber. The
-- publication only exists on Supabase, so a plain Postgres skips this.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'backtest_jobs'
     ) then
    alter publication supabase_realtime add table backtest_jobs;
  end if;
end
$$;
