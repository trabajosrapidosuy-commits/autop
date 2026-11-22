-- Additive, staged migration. Do not apply to hosted Supabase without review.
-- Only the generic task_* control plane participates. Six-agent mission claims
-- and local synthetic mission ledger functions are NOT changed.
alter table public.agent_tasks add column if not exists policy_context jsonb;

create or replace function public.approve_agent_task_if_current(
  p_task_id text, p_expected_updated_at timestamptz,
  p_expected_actor text, p_expected_action text, p_expected_context jsonb
) returns boolean
language plpgsql
security definer set search_path = ''
as $$
declare approved_task_id text;
begin
  if p_task_id is null or p_task_id !~ '^task_[0-9]+_[a-z0-9]+$'
     or p_expected_context is null or jsonb_typeof(p_expected_context) <> 'object'
     or p_expected_updated_at is null then return false; end if;
  -- Optimistic concurrency + row-lock serialization. The service-layer has
  -- already re-evaluated policy against this exact stored snapshot.
  update public.agent_tasks
    set status='queued', updated_at=clock_timestamp()
    where id=p_task_id and status='awaiting_approval'
      and updated_at=p_expected_updated_at
      and actor=p_expected_actor and action=p_expected_action
      and policy_context=p_expected_context
    returning id into approved_task_id;
  if approved_task_id is null then return false; end if;
  -- Same SQL transaction: no successful approval without an audit entry.
  insert into public.agent_audit_events(task_id,event_type,details,created_at)
    values (approved_task_id,'TASK_APPROVED',
      jsonb_build_object('approvedBy','human','principal','admin'),clock_timestamp());
  return true;
end;
$$;

revoke all on function public.approve_agent_task_if_current(
  text,timestamptz,text,text,jsonb) from public;
do $$
begin
  if exists (select from pg_roles where rolname='anon') then
    execute 'revoke all on function public.approve_agent_task_if_current(text,timestamptz,text,text,jsonb) from anon';
  end if;
  if exists (select from pg_roles where rolname='authenticated') then
    execute 'revoke all on function public.approve_agent_task_if_current(text,timestamptz,text,text,jsonb) from authenticated';
  end if;
  if exists (select from pg_roles where rolname='service_role') then
    execute 'grant execute on function public.approve_agent_task_if_current(text,timestamptz,text,text,jsonb) to service_role';
  end if;
end;
$$;
