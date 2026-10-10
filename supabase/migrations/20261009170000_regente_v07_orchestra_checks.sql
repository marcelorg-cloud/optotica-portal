begin;

alter table public.regent_tasks add column if not exists engine_version text not null default '0.6.3';
alter table public.regent_tasks alter column engine_version set default '0.7.0';
alter table public.regent_tasks add column if not exists control_revision integer not null default 0;
alter table public.regent_tasks add column if not exists phase_report jsonb;
alter table public.regent_tasks add column if not exists validated_steps integer[] not null default '{}';
alter table public.regent_tasks add column if not exists workflow_run_id text;
alter table public.regent_tasks drop constraint regent_tasks_status_check;
alter table public.regent_tasks add constraint regent_tasks_status_check check
  (status in ('draft','planning','awaiting_approval','approved','executing','awaiting_validation','succeeded','failed','rejected','needs_revision','blocked'));
alter table public.regent_task_steps add column if not exists revision integer not null default 1;
alter table public.regent_task_steps add column if not exists validated_at timestamptz;
alter table public.regent_task_steps add column if not exists recovered_at timestamptz;
alter table public.regent_task_steps add column if not exists revision_guidance text;

create table if not exists public.regent_orchestra_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  depth text not null check (depth in ('basic','deep')),
  status text not null check (status in ('healthy','attention')),
  report jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists regent_orchestra_checks_user_created_idx on public.regent_orchestra_checks(user_id,created_at desc);
alter table public.regent_orchestra_checks enable row level security;
grant select,insert on public.regent_orchestra_checks to authenticated;
create policy regent_orchestra_checks_select_own on public.regent_orchestra_checks for select to authenticated using ((select auth.uid())=user_id);
create policy regent_orchestra_checks_insert_own on public.regent_orchestra_checks for insert to authenticated with check ((select auth.uid())=user_id);

create table if not exists public.regent_phase_reviews (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.regent_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  step_number integer not null check(step_number>0),
  revision integer not null check(revision>0),
  decision text not null,
  note text,
  output jsonb,
  created_at timestamptz not null default now()
);
create index if not exists regent_phase_reviews_owner_task_idx on public.regent_phase_reviews(user_id,task_id,step_number,created_at desc);
create index if not exists regent_phase_reviews_task_idx on public.regent_phase_reviews(task_id);
alter table public.regent_phase_reviews enable row level security;
grant select,insert on public.regent_phase_reviews to authenticated;
create policy regent_phase_reviews_select_own on public.regent_phase_reviews for select to authenticated using ((select auth.uid())=user_id);
create policy regent_phase_reviews_insert_own on public.regent_phase_reviews for insert to authenticated with check
  ((select auth.uid())=user_id and exists(select 1 from public.regent_tasks t where t.id=task_id and t.user_id=(select auth.uid())));

-- Row-lock, RLS and revision checking make a double click or stale browser harmless.
-- SECURITY INVOKER is deliberate: this function never elevates an operator's privileges.
create or replace function public.regent_decide_phase(
  p_task_id uuid,p_expected_revision integer,p_decision text,p_note text default '',p_step integer default null,p_phase_patch jsonb default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  t public.regent_tasks%rowtype;
  s public.regent_task_steps%rowtype;
  chosen integer; unresolved integer[]; affected integer[]; new_status text; decision_payload jsonb; old_phase jsonb;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not exists(select 1 from public.system_admins where user_id=auth.uid() and active and role='master_admin') then raise exception 'forbidden'; end if;
  if p_expected_revision is null or p_expected_revision<0 or p_decision is null then raise exception 'invalid_decision'; end if;
  select * into t from public.regent_tasks where id=p_task_id and user_id=auth.uid() for update;
  if not found then raise exception 'task_not_found'; end if;
  if t.control_revision<>p_expected_revision then raise exception 'revision_conflict'; end if;
  if p_decision not in ('execute','partial','continue','redo','skip','reject','revise','recover') then raise exception 'invalid_decision'; end if;
  if length(coalesce(p_note,''))>8000 then raise exception 'note_too_long'; end if;
  if p_phase_patch is not null and (p_decision<>'redo' or jsonb_typeof(p_phase_patch)<>'object' or
    jsonb_typeof(p_phase_patch->'nodes') is distinct from 'array' or jsonb_array_length(p_phase_patch->'nodes')<>1 or
    p_phase_patch->'nodes'->>0 is null or p_phase_patch->'nodes'->>0 not in ('A1','A2','A3','A4','A5','A6','F9','F6') or
    exists(select 1 from jsonb_object_keys(p_phase_patch) k where k not in ('nodes','canvaMode','canvaSourceRunIds','canvaDesignIds')))
    then raise exception 'invalid_phase_patch'; end if;
  if p_phase_patch->'nodes'->>0='F6' and (p_phase_patch->>'canvaMode' is null or p_phase_patch->>'canvaMode' not in ('inspect','create')) then raise exception 'invalid_phase_patch'; end if;
  if p_phase_patch->'nodes'->>0='F6' and p_phase_patch->>'canvaMode'='inspect' then
    if jsonb_typeof(p_phase_patch->'canvaSourceRunIds') is distinct from 'array' or jsonb_typeof(p_phase_patch->'canvaDesignIds') is distinct from 'array' then raise exception 'invalid_phase_patch'; end if;
    if jsonb_array_length(p_phase_patch->'canvaSourceRunIds') not between 1 and 20 or jsonb_array_length(p_phase_patch->'canvaDesignIds') not between 1 and 10 then raise exception 'invalid_phase_patch'; end if;
  end if;
  if t.status in ('draft','planning') then raise exception 'task_not_ready'; end if;
  if t.status in ('rejected','succeeded') and p_decision not in ('redo','reject') then raise exception 'task_closed'; end if;

  if t.status='executing' then
    if p_decision<>'recover' or
       (t.execution_lease_until is not null and t.execution_lease_until>now()) or
       (t.execution_lease_until is null and t.updated_at>now()-interval '15 minutes')
      then raise exception 'execution_active'; end if;
    -- The old execution is fenced out, without claiming any external operation succeeded.
    update public.regent_task_steps set status='prepared',next_action='Invocação expirada; conferir outputs antes de repetir.',updated_at=now()
      where task_id=t.id and user_id=auth.uid() and status in ('running','review');
  elsif p_decision='recover' then
    raise exception 'recovery_not_required';
  end if;

  if p_decision in ('reject','revise') then
    new_status:=case when p_decision='reject' then 'rejected' else 'needs_revision' end;
    update public.regent_tasks set status=new_status,control_revision=control_revision+1,
      execution_id=null,execution_invocation_id=null,execution_lease_until=null,
      next_action=case when p_decision='reject' then 'Missão encerrada pelo operador; outputs preservados.' else 'Revisar a orientação, sem apagar outputs ou checkpoints.' end,
      updated_at=now() where id=t.id and user_id=auth.uid();
    insert into public.regent_task_events(task_id,user_id,event_type,payload) values
      (t.id,auth.uid(),'human_'||p_decision,jsonb_build_object('note',p_note,'outputsPreserved',true));
    return jsonb_build_object('taskId',t.id,'status',new_status,'controlRevision',t.control_revision+1,'message','Decisão registrada; outputs preservados.');
  end if;

  if p_decision='continue' then
    if t.phase_report is null then raise exception 'phase_validation_required'; end if;
    chosen:=(t.phase_report->>'step')::integer;
    if chosen is null or chosen<1 or nullif(t.phase_report->>'revision','') is null then raise exception 'phase_report_stale'; end if;
    if p_step is not null and p_step<>chosen then raise exception 'next_phase_only'; end if;
    select * into s from public.regent_task_steps where task_id=t.id and user_id=auth.uid() and step_number=chosen;
    if not found or s.status not in ('succeeded','skipped') or s.revision is distinct from (t.phase_report->>'revision')::integer then raise exception 'phase_report_stale'; end if;
    update public.regent_task_steps set validated_at=now(),updated_at=now() where task_id=t.id and user_id=auth.uid() and step_number=chosen;
    insert into public.regent_phase_reviews(task_id,user_id,step_number,revision,decision,note,output)
      values(t.id,auth.uid(),chosen,s.revision,'accepted',p_note,s.artifact);
    update public.regent_tasks set validated_steps=array(select distinct unnest(validated_steps||array[chosen]) order by 1)
      where id=t.id and user_id=auth.uid();
  elsif t.phase_report is not null and p_decision<>'redo' then
    raise exception 'phase_validation_required';
  end if;

  if p_decision='redo' then
    if nullif(trim(p_note),'') is null then raise exception 'guidance_required'; end if;
    chosen:=coalesce(p_step,(t.phase_report->>'step')::integer,t.current_step);
    if t.phase_report is not null and chosen is distinct from (t.phase_report->>'step')::integer then raise exception 'phase_validation_required'; end if;
    if chosen is null or not exists(select 1 from public.regent_task_steps where task_id=t.id and user_id=auth.uid() and step_number=chosen) then raise exception 'phase_not_found'; end if;
    with recursive descendants(step_number) as (
      select chosen
      union
      select r.step_number from public.regent_task_steps r join descendants d on d.step_number=any(r.depends_on)
        where r.task_id=t.id and r.user_id=auth.uid()
    ) select array_agg(step_number order by step_number) into affected from descendants;
    insert into public.regent_phase_reviews(task_id,user_id,step_number,revision,decision,note,output)
      select task_id,user_id,step_number,revision,'superseded',p_note,artifact from public.regent_task_steps
        where task_id=t.id and user_id=auth.uid() and step_number=any(affected) and artifact is not null;
    update public.regent_task_steps set revision=revision+1,status=case when step_number=chosen then 'prepared' else 'planned' end,
      validated_at=null,recovered_at=null,artifact=null,last_error=null,completed_at=null,
      revision_guidance=case when step_number=chosen then p_note else revision_guidance end,
      next_action=case when step_number=chosen then 'Refazer somente esta fase com a nova orientação.' else 'Dependência revisada; output anterior preservado no histórico.' end,
      updated_at=now() where task_id=t.id and user_id=auth.uid() and step_number=any(affected);
    update public.regent_tasks set validated_steps=array(select unnest(validated_steps) except select unnest(affected))
      where id=t.id and user_id=auth.uid();
    if p_phase_patch is not null then
      select p into old_phase from jsonb_array_elements(t.pipeline) p where (p->>'step')::integer=chosen;
      if old_phase is null then raise exception 'phase_not_found'; end if;
      if p_phase_patch->'nodes'->>0<>'F6' then p_phase_patch:=jsonb_build_object('nodes',p_phase_patch->'nodes'); end if;
      update public.regent_tasks set pipeline=(select jsonb_agg(case when (p->>'step')::integer=chosen then
        (p-'canvaMode'-'canvaSourceRunIds'-'canvaDesignIds')||p_phase_patch||jsonb_build_object('checkpoint',true,'requiresApproval',true) else p end order by (p->>'step')::integer)
        from jsonb_array_elements(pipeline) p) where id=t.id and user_id=auth.uid();
      update public.regent_task_steps set node_ids=array(select jsonb_array_elements_text(p_phase_patch->'nodes'))
        where task_id=t.id and user_id=auth.uid() and step_number=chosen;
      insert into public.regent_task_events(task_id,user_id,event_type,payload) values(t.id,auth.uid(),'phase_plan_amended',
        jsonb_build_object('step',chosen,'previousPhase',old_phase,'patch',p_phase_patch,'note',p_note,'humanExplicit',true));
    end if;
  else
    select step_number into chosen from public.regent_task_steps
      where task_id=t.id and user_id=auth.uid() and status not in ('succeeded','skipped') order by step_number limit 1;
  end if;

  if chosen is null then
    if p_decision<>'continue' then raise exception 'final_validation_required'; end if;
    update public.regent_tasks set status='succeeded',phase_report=null,control_revision=control_revision+1,
      current_step=null,progress_percent=100,blocked_reason=null,last_error=null,
      execution_id=null,execution_invocation_id=null,execution_lease_until=null,
      next_action='Todas as fases do escopo foram concluídas e a última foi validada pelo operador.',updated_at=now()
      where id=t.id and user_id=auth.uid();
    insert into public.regent_task_events(task_id,user_id,event_type,payload) values
      (t.id,auth.uid(),'mission_validated',jsonb_build_object('note',p_note,'finalHumanValidation',true));
    return jsonb_build_object('taskId',t.id,'status','succeeded','controlRevision',t.control_revision+1,'message','Missão validada; outputs preservados.');
  end if;

  if p_step is not null and p_decision in ('execute','partial','recover','skip') and p_step<>chosen then raise exception 'next_phase_only'; end if;
  select * into s from public.regent_task_steps where task_id=t.id and user_id=auth.uid() and step_number=chosen;
  select array_agg(dep) into unresolved from unnest(coalesce(s.depends_on,'{}')) dep where not exists (
    select 1 from public.regent_task_steps d where d.task_id=t.id and d.user_id=auth.uid() and d.step_number=dep and d.status in ('succeeded','skipped')
  );
  if cardinality(unresolved)>0 then raise exception 'dependencies_pending:%',unresolved; end if;

  if p_decision='skip' then
    if t.phase_report is not null or nullif(trim(p_note),'') is null then raise exception 'skip_requires_pending_phase_and_reason'; end if;
    if not exists(select 1 from jsonb_array_elements(t.pipeline) p where (p->>'step')::integer=chosen and
      (p->>'onUnavailable'='skip' or p->'nodes' ? 'F9')) then raise exception 'phase_not_optional'; end if;
    update public.regent_task_steps set status='skipped',artifact=jsonb_build_object('deferred',true,'humanSkip',true,'reason',p_note),
      completed_at=now(),next_action='Fase adiada pelo operador, sem execução externa.',updated_at=now()
      where task_id=t.id and user_id=auth.uid() and step_number=chosen;
    update public.regent_tasks set status='awaiting_validation',
      phase_report=jsonb_build_object('kind','phase_checkpoint','step',chosen,'revision',s.revision,'title',s.action,
        'summary','Fase adiada, sem execução externa.','output',jsonb_build_object('deferred',true,'humanSkip',true,'reason',p_note),
        'completedAt',now(),'final',not exists(select 1 from public.regent_task_steps where task_id=t.id and user_id=auth.uid() and status not in ('succeeded','skipped'))),
      control_revision=control_revision+1,current_step=chosen,blocked_reason=null,last_error=null,
      execution_id=null,execution_invocation_id=null,execution_lease_until=null,
      next_action='Validar o adiamento e seguir para a próxima fase.',updated_at=now() where id=t.id and user_id=auth.uid();
    insert into public.regent_task_events(task_id,user_id,event_type,payload) values(t.id,auth.uid(),'human_phase_skipped',jsonb_build_object('step',chosen,'reason',p_note));
    return jsonb_build_object('taskId',t.id,'status','awaiting_validation','controlRevision',t.control_revision+1,'message','Fase adiada; nenhuma ação externa foi executada.');
  end if;

  decision_payload:=jsonb_build_object('decision','partial','requested_decision',p_decision,'note',nullif(p_note,''),
    'decided_at',now(),'approval_scope','single_phase','approved_steps',jsonb_build_array(chosen),
    'approved_pipeline_steps',jsonb_build_array(chosen),'recovery_authorized',t.status in ('failed','blocked','executing'),
    'recovery_steps',jsonb_build_array(chosen),'phase_revision',s.revision,'invalidated_steps',affected);
  update public.regent_task_steps set status='prepared',next_action='Fase autorizada; aguardando execução durável.',last_error=null,updated_at=now()
    where task_id=t.id and user_id=auth.uid() and step_number=chosen and status not in ('succeeded','skipped');
  update public.regent_tasks set status='approved',human_decision=decision_payload,phase_report=null,
    control_revision=control_revision+1,current_step=chosen,blocked_reason=null,last_error=null,
    engine_version='0.7.0',execution_id=null,execution_invocation_id=null,execution_lease_until=null,
    next_action='Executar somente a fase '||chosen||'; depois aguardar validação humana.',updated_at=now()
    where id=t.id and user_id=auth.uid();
  insert into public.regent_task_events(task_id,user_id,event_type,payload) values(t.id,auth.uid(),'human_phase_authorized',decision_payload);
  return jsonb_build_object('taskId',t.id,'status','approved','controlRevision',t.control_revision+1,'step',chosen,
    'invalidatedSteps',affected,'message','Somente a fase '||chosen||' foi autorizada. Outputs anteriores preservados.');
end $$;
revoke all on function public.regent_decide_phase(uuid,integer,text,text,integer,jsonb) from public,anon;
grant execute on function public.regent_decide_phase(uuid,integer,text,text,integer,jsonb) to authenticated;

create or replace function public.regent_begin_phase(
  p_task_id uuid,p_execution_id uuid,p_invocation_id uuid,p_step integer
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.regent_tasks%rowtype; s public.regent_task_steps%rowtype;
begin
  if auth.uid() is null or p_execution_id is null or p_invocation_id is null or p_step is null then raise exception 'invalid_execution_identity'; end if;
  if not exists(select 1 from public.system_admins where user_id=auth.uid() and active and role='master_admin') then raise exception 'forbidden'; end if;
  select * into t from public.regent_tasks where id=p_task_id and user_id=auth.uid() for update;
  if not found or t.status<>'executing' or t.execution_id is distinct from p_execution_id or t.execution_invocation_id is distinct from p_invocation_id then raise exception 'stale_execution'; end if;
  if t.human_decision->>'approval_scope' is distinct from 'single_phase' or
    coalesce(t.human_decision->'approved_steps','[]'::jsonb) <> jsonb_build_array(p_step) then raise exception 'phase_not_authorized'; end if;
  select * into s from public.regent_task_steps where task_id=t.id and user_id=auth.uid() and step_number=p_step;
  if not found or s.status in ('succeeded','skipped') then raise exception 'phase_not_pending'; end if;
  if (t.human_decision->>'phase_revision')::integer is distinct from s.revision then raise exception 'phase_revision_conflict'; end if;
  if t.phase_report is not null then raise exception 'phase_validation_required'; end if;
  if exists(select 1 from unnest(s.depends_on) dep where not exists(
    select 1 from public.regent_task_steps d where d.task_id=t.id and d.user_id=auth.uid() and d.step_number=dep and d.status in ('succeeded','skipped')
  )) then raise exception 'dependencies_pending'; end if;
  update public.regent_task_steps set status='running',attempt_count=attempt_count+1,started_at=coalesce(started_at,now()),
    completed_at=null,next_action='Executando fase '||p_step||'; resultados serão persistidos antes da validação.',updated_at=now()
    where task_id=t.id and user_id=auth.uid() and step_number=p_step;
  update public.regent_tasks set current_step=p_step,execution_lease_until=now()+interval '810 seconds',updated_at=now()
    where id=t.id and user_id=auth.uid();
  return jsonb_build_object('revision',s.revision,'attempt',s.attempt_count+1);
end $$;
revoke all on function public.regent_begin_phase(uuid,uuid,uuid,integer) from public,anon;
grant execute on function public.regent_begin_phase(uuid,uuid,uuid,integer) to authenticated;

create or replace function public.regent_finish_phase(
  p_task_id uuid,p_execution_id uuid,p_invocation_id uuid,p_step integer,p_revision integer,
  p_status text,p_artifact jsonb,p_report jsonb,p_error jsonb default null,p_recovered boolean default false
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.regent_tasks%rowtype; phase_status text; action text; done integer; total integer;
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
  action:=case when phase_status='awaiting_validation' then 'Revise os outputs da fase '||p_step||' e escolha continuar ou refazer.' else coalesce(p_error->>'action','Resolver o bloqueio indicado e retomar somente esta fase.') end;
  update public.regent_task_steps set status=p_status,artifact=coalesce(p_artifact,artifact),
    last_error=p_error,recovered_at=case when p_recovered then now() else recovered_at end,
    next_action=action,completed_at=now(),updated_at=now() where task_id=t.id and user_id=auth.uid() and step_number=p_step;
  select count(*) filter(where status in ('succeeded','skipped')),count(*) into done,total from public.regent_task_steps where task_id=t.id and user_id=auth.uid();
  update public.regent_tasks set status=phase_status,phase_report=p_report,control_revision=control_revision+1,
    current_step=p_step,progress_percent=case when total>0 then round(done*100.0/total)::integer else 0 end,
    next_action=action,blocked_reason=case when phase_status in ('failed','blocked') then action else null end,last_error=p_error,
    execution_invocation_id=null,execution_lease_until=null,updated_at=now() where id=t.id and user_id=auth.uid();
  insert into public.regent_task_events(task_id,user_id,event_type,payload) values(t.id,auth.uid(),
    case when phase_status='awaiting_validation' then 'phase_awaiting_validation' else 'phase_blocked' end,
    jsonb_build_object('step',p_step,'revision',p_revision,'status',phase_status,'report',p_report,'error',p_error));
  return jsonb_build_object('taskId',t.id,'status',phase_status,'controlRevision',t.control_revision+1,'message',action);
end $$;
revoke all on function public.regent_finish_phase(uuid,uuid,uuid,integer,integer,text,jsonb,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.regent_finish_phase(uuid,uuid,uuid,integer,integer,text,jsonb,jsonb,jsonb,boolean) to authenticated;

commit;

