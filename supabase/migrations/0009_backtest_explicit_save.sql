-- Explicit backtest save
--
-- Backtests were previously persisted to backtest_results/backtest_orders/
-- backtest_fills unconditionally on every completed run. With backtesting as
-- a frequent, exploratory activity, this makes storage grow without bound —
-- most runs are parameter-sweep throwaways nobody ever looks at again, yet
-- every one permanently wrote its full (uncapped) order and fill history.
--
-- From here: a completed run lives only in server memory until a member
-- explicitly saves it (POST /api/backtests/:id/save). A row's mere existence
-- in backtest_results now means "someone chose to keep this" — there is no
-- separate "is_saved" flag to maintain, and no auto-inserted row to prune.
--
-- owner_id already exists (0003) but was never written to; it becomes "who
-- saved this" under the new semantics. saved_at is new, distinct from
-- completed_at (when the computation finished vs. when someone kept it —
-- these can be minutes apart, or the row may not exist at all).

alter table backtest_results add column saved_at timestamptz;

-- Supports "my saved backtests" and general saved-history browsing.
create index backtest_results_owner on backtest_results (owner_id, saved_at desc);

-- Owner-scoped write, matching the pattern already established in 0003/0006 —
-- the backend writes via the service-role key regardless, so this is the
-- second net described in requireAuth.ts, not the primary enforcement.
create policy backtests_insert_own on backtest_results
  for insert with check (owner_id = auth.uid());
