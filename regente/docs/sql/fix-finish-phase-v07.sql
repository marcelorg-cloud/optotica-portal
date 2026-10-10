-- Correction for an existing manually applied v0.7 schema.
-- Replaces only the finish function; does not modify business rows.
begin;
create or replace function public.regent_finish_phase(
  p_task_id uuid,p_execution_id uuid,p_invocation_id uuid,p_step integer,p_revision integer,
  p_status text,p_artifact jsonb,p_report jsonb,p_error jsonb default null,p_recovered boolean default false
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.regent_tasks%rowtype; phase_status text; v_next_action text; done integer; total integer;
begin
  if auth.uid() is null or p_execution_id is null or p_invocation_id is null or p_step is null or p_revision is null or p_status is null then raise exception 'invalid_execution_identity'; end if;
  if not exists(select 1 from public.system_admins where user_id=auth.uid() and active and role='master_admin') then raise exception 'forbidden'; end if;
  select * into t from public.regent_tasks where id=p_task_id and user_id=auth.uid() for update;
  if not found or t.status<>'executing' or t.execution_id is distinct from p_execution_id or t.execution_invocation_id is distinct from p_invocation_id then raise exception 'stale_execution'; end if;
  if p_status not in ('succeeded','skipped','failed','blocked') then raise exception 'invalid_phase_status'; end if;
  if t.human_decision->>'approval_scope' is distinct from 'single_phase' or
    coalesce(t.human_decision->'approved_steps','[]'::jsonb) <> jsonb_build_array(p_step) then raise exception 'phase_not_authorized'; end if;
  if not exists(select 1 from public.regent_task_steps where task_id=t.id and user_id=auth.uid() and step_number=p_step and revision=p_revision and status='running') then raise exception 'phase_revision_conflict'; end if;
  if p_status in ('succeeded','skipped') and (p_artifact is null or p_report is null or
    (p_report->>'step')::integer is distinct from p_step or (p_report->>'revision')::integer is distinct from p_revision)
    then raise exception 'phase_report_stale'; end if;
  phase_status:=case when p_status in ('succeeded','skipped') then 'awaiting_validation' else p_status end;
  v_next_action:=case when phase_status='awaiting_validation' then 'Revise os outputs da fase '||p_step||' e escolha continuar ou refazer.' else coalesce(p_error->>'action','Resolver o bloqueio indicado e retomar somente esta fase.') end;
  update public.regent_task_steps set status=p_status,artifact=coalesce(p_artifact,artifact),
    last_error=p_error,recovered_at=case when p_recovered then now() else recovered_at end,
    next_action=v_next_action,completed_at=now(),updated_at=now() where task_id=t.id and user_id=auth.uid() and step_number=p_step;
  select count(*) filter(where status in ('succeeded','skipped')),count(*) into done,total from public.regent_task_steps where task_id=t.id and user_id=auth.uid();
  update public.regent_tasks set status=phase_status,phase_report=p_report,control_revision=control_revision+1,
    current_step=p_step,progress_percent=case when total>0 then round(done*100.0/total)::integer else 0 end,
    next_action=v_next_action,blocked_reason=case when phase_status in ('failed','blocked') then v_next_action else null end,last_error=p_error,
    execution_invocation_id=null,execution_lease_until=null,updated_at=now() where id=t.id and user_id=auth.uid();
  insert into public.regent_task_events(task_id,user_id,event_type,payload) values(t.id,auth.uid(),
    case when phase_status='awaiting_validation' then 'phase_awaiting_validation' else 'phase_blocked' end,
    jsonb_build_object('step',p_step,'revision',p_revision,'status',phase_status,'report',p_report,'error',p_error));
  return jsonb_build_object('taskId',t.id,'status',phase_status,'controlRevision',t.control_revision+1,'message',v_next_action);
end $$;
revoke all on function public.regent_finish_phase(uuid,uuid,uuid,integer,integer,text,jsonb,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.regent_finish_phase(uuid,uuid,uuid,integer,integer,text,jsonb,jsonb,jsonb,boolean) to authenticated;

commit;
