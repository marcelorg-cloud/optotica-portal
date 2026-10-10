-- Production-safe integration fixture: no API calls, no business-task mutations.
-- Run only after the v0.7 migration. Every inserted row and decision is rolled back.
begin;
select set_config('request.jwt.claims', jsonb_build_object('sub',user_id,'role','authenticated')::text,true)
  from public.system_admins where active and role='master_admin' order by created_at limit 1;
set local role authenticated;
do $$
declare
  v_owner_id uuid:=auth.uid(); v_session_id uuid; v_task_id uuid; v_exec_id uuid; v_inv_id uuid;
  v_rev integer; result jsonb; v_secret_count integer;
begin
  if v_owner_id is null then raise exception 'fixture_requires_existing_master'; end if;
  insert into public.regent_sessions(user_id,title) values(v_owner_id,'[rollback test] Regente 0.7') returning id into v_session_id;
  insert into public.regent_tasks(user_id,session_id,title,objective,status,pipeline)
    values(v_owner_id,v_session_id,'[rollback test] phase gates','No external execution','awaiting_approval',
      '[{"step":1,"nodes":["A5"]},{"step":2,"nodes":["A1"]},{"step":3,"nodes":["A3"]},{"step":4,"nodes":["F9"],"onUnavailable":"skip"}]') returning id into v_task_id;
  insert into public.regent_task_steps(task_id,user_id,step_number,role,node_ids,action,status,depends_on)
    values(v_task_id,v_owner_id,1,'reference',array['A5'],'Preflight','prepared','{}'),
      (v_task_id,v_owner_id,2,'creation',array['A1'],'Draft','planned',array[1]),
      (v_task_id,v_owner_id,3,'validation',array['A3'],'Review','planned',array[2]),
      (v_task_id,v_owner_id,4,'creation',array['F9'],'Optional WhatsApp','planned',array[3]);
  begin
    perform public.regent_decide_phase(v_task_id,null,'execute','',1);
    raise exception 'test_failed:null_revision_accepted';
  exception when others then if sqlerrm not like 'invalid_decision%' then raise; end if; end;
  begin
    perform public.regent_decide_phase(v_task_id,0,'execute','',2);
    raise exception 'test_failed:wrong_phase_accepted';
  exception when others then if sqlerrm not like 'next_phase_only%' then raise; end if; end;
  result:=public.regent_decide_phase(v_task_id,0,'execute','',1);
  if result->>'status'<>'approved' then raise exception 'test_failed:initial_approval'; end if;
  begin
    perform public.regent_decide_phase(v_task_id,0,'execute','',1);
    raise exception 'test_failed:double_click_accepted';
  exception when others then if sqlerrm not like 'revision_conflict%' then raise; end if; end;

  v_exec_id:=gen_random_uuid(); v_inv_id:=gen_random_uuid();
  update public.regent_tasks set status='executing',execution_id=v_exec_id,execution_invocation_id=v_inv_id where id=v_task_id and user_id=v_owner_id;
  begin
    perform public.regent_begin_phase(v_task_id,gen_random_uuid(),v_inv_id,1);
    raise exception 'test_failed:stale_begin_accepted';
  exception when others then if sqlerrm not like 'stale_execution%' then raise; end if; end;
  perform public.regent_begin_phase(v_task_id,v_exec_id,v_inv_id,1);
  begin
    perform public.regent_finish_phase(v_task_id,v_exec_id,v_inv_id,1,1,'succeeded','{"result":"fixture"}',null);
    raise exception 'test_failed:missing_report_accepted';
  exception when others then if sqlerrm not like 'phase_report_stale%' then raise; end if; end;
  result:=public.regent_finish_phase(v_task_id,v_exec_id,v_inv_id,1,1,'succeeded','{"result":"fixture"}','{"step":1,"revision":1}');
  if result->>'status'<>'awaiting_validation' then raise exception 'test_failed:validation_gate'; end if;
  select control_revision into v_rev from public.regent_tasks where id=v_task_id;
  perform public.regent_decide_phase(v_task_id,v_rev,'revise','Inspect the preserved output',1);
  select control_revision into v_rev from public.regent_tasks where id=v_task_id;
  begin
    perform public.regent_decide_phase(v_task_id,v_rev,'execute','',2);
    raise exception 'test_failed:revise_bypassed_validation';
  exception when others then if sqlerrm not like 'phase_validation_required%' then raise; end if; end;
  result:=public.regent_decide_phase(v_task_id,v_rev,'continue','Output reviewed',1);
  if (result->>'step')::integer<>2 then raise exception 'test_failed:next_phase'; end if;

  -- Two known outputs, produced without external APIs for dependency-version tests.
  for v_secret_count in 2..3 loop
    v_exec_id:=gen_random_uuid(); v_inv_id:=gen_random_uuid();
    update public.regent_tasks set status='executing',execution_id=v_exec_id,execution_invocation_id=v_inv_id where id=v_task_id and user_id=v_owner_id;
    perform public.regent_begin_phase(v_task_id,v_exec_id,v_inv_id,v_secret_count);
    perform public.regent_finish_phase(v_task_id,v_exec_id,v_inv_id,v_secret_count,1,'succeeded',
      jsonb_build_object('result','Fixture '||v_secret_count),jsonb_build_object('step',v_secret_count,'revision',1));
    select control_revision into v_rev from public.regent_tasks where id=v_task_id;
    perform public.regent_decide_phase(v_task_id,v_rev,'continue','Fixture accepted',v_secret_count);
  end loop;
  select control_revision into v_rev from public.regent_tasks where id=v_task_id;
  result:=public.regent_decide_phase(v_task_id,v_rev,'redo','Use this persistent guidance',2);
  if result->'invalidatedSteps'<>'[2,3,4]'::jsonb then raise exception 'test_failed:transitive_invalidation'; end if;
  if (select count(*) from public.regent_phase_reviews r where r.task_id=v_task_id and user_id=v_owner_id and decision='superseded')<>2 then raise exception 'test_failed:historic_outputs_not_preserved'; end if;
  if not exists(select 1 from public.regent_task_steps s where s.task_id=v_task_id and s.step_number=1 and s.status='succeeded' and s.validated_at is not null) then raise exception 'test_failed:unrelated_checkpoint_changed'; end if;
  v_exec_id:=gen_random_uuid(); v_inv_id:=gen_random_uuid();
  update public.regent_tasks set status='executing',execution_id=v_exec_id,execution_invocation_id=v_inv_id where id=v_task_id and user_id=v_owner_id;
  perform public.regent_begin_phase(v_task_id,v_exec_id,v_inv_id,2);
  perform public.regent_finish_phase(v_task_id,v_exec_id,v_inv_id,2,2,'blocked',null,null,'{"action":"fixture retry"}');
  select control_revision into v_rev from public.regent_tasks where id=v_task_id;
  begin
    perform public.regent_decide_phase(v_task_id,v_rev,'skip','not optional',2);
    raise exception 'test_failed:required_phase_skipped';
  exception when others then if sqlerrm not like 'phase_not_optional%' then raise; end if; end;
  perform public.regent_decide_phase(v_task_id,v_rev,'execute','Resume same revision',2);
  if not exists(select 1 from public.regent_task_steps s where s.task_id=v_task_id and s.step_number=2 and s.revision=2 and s.revision_guidance='Use this persistent guidance') then raise exception 'test_failed:redo_guidance_lost'; end if;

  v_exec_id:=gen_random_uuid(); v_inv_id:=gen_random_uuid();
  update public.regent_tasks set status='executing',execution_id=v_exec_id,execution_invocation_id=v_inv_id,execution_lease_until=now()+interval '10 minutes' where id=v_task_id and user_id=v_owner_id;
  select control_revision into v_rev from public.regent_tasks where id=v_task_id;
  begin
    perform public.regent_decide_phase(v_task_id,v_rev,'recover','',2);
    raise exception 'test_failed:live_lock_recovered';
  exception when others then if sqlerrm not like 'execution_active%' then raise; end if; end;
  update public.regent_tasks set execution_lease_until=now()-interval '1 minute' where id=v_task_id and user_id=v_owner_id;
  perform public.regent_decide_phase(v_task_id,v_rev,'recover','Recover expired invocation',2);
  begin
    perform public.regent_finish_phase(v_task_id,v_exec_id,v_inv_id,2,2,'succeeded','{"result":"stale"}','{"step":2,"revision":2}');
    raise exception 'test_failed:stale_finish_accepted';
  exception when others then if sqlerrm not like 'stale_execution%' then raise; end if; end;

  select control_revision into v_rev from public.regent_tasks where id=v_task_id;
  perform public.regent_decide_phase(v_task_id,v_rev,'redo','Human-configured independent review',2,'{"nodes":["A4"]}');
  if not exists(select 1 from public.regent_task_steps s where s.task_id=v_task_id and s.step_number=2 and s.node_ids=array['A4']) then raise exception 'test_failed:human_patch_not_persisted'; end if;
  if not exists(select 1 from public.regent_task_events e where e.task_id=v_task_id and e.event_type='phase_plan_amended') then raise exception 'test_failed:plan_history_missing'; end if;
  for v_secret_count in 2..3 loop
    v_exec_id:=gen_random_uuid(); v_inv_id:=gen_random_uuid();
    update public.regent_tasks set status='executing',execution_id=v_exec_id,execution_invocation_id=v_inv_id where id=v_task_id and user_id=v_owner_id;
    select revision into v_rev from public.regent_task_steps s where s.task_id=v_task_id and s.step_number=v_secret_count;
    perform public.regent_begin_phase(v_task_id,v_exec_id,v_inv_id,v_secret_count);
    perform public.regent_finish_phase(v_task_id,v_exec_id,v_inv_id,v_secret_count,v_rev,'succeeded',
      jsonb_build_object('result','Revised fixture '||v_secret_count),jsonb_build_object('step',v_secret_count,'revision',v_rev));
    select control_revision into v_rev from public.regent_tasks where id=v_task_id;
    perform public.regent_decide_phase(v_task_id,v_rev,'continue','Revised fixture accepted',v_secret_count);
  end loop;
  select control_revision into v_rev from public.regent_tasks where id=v_task_id;
  perform public.regent_decide_phase(v_task_id,v_rev,'skip','WhatsApp pending configuration',4);
  select control_revision into v_rev from public.regent_tasks where id=v_task_id;
  result:=public.regent_decide_phase(v_task_id,v_rev,'continue','Confirm no external WhatsApp execution',4);
  if result->>'status'<>'succeeded' then raise exception 'test_failed:final_human_gate'; end if;
  if not exists(select 1 from public.regent_task_steps s where s.task_id=v_task_id and s.step_number=4 and s.status='skipped' and s.artifact->>'deferred'='true') then raise exception 'test_failed:skip_not_explicit'; end if;

  -- RLS remains effective even for direct RPC/SELECT access with another subject.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
  if exists(select 1 from public.regent_tasks t where t.id=v_task_id) then raise exception 'test_failed:cross_user_visibility'; end if;
  begin
    perform public.regent_decide_phase(v_task_id,0,'execute','',1);
    raise exception 'test_failed:nonmaster_rpc_accepted';
  exception when others then if sqlerrm not like 'forbidden%' then raise; end if; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_owner_id,'role','authenticated')::text,true);
  raise notice 'Regente v0.7: phase gates, CAS, locks, redo/history, guidance and RLS passed; all fixture rows will be rolled back.';
end $$;
rollback;
