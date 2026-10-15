-- S00 textual-budget pause for existing and future missions.
-- Does not loosen the operational Composio gateway's monetary/resource grants.
-- No changes to Optotica patient/product tables.
alter table public.regente10_controls
 add column if not exists text_budget_paused boolean not null default true;
-- Explicitly requested by Maestro: suspend only the TEXT approval bottleneck.
update public.regente10_controls set text_budget_paused=true,updated_at=now()
where exists(select 1 from public.system_admins s where s.user_id=owner_id and s.active);

create or replace function public.regente10_reserve_ai_call(
 p_mission_id uuid,p_kind text,p_slot integer
) returns uuid language plpgsql set search_path to public,pg_temp as $fn$
declare v_user uuid:=auth.uid();v_stop boolean;v_existing uuid;v_daily integer;v_mission integer;v_id uuid;
begin
 if v_user is null or not exists(select 1 from public.system_admins where user_id=v_user and active)
 then raise exception 'Acesso não autorizado';end if;
 if not exists(select 1 from public.regente10_missions where id=p_mission_id and owner_id=v_user)
 then raise exception 'Missão inválida';end if;
 if p_kind not in ('afinamento','orientacao','resultado','executor') or p_slot is null or p_slot<0 or p_slot>10
 then raise exception 'Tipo de chamada textual não permitido';end if;
 insert into public.regente10_controls(owner_id) values(v_user) on conflict(owner_id) do nothing;
 select emergency_stop into v_stop from public.regente10_controls where owner_id=v_user for update;
 if v_stop then raise exception 'Parada de emergência ativada';end if;
 if exists(select 1 from public.regente10_missions where id=p_mission_id and owner_id=v_user and paused)
 then raise exception 'Missão pausada';end if;
 select id into v_existing from public.regente10_ai_calls
  where mission_id=p_mission_id and kind=p_kind and slot=p_slot;
 if v_existing is not null then raise exception 'Etapa já reservada; não repetir sem reconciliação';end if;
 -- Previous global lifetime cap would permanently block future missions.
 -- 12 calls per Master per rolling 24h, and max 12 per individual mission.
 -- Lock on controls serializes counters across concurrent missions.
 select count(*) into v_daily from public.regente10_ai_calls
  where owner_id=v_user and created_at>clock_timestamp()-interval '24 hours';
 if v_daily>=12 then raise exception 'Limite de 12 chamadas textuais em 24 horas atingido; aguarde a janela de segurança';end if;
 select count(*) into v_mission from public.regente10_ai_calls
  where owner_id=v_user and mission_id=p_mission_id;
 if v_mission>=12 then raise exception 'Limite de 12 chamadas textuais nesta missão atingido';end if;
 insert into public.regente10_ai_calls(owner_id,mission_id,kind,slot)
 values(v_user,p_mission_id,p_kind,p_slot) returning id into v_id;
 return v_id;
end;$fn$;

create or replace function public.regente10_reserve_ai_budget(
 p_mission_id uuid,p_kind text,p_slot integer,p_model text,p_input_bytes integer,p_max_output integer
) returns uuid language plpgsql security definer set search_path to public,pg_temp as $fn$
declare v_uid uuid:=auth.uid();v_m public.regente10_missions%rowtype;
 v_b public.regente10_mission_budgets%rowtype;v_budget_paused boolean;
 v_reserve numeric(14,4);v_job uuid;
begin
 if v_uid is null or not exists(select 1 from public.system_admins a where a.user_id=v_uid and a.active)
 then raise exception 'Master não autorizado';end if;
 select * into v_m from public.regente10_missions where id=p_mission_id and owner_id=v_uid for update;
 if not found then raise exception 'Missão inválida';end if;
 if p_input_bytes is null or p_input_bytes<1 or p_input_bytes>100000
  or p_max_output is null or p_max_output<1 or p_max_output>5000
  or p_model is distinct from 'gpt-4.1-mini'
 then raise exception 'Modelo ou dimensão fora dos limites de segurança';end if;
 -- This exception is ONLY for text; provider tool grants still require
 -- independently verified financial cap and destination in S00.
 if p_kind not in ('afinamento','orientacao','resultado','executor') then
  raise exception 'Somente geração textual pode usar a suspensão orçamentária';end if;
 select coalesce(text_budget_paused,false) into v_budget_paused
 from public.regente10_controls where owner_id=v_uid;
 if coalesce(v_budget_paused,false) then
  if v_m.status='afinamento' and p_kind in('afinamento','orientacao') then
   return public.regente10_reserve_ai_call(p_mission_id,p_kind,p_slot);
  end if;
  if v_m.status not in('em_execucao','em_resultados') or v_m.envelope_approved_at is null then
   raise exception 'Aprovação textual da missão ainda necessária';end if;
  return public.regente10_reserve_ai_call(p_mission_id,p_kind,p_slot);
 end if;
 if v_m.budget_policy='legacy' then
  return public.regente10_reserve_ai_call(p_mission_id,p_kind,p_slot);
 end if;
 if v_m.status='afinamento' and p_kind in('afinamento','orientacao') then
  return public.regente10_reserve_ai_call(p_mission_id,p_kind,p_slot);
 end if;
 select * into v_b from public.regente10_mission_budgets
 where mission_id=p_mission_id and owner_id=v_uid for update;
 if not found or v_b.state<>'approved' then raise exception 'Aprovação financeira pendente no Afinamento';end if;
 if v_m.envelope_approved_at is null then raise exception 'Envelope da missão ainda não aprovado';end if;
 v_reserve:=ceil((((p_input_bytes+4096)*0.40+p_max_output*1.60)/1000000)*
 v_b.fx_brl_per_usd*1.25*10000)/10000;
 if v_reserve<=0 or v_b.reserved_brl+v_b.metered_brl+v_reserve>v_b.cap_brl
 then raise exception 'Teto monetário insuficiente para reservar a operação';end if;
 v_job:=public.regente10_reserve_ai_call(p_mission_id,p_kind,p_slot);
 insert into public.regente10_budget_reservations(job_id,mission_id,owner_id,model,input_bytes,output_cap,amount_reserved_brl)
 values(v_job,p_mission_id,v_uid,p_model,p_input_bytes,p_max_output,v_reserve);
 update public.regente10_mission_budgets
 set reserved_brl=reserved_brl+v_reserve,updated_at=now() where mission_id=p_mission_id;
 return v_job;
end;$fn$;

-- Definer RPC remains callable only by authenticated Master inside function.
revoke all on function public.regente10_reserve_ai_budget(uuid,text,integer,text,integer,integer) from public,anon;
grant execute on function public.regente10_reserve_ai_budget(uuid,text,integer,text,integer,integer) to authenticated;
revoke all on function public.regente10_reserve_ai_call(uuid,text,integer) from public,anon;
grant execute on function public.regente10_reserve_ai_call(uuid,text,integer) to authenticated;
