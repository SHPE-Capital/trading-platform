-- Strategy proposals — the review page
--
-- A proposal is the request to promote one already-tested strategy version to
-- live. It is NOT a strategy_runs row: a rejected proposal never executed, and
-- modelling it as "a run that never ran" overloads that table with three
-- different meanings. strategy_runs stays what it is — proof something traded —
-- and gets exactly one INSERT, at approval time.
--
-- The review page is read-and-discuss only. Editing a strategy means creating
-- and testing a new version (0006), which then attaches here.

create type proposal_status as enum ('open', 'approved', 'rejected', 'withdrawn');

create table strategy_proposals (
  id                   uuid primary key default gen_random_uuid(),

  strategy_id          uuid not null references strategies (id) on delete cascade,

  -- The specific tested version being proposed. Moves forward when the author
  -- pushes a newer version while the proposal is still open.
  head_version_id      uuid not null references strategy_versions (id),

  title                text not null,
  -- Proposal-level "why this should go live", distinct from the per-version
  -- change_summary ("what changed in this edit") — same split as a GitHub PR
  -- description vs. its commit messages.
  description          text,

  status               proposal_status not null default 'open',

  requested_by         uuid not null references app_users (id),
  requested_at         timestamptz not null default now(),

  approved_by          uuid references app_users (id),
  approved_at          timestamptz,
  -- Optional sizing override set at approval time. Capital is decided fresh per
  -- approval rather than from a fixed per-member cap, so a lead can size down
  -- without bouncing the proposal back for another round. Applied to the run's
  -- config.riskBudget.maxCapitalPct, which RiskEngine.checkStrategyBudget
  -- already enforces at order time.
  approved_capital_pct numeric(5,4) check (
    approved_capital_pct is null
    or (approved_capital_pct > 0 and approved_capital_pct <= 1)
  ),

  rejected_by          uuid references app_users (id),
  rejected_at          timestamptz,
  rejection_reason     text,

  updated_at           timestamptz not null default now()
);

-- At most one open proposal per strategy. This is what makes "attach the newest
-- version to the open proposal" unambiguous — there is never more than one
-- candidate to attach to.
create unique index strategy_proposals_one_open
  on strategy_proposals (strategy_id)
  where status = 'open';

create index strategy_proposals_queue
  on strategy_proposals (status, requested_at desc);

create index strategy_proposals_requester
  on strategy_proposals (requested_by, requested_at desc);

-- ---------------------------------------------------------------------------
-- Discussion
--
-- A lead's approve / request-changes verdict IS a comment with a kind, rather
-- than a separate reviews table — so one ordered query reconstructs the whole
-- conversation, the way a PR timeline works.
-- ---------------------------------------------------------------------------
create type comment_kind as enum ('comment', 'suggestion', 'approve', 'request_changes');

create table proposal_comments (
  id           uuid primary key default gen_random_uuid(),
  proposal_id  uuid not null references strategy_proposals (id) on delete cascade,
  author_id    uuid not null references app_users (id),
  body         text not null,
  kind         comment_kind not null default 'comment',
  created_at   timestamptz not null default now()
);

create index proposal_comments_thread
  on proposal_comments (proposal_id, created_at);

-- ---------------------------------------------------------------------------
-- Link a live run back to the exact version and proposal that authorised it.
-- ---------------------------------------------------------------------------
alter table strategy_runs add column version_id  uuid references strategy_versions (id);
alter table strategy_runs add column proposal_id uuid references strategy_proposals (id);

create index strategy_runs_version on strategy_runs (version_id);

-- ---------------------------------------------------------------------------
-- The review surface: one query gives a lead everything needed to decide.
-- ---------------------------------------------------------------------------
create view pending_approvals as
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
  -- How many backtests exist for this exact version, and when the latest one
  -- finished. Zero is a red flag a reviewer should see immediately.
  (select count(*) from backtest_results b
     where b.strategy_version_id = v.id and b.status = 'completed') as backtest_count,
  (select max(b.completed_at) from backtest_results b
     where b.strategy_version_id = v.id and b.status = 'completed') as latest_backtest_at,
  (select count(*) from proposal_comments c where c.proposal_id = p.id) as comment_count
from strategy_proposals p
join strategies      s  on s.id = p.strategy_id
join strategy_versions v on v.id = p.head_version_id
join app_users       ru on ru.id = p.requested_by
where p.status = 'open';

-- ---------------------------------------------------------------------------
-- The proposal timeline: versions, backtests and comments interleaved by time.
--
-- Three typed tables unioned for display, rather than one polymorphic event
-- table — keeps "diff two versions" and "index backtests by version" as real
-- queries instead of jsonb digging.
-- ---------------------------------------------------------------------------
create view proposal_timeline as
  -- version pushed
  select
    p.id            as proposal_id,
    v.created_at    as occurred_at,
    'version'::text as kind,
    v.created_by    as actor_id,
    v.id            as ref_id,
    jsonb_build_object(
      'version_number', v.version_number,
      'change_summary', v.change_summary,
      'is_head',        (v.id = p.head_version_id)
    )               as payload
  from strategy_proposals p
  join strategy_versions v on v.strategy_id = p.strategy_id
  where v.created_at >= p.requested_at or v.id = p.head_version_id

union all
  -- backtest completed against a version of this strategy
  select
    p.id,
    b.completed_at,
    'backtest',
    b.owner_id,
    b.id,
    jsonb_build_object(
      'strategy_version_id', b.strategy_version_id,
      'status',              b.status,
      'metrics',             b.metrics
    )
  from strategy_proposals p
  join strategy_versions v on v.strategy_id = p.strategy_id
  join backtest_results  b on b.strategy_version_id = v.id
  where b.completed_at is not null

union all
  -- comment, suggestion, or review verdict
  select
    c.proposal_id,
    c.created_at,
    'comment',
    c.author_id,
    c.id,
    jsonb_build_object('body', c.body, 'kind', c.kind)
  from proposal_comments c;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table strategy_proposals enable row level security;
alter table proposal_comments  enable row level security;

create policy proposals_read_all on strategy_proposals
  for select using (auth.role() = 'authenticated');

create policy proposals_insert_own on strategy_proposals
  for insert with check (requested_by = auth.uid());

-- The requester may withdraw or re-point their own open proposal; a lead may act
-- on any of them. Note 0003 enabled RLS on strategy_runs without any write
-- policy, which left it default-deny — this adds the equivalent for runs so an
-- approval performed under a user JWT is not silently blocked.
create policy proposals_update_own_or_lead on strategy_proposals
  for update using (
    requested_by = auth.uid()
    or exists (select 1 from app_users u where u.id = auth.uid() and u.role = 'lead')
  );

create policy runs_write_lead on strategy_runs
  for insert with check (
    exists (select 1 from app_users u where u.id = auth.uid() and u.role = 'lead')
  );

create policy comments_read_all on proposal_comments
  for select using (auth.role() = 'authenticated');

create policy comments_insert_own on proposal_comments
  for insert with check (author_id = auth.uid());
