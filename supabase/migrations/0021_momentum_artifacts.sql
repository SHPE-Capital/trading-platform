-- Momentum dashboard artifacts (P3-1): validated weekly configs (weekly_config.v1)
-- and research results summaries, uploaded by backend jobs.
--
-- Rows are immutable once written (unique per kind + run_id); a re-upload of the
-- same run is rejected by the API. The backend reads and writes with the
-- service-role key. RLS is enabled with no policies, so a user JWT sees nothing.

create table if not exists momentum_artifacts (
  id               uuid primary key default uuid_generate_v4(),
  kind             text not null check (kind in ('weekly_config', 'results_summary')),
  run_id           text not null,
  policy           text check (policy in ('uniform', 'recency', 'similarity')),
  activation_start date,
  activation_end   date,
  payload          jsonb not null,
  created_at       timestamptz not null default now(),
  unique (kind, run_id)
);

create index if not exists momentum_artifacts_kind_created_idx
  on momentum_artifacts (kind, created_at desc);
create index if not exists momentum_artifacts_activation_idx
  on momentum_artifacts (kind, activation_start, activation_end);

alter table momentum_artifacts enable row level security;
