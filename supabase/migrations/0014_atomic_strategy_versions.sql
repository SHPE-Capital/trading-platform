-- Save the mutable latest-config pointer and its immutable audit version in one
-- database transaction. Serializing on the strategies row also makes the
-- per-strategy version-number trigger safe when two edits arrive together.

create function save_strategy_version(
  p_strategy uuid,
  p_name text,
  p_config jsonb,
  p_change_summary text,
  p_created_by uuid
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  saved strategy_versions;
  attached_proposal uuid;
begin
  perform 1 from strategies where id = p_strategy for update;
  if not found then
    raise exception 'Strategy % not found', p_strategy;
  end if;

  update strategies
     set name = p_name, config = p_config, updated_at = now()
   where id = p_strategy;

  insert into strategy_versions (strategy_id, config, change_summary, created_by)
  values (p_strategy, p_config, p_change_summary, p_created_by)
  returning * into saved;

  update strategy_proposals
     set head_version_id = saved.id, updated_at = now()
   where id = (
     select id from strategy_proposals
      where strategy_id = p_strategy and status = 'open'
      limit 1
      for update)
  returning id into attached_proposal;

  return to_jsonb(saved) || jsonb_build_object('attached_to_proposal_id', attached_proposal);
end;
$$;

revoke execute on function save_strategy_version(uuid, text, jsonb, text, uuid)
  from public, anon, authenticated;
grant execute on function save_strategy_version(uuid, text, jsonb, text, uuid)
  to service_role;
