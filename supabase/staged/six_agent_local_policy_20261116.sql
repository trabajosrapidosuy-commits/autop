-- Disposable local synthetic lab only. No hosted migration or new ledger.
-- The existing mission input holds a monotonic host policy; checkpoints stay intact.
create function public.local_mission_policy_valid(p_input jsonb,p_id text,p_grant jsonb) returns boolean
language sql volatile set search_path='' as $$
 select coalesce(jsonb_typeof(p_grant)='object'
   and p_input->'local_authorization'=jsonb_build_object('active',true,'grant',p_grant)
   and p_grant->>'missionId'=p_id and p_grant->>'phase'='F0'
   and p_input->>'host_binding'=p_grant->>'binding'
   and p_input->'objective'=p_grant->'objective'
   and p_input->>'goal_version'=p_grant->>'goalVersion'
   and clock_timestamp()<to_timestamp((p_grant->>'expiresAt')::double precision/1000),false);
$$;

create function public.local_mission_policy_write_guard() returns trigger
language plpgsql set search_path='' as $$
begin
 if (old.input ? 'local_authorization') or (new.input ? 'local_authorization') then
  if old.input->'local_authorization' is distinct from new.input->'local_authorization' then
   if current_setting('autopilot.policy_admin',true) is distinct from '1'
     or (to_jsonb(old)-'input') is distinct from (to_jsonb(new)-'input')
     or (old.input-'local_authorization') is distinct from (new.input-'local_authorization')
     then raise exception 'policy_admin_required'; end if;
  elsif not public.local_mission_policy_valid(old.input,old.id,
     nullif(current_setting('autopilot.policy_grant',true),'')::jsonb) then
   raise exception 'durable_policy_denied';
  end if;
 end if;
 return new;
end $$;
create trigger local_mission_policy_write_guard before update on public.agent_tasks
for each row execute function public.local_mission_policy_write_guard();

create function public.local_mission_authorize(p_id text,p_binding text,p_grant jsonb,p_expected_revision integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare task public.agent_tasks%rowtype; revision integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'unauthorized'; end if;
 select * into task from public.agent_tasks t where t.id=p_id and t.actor='autopilot-local-cli'
   and t.input->>'host_binding'=p_binding
   and exists(select 1 from public.autopilot_local_lab where binding=p_binding) for update;
 if not found then raise exception 'policy_scope_mismatch'; end if;
 revision=coalesce((task.input->'local_authorization'->'grant'->>'revision')::integer,0);
 if p_expected_revision is null or p_expected_revision<>revision then return false; end if;
 if jsonb_typeof(p_grant) is distinct from 'object' or task.status in ('completed','cancelled','blocked')
   or task.mission_id is distinct from p_id or task.agent_id is distinct from 'software'
   or task.goal is distinct from 'Verify synthetic mission recovery'
   or task.input->>'mission_schema_version' is distinct from '1' or task.input->>'goal_version' is distinct from '1'
   or p_grant->>'missionId' is distinct from p_id or p_grant->>'binding' is distinct from p_binding
   or p_grant->>'phase' is distinct from 'F0' or p_grant->>'goalVersion' is distinct from '1'
   or p_grant->'objective' is distinct from task.input->'objective'
   or coalesce(p_grant->>'id','') !~ '^[a-z][a-z0-9-]{2,79}$'
   or coalesce(p_grant->>'executorId','') !~ '^[a-zA-Z0-9._:-]{1,80}$'
   or (p_grant->>'revision')::integer is distinct from revision+1
   or (p_grant->>'expiresAt')::double precision/1000<=extract(epoch from clock_timestamp())
   or (p_grant->>'expiresAt')::double precision/1000>extract(epoch from clock_timestamp())+60
   or p_grant->>'expiresAt' is null
   then raise exception 'invalid_durable_policy'; end if;
 if p_grant ? 'recovery' then
  if p_grant->>'recovery' not in ('ready_to_complete','reconcile_effect') or p_grant->>'recovery' is null or task.status<>'running'
    or task.mission_checkpoint->>'mission_state' is distinct from
      (case when p_grant->>'recovery'='ready_to_complete' then 'ready_to_complete' else 'in_progress' end)
    or task.lease_until is null or task.lease_until>=clock_timestamp() or task.attempt_count>=task.max_attempts
    or task.execution_token is null
    or p_grant->>'checkpointVersion' is distinct from task.mission_checkpoint_version::text
    or p_grant->>'planVersion' is distinct from coalesce(task.input->>'plan_version','0')
    or (p_grant->>'recovery'='reconcile_effect' and (task.mission_checkpoint_version<>2
      or task.input->>'plan_version' is distinct from '1'
      or task.mission_checkpoint->>'current_step_id' is distinct from 'modify-v1'
      or task.mission_checkpoint->'completed_steps' is distinct from '["prepare-v1"]'::jsonb))
    then raise exception 'recovery_policy_denied'; end if;
 elsif p_grant->>'checkpointVersion' is distinct from '0' or p_grant->>'planVersion' is distinct from '0'
   or (revision=0 and (task.status<>'queued' or task.attempt_count<>0)) then raise exception 'invalid_durable_policy';
 end if;
 perform set_config('autopilot.policy_admin','1',true);
 update public.agent_tasks set input=jsonb_set(input,'{local_authorization}',jsonb_build_object('active',true,'grant',p_grant)) where id=p_id;
 insert into public.agent_audit_events(task_id,event_type,details) values(p_id,'policy_authorized',jsonb_build_object('revision',revision+1));
 return true;
end $$;

create function public.local_mission_revoke(p_id text,p_binding text,p_expected_revision integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare task public.agent_tasks%rowtype; policy jsonb; revision integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'unauthorized'; end if;
 select * into task from public.agent_tasks t where t.id=p_id and t.actor='autopilot-local-cli'
   and t.input->>'host_binding'=p_binding
   and exists(select 1 from public.autopilot_local_lab where binding=p_binding) for update;
 if not found then raise exception 'policy_scope_mismatch'; end if;
 policy=task.input->'local_authorization';revision=(policy->'grant'->>'revision')::integer;
 if p_expected_revision is null or revision is distinct from p_expected_revision then return false; end if;
 perform set_config('autopilot.policy_admin','1',true);
 policy=jsonb_set(jsonb_set(policy,'{active}','false'),'{grant,revision}',to_jsonb(revision+1));
 update public.agent_tasks set input=jsonb_set(input,'{local_authorization}',policy) where id=p_id;
 insert into public.agent_audit_events(task_id,event_type,details) values(p_id,'policy_revoked',jsonb_build_object('revision',revision+1));
 return true;
end $$;
revoke all on function public.local_mission_policy_valid(jsonb,text,jsonb) from public,anon,authenticated;
revoke all on function public.local_mission_policy_write_guard() from public,anon,authenticated;
revoke all on function public.local_mission_authorize(text,text,jsonb,integer) from public,anon,authenticated;
revoke all on function public.local_mission_revoke(text,text,integer) from public,anon,authenticated;
grant execute on function public.local_mission_policy_valid(jsonb,text,jsonb) to service_role;
grant execute on function public.local_mission_authorize(text,text,jsonb,integer) to service_role;
grant execute on function public.local_mission_revoke(text,text,integer) to service_role;
