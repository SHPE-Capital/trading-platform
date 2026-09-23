-- Proposal review state — "changes requested" and a full-history view
--
-- Today a lead's only two actions are approve or reject, and reject is terminal:
-- rejecting closes the proposal, so pushing a fixed-up version opens a brand new
-- proposal with none of the prior discussion attached. That collapses the
-- GitHub-PR model this was built on, where "changes requested" is a review
-- state, not the end of the PR — the same PR stays open, and new commits
-- (versions here) address the feedback.
--
-- No new column or status value is introduced. A request-to-change was already
-- just a proposal_comments row with kind = 'request_changes' that deliberately
-- does not settle the proposal (see 0007) — the gap was that nothing surfaced
-- it as a distinct state. changes_requested below derives it: true when the
-- most recent request_changes comment is newer than the current head version,
-- i.e. feedback has landed since the last thing the author pushed. Pushing a
-- new version re-points head_version_id (existing trigger-free logic in
-- proposalsController.createVersion), which makes v.created_at newer than that
-- comment again — so this clears itself the moment the author responds,
-- without any extra bookkeeping or a "resubmit" action.

create or replace view pending_approvals as
select
  p.id                   as proposal_id,
  p.title,
  p.description,
  p.requested_at,
  p.strategy_id,
  s.name                 as strategy_name,
  s.strategy_type,
  v.id                   as head_version_id,
  v.version_number,
  v.config               as proposed_config,
  v.change_summary,
  v.created_at           as version_created_at,
  ru.id                  as requested_by_id,
  ru.display_name        as requested_by_name,
  ru.email               as requested_by_email,
  (select count(*) from backtest_results b
     where b.strategy_version_id = v.id and b.status = 'completed') as backtest_count,
  (select max(b.completed_at) from backtest_results b
     where b.strategy_version_id = v.id and b.status = 'completed') as latest_backtest_at,
  (select count(*) from proposal_comments c where c.proposal_id = p.id) as comment_count,
  exists (
    select 1 from proposal_comments c
     where c.proposal_id = p.id
       and c.kind = 'request_changes'
       and c.created_at >= v.created_at
  ) as changes_requested
from strategy_proposals p
join strategies      s  on s.id = p.strategy_id
join strategy_versions v on v.id = p.head_version_id
join app_users       ru on ru.id = p.requested_by
where p.status = 'open';

-- ---------------------------------------------------------------------------
-- Full history, any status — backs the approvals page's "All" tab. Same shape
-- as pending_approvals plus who settled it and how, minus the open-only filter.
-- ---------------------------------------------------------------------------
create or replace view proposal_summaries as
select
  p.id                   as proposal_id,
  p.title,
  p.description,
  p.status,
  p.requested_at,
  p.updated_at,
  p.strategy_id,
  s.name                 as strategy_name,
  s.strategy_type,
  v.id                   as head_version_id,
  v.version_number,
  v.change_summary,
  ru.id                  as requested_by_id,
  ru.display_name        as requested_by_name,
  ru.email               as requested_by_email,
  p.approved_by,
  au.display_name        as approved_by_name,
  p.approved_at,
  p.approved_capital_pct,
  p.rejected_by,
  rb.display_name        as rejected_by_name,
  p.rejected_at,
  p.rejection_reason,
  (select count(*) from backtest_results b
     where b.strategy_version_id = v.id and b.status = 'completed') as backtest_count,
  (select count(*) from proposal_comments c where c.proposal_id = p.id) as comment_count,
  exists (
    select 1 from proposal_comments c
     where c.proposal_id = p.id
       and c.kind = 'request_changes'
       and c.created_at >= v.created_at
  ) as changes_requested
from strategy_proposals p
join strategies      s  on s.id = p.strategy_id
join strategy_versions v on v.id = p.head_version_id
join app_users       ru on ru.id = p.requested_by
left join app_users   au on au.id = p.approved_by
left join app_users   rb on rb.id = p.rejected_by;
