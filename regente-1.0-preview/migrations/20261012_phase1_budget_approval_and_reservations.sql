-- Regente 1.0 — Phase 1 monetary planning / regulated textual AI reservations
-- ONLY regente10_* tables are touched. No Optotica application tables are altered.
-- Existing missions remain legacy; new missions explicitly opt into budget_v1.
alter table public.regente10_missions
 add column if not exists budget_policy text not null default 'legacy'
 check(budget_policy in('legacy','budget_v1'));

create table if not exists public.regente10_mission_budgets(
 mission_id uuid primary key references public.regente10_missions(id) on delete cascade,
 owner_id uuid not null references auth.users(id),
 currency text not null default 'BRL' check(currency='BRL'),
 fx_brl_per_usd numeric(10,4) not null check(fx_brl_per_usd between 1 and 20),
 fx_source text not null default 'maestro_budget_assumption' check(fx_source='maestro_budget_assumption'),
 fx_verified boolean not null default false check(fx_verified=false),
 model text not null default 'gpt-4.1-mini' check(model='gpt-4.1-mini'),
 model_price_source text not null default 'https://developers.openai.com/api/docs/models/gpt-4.1-mini',
 model_price_date date not null default '2026-10-12',
 estimated_text_brl numeric(14,4) not null check(estimated_text_brl>=0),
 estimated_other_brl numeric(14,4) not null check(estimated_other_brl>=0),
 estimated_total_brl numeric(14,4) not null check(estimated_total_brl>=0),
 margin_pct numeric(7,2) not null check(margin_pct between 0 and 300),
 cap_brl numeric(14,4) not null check(cap_brl>=estimated_total_brl and cap_brl<=100000),
 reserved_brl numeric(14,4) not null default 0 check(reserved_brl>=0),
 metered_brl numeric(14,4) not null default 0 check(metered_brl>=0),
 state text not null default 'draft' check(state in('draft','approved')),
 approved_at timestamptz,
 approved_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check((state='draft' and approved_at is null and approved_by is null) or
       (state='approved' and approved_at is not null and approved_by=owner_id)),
 check(reserved_brl+metered_brl<=cap_brl)
);
create table if not exists public.regente10_budget_reservations(
 job_id uuid primary key references public.regente10_ai_calls(id),
 mission_id uuid not null references public.regente10_missions(id),
 owner_id uuid not null references auth.users(id),
 model text not null check(model='gpt-4.1-mini'),
 input_bytes integer not null,
 output_cap integer not null,
 amount_reserved_brl numeric(14,4) not null,
 amount_metered_brl numeric(14,4),
 state text not null default 'reserved' check(state in('reserved','settled','uncertain')),
 price_source text not null default 'https://developers.openai.com/api/docs/models/gpt-4.1-mini',
 created_at timestamptz not null default now(),
 settled_at timestamptz
);
-- No client may mutate financial ledger directly. RPCs enforce identity and state.
do $policy$
declare t text;
begin
 foreach t in array array['regente10_mission_budgets','regente10_budget_reservations'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy %I on public.%I for select to authenticated using(owner_id=(select auth.uid()) and exists(select 1 from public.system_admins s where s.user_id=(select auth.uid()) and s.active))','master_read_'||t,t);
 end loop;
end $policy$;

-- Master and Maestro share the same human account; no automated role impersonation.
-- This public RPC is SECURITY DEFINER only because authenticated lacks direct ledger
-- write. Strong auth.uid + active Master + mission ownership checks are mandatory.
create or replace function public.regente10_budget_submit(
 p_mission_id uuid,p_fx numeric,p_other_estimate numeric,p_margin_pct numeric
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid:=auth.uid();v_m public.regente10_missions%rowtype;
 v_quote numeric(14,4);v_total numeric(14,4);v_cap numeric(14,4);
 v_b public.regente10_mission_budgets%rowtype;
begin
 if v_uid is null or not exists(select 1 from public.system_admins a where a.user_id=v_uid and a.active)
 then raise exception 'Master não autorizado';end if;
 select * into v_m from public.regente10_missions where id=p_mission_id and owner_id=v_uid for update;
 if not found or v_m.budget_policy<>'budget_v1' or v_m.status<>'aguardando_autorizacao'
 then raise exception 'Orçamento só pode ser preparado durante Afinamento concluído de uma missão nova';end if;
 if p_fx is null or p_fx<1 or p_fx>20 or p_other_estimate is null or p_other_estimate<0 or p_other_estimate>9999
 or p_margin_pct is null or p_margin_pct<0 or p_margin_pct>300
 then raise exception 'Parâmetros financeiros inválidos';end if;
 -- Conservative envelope for textual-only pilot: maximum 12 calls, up to
 -- 48k UTF-8 bytes of prompt each and 1,800 output tokens, plus 25% contingency.
 -- This is NOT a quote for Canva, Meta, HeyGen or any unconnected tool.
 v_quote:=ceil((12*((48000+4096)*0.40+1800*1.60)/1000000)*p_fx*1.25*10000)/10000;
 v_total:=v_quote+p_other_estimate;
 v_cap:=ceil(v_total*(1+p_margin_pct/100)*10000)/10000;
 if v_cap>100000 then raise exception 'Teto acima da faixa deste piloto';end if;
 if exists(select 1 from public.regente10_mission_budgets where mission_id=p_mission_id and state='approved')
 then raise exception 'Orçamento já aprovado; alterações exigem novo envelope';end if;
 insert into public.regente10_mission_budgets(mission_id,owner_id,fx_brl_per_usd,
   estimated_text_brl,estimated_other_brl,estimated_total_brl,margin_pct,cap_brl)
 values(p_mission_id,v_uid,p_fx,v_quote,p_other_estimate,v_total,p_margin_pct,v_cap)
 on conflict(mission_id) do update
 set fx_brl_per_usd=excluded.fx_brl_per_usd,
     estimated_text_brl=excluded.estimated_text_brl,
     estimated_other_brl=excluded.estimated_other_brl,
     estimated_total_brl=excluded.estimated_total_brl,
     margin_pct=excluded.margin_pct,cap_brl=excluded.cap_brl,
     updated_at=now()
 where public.regente10_mission_budgets.state='draft'
 returning * into v_b;
 if v_b.mission_id is null then raise exception 'Não foi possível salvar orçamento';end if;
 return jsonb_build_object('state',v_b.state,'estimated_text_brl',v_b.estimated_text_brl,
  'estimated_other_brl',v_b.estimated_other_brl,'estimated_total_brl',v_b.estimated_total_brl,
  'cap_brl',v_b.cap_brl,'margin_pct',v_b.margin_pct,
  'currency','BRL','fx_brl_per_usd',v_b.fx_brl_per_usd,
  'note','Câmbio informado pelo Maestro; custos de ferramentas externas não verificados.');
end$$;

create or replace function public.regente10_budget_approve(
 p_mission_id uuid,p_confirm boolean
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid:=auth.uid();v_m public.regente10_missions%rowtype;
 v_b public.regente10_mission_budgets%rowtype;
begin
 if p_confirm is distinct from true or v_uid is null or
 not exists(select 1 from public.system_admins a where a.user_id=v_uid and a.active)
 then raise exception 'Confirmação explícita e Master autenticado necessários';end if;
 select * into v_m from public.regente10_missions where id=p_mission_id and owner_id=v_uid for update;
 if not found or v_m.status<>'aguardando_autorizacao' or v_m.budget_policy<>'budget_v1'
 then raise exception 'Missão fora da fase de aprovação';end if;
 select * into v_b from public.regente10_mission_budgets where mission_id=p_mission_id and owner_id=v_uid for update;
 if not found or v_b.state<>'draft' then raise exception 'Prepare um orçamento ainda não aprovado';end if;
 if v_b.estimated_total_brl>v_b.cap_brl then raise exception 'Teto inferior à estimativa';end if;
 if exists(select 1 from public.regente10_controls where owner_id=v_uid and emergency_stop)
 then raise exception 'Parada de emergência ativada';end if;
 update public.regente10_mission_budgets
 set state='approved',approved_at=now(),approved_by=v_uid,updated_at=now()
 where mission_id=p_mission_id;
 return jsonb_build_object('state','approved','cap_brl',v_b.cap_brl,
 'currency','BRL','authorization','Maestro/Master mesma identidade humana',
 'limitations','Apenas chamadas OpenAI integradas podem ser reservadas no ledger; ferramentas externas permanecem desabilitadas.');
end$$;

-- Wrapper over the existing global 12-call reservation, applying monetary
-- admission control for paid textual work AFTER Phase 1 approval.
create or replace function public.regente10_reserve_ai_budget(
 p_mission_id uuid,p_kind text,p_slot integer,p_model text,
 p_input_bytes integer,p_max_output integer
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid:=auth.uid();v_m public.regente10_missions%rowtype;
 v_b public.regente10_mission_budgets%rowtype;
 v_reserve numeric(14,4);v_job uuid;
begin
 if v_uid is null or not exists(select 1 from public.system_admins a where a.user_id=v_uid and a.active)
 then raise exception 'Master não autorizado';end if;
 select * into v_m from public.regente10_missions where id=p_mission_id and owner_id=v_uid for update;
 if not found then raise exception 'Missão inválida';end if;
 if p_input_bytes is null or p_input_bytes<1 or p_input_bytes>100000
 or p_max_output is null or p_max_output<1 or p_max_output>5000
 or p_model is distinct from 'gpt-4.1-mini'
 then raise exception 'Modelo ou dimensão sem tarifa orçamentária aprovada';end if;
 if v_m.budget_policy='legacy' then
  return public.regente10_reserve_ai_call(p_mission_id,p_kind,p_slot);
 end if;
 -- Preparation is authorized by the old 12-call pilot cap before a financial
 -- budget can be reasonably estimated. It is reported as pre-budget usage.
 if v_m.status='afinamento' and p_kind in('afinamento','orientacao') then
  return public.regente10_reserve_ai_call(p_mission_id,p_kind,p_slot);
 end if;
 select * into v_b from public.regente10_mission_budgets
 where mission_id=p_mission_id and owner_id=v_uid for update;
 if not found or v_b.state<>'approved' then raise exception 'Aprovação financeira pendente no Afinamento';end if;
 if v_m.envelope_approved_at is null then raise exception 'Envelope da missão ainda não aprovado';end if;
 -- Bound: UTF-8 bytes plus 4k message framing, worst max output, 25% cushion.
 v_reserve:=ceil((((p_input_bytes+4096)*0.40+p_max_output*1.60)/1000000)*
                v_b.fx_brl_per_usd*1.25*10000)/10000;
 if v_reserve<=0 or v_b.reserved_brl+v_b.metered_brl+v_reserve>v_b.cap_brl
 then raise exception 'Teto monetário insuficiente para reservar a operação';end if;
 v_job:=public.regente10_reserve_ai_call(p_mission_id,p_kind,p_slot);
 insert into public.regente10_budget_reservations(job_id,mission_id,owner_id,model,input_bytes,output_cap,amount_reserved_brl)
 values(v_job,p_mission_id,v_uid,p_model,p_input_bytes,p_max_output,v_reserve);
 update public.regente10_mission_budgets set reserved_brl=reserved_brl+v_reserve,updated_at=now()
 where mission_id=p_mission_id;
 return v_job;
end$$;

-- Only settle on provider-reported usage. If no usage is returned, retain the
-- reservation as uncertain; a missing invoice MUST NOT free spending headroom.
create or replace function public.regente10_settle_ai_budget(
 p_job_id uuid,p_input_tokens integer,p_cached_tokens integer,p_output_tokens integer
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid:=auth.uid();v_r public.regente10_budget_reservations%rowtype;
 v_b public.regente10_mission_budgets%rowtype;v_used numeric(14,4);
begin
 if v_uid is null or not exists(select 1 from public.system_admins a where a.user_id=v_uid and a.active)
 then raise exception 'Master não autorizado';end if;
 select * into v_r from public.regente10_budget_reservations where job_id=p_job_id and owner_id=v_uid for update;
 if not found then return jsonb_build_object('state','not_metered_or_prebudget');end if;
 if v_r.state='settled' then return jsonb_build_object('state','already_settled');end if;
 select * into v_b from public.regente10_mission_budgets where mission_id=v_r.mission_id and owner_id=v_uid for update;
 if p_input_tokens is null or p_cached_tokens is null or p_output_tokens is null
 or p_input_tokens<0 or p_cached_tokens<0 or p_cached_tokens>p_input_tokens
 or p_output_tokens<0 or p_input_tokens>100000 or p_output_tokens>5000 then
  update public.regente10_budget_reservations set state='uncertain' where job_id=p_job_id;
  return jsonb_build_object('state','uncertain','reason','Medição do provedor indisponível');
 end if;
 v_used:=ceil(((((p_input_tokens-p_cached_tokens)*0.40+p_cached_tokens*0.10+
                      p_output_tokens*1.60)/1000000)*v_b.fx_brl_per_usd)*10000)/10000;
 if v_used>v_r.amount_reserved_brl then
  update public.regente10_budget_reservations set state='uncertain' where job_id=p_job_id;
  return jsonb_build_object('state','uncertain','reason','Custo observado supera reserva; reavaliar');
 end if;
 update public.regente10_budget_reservations set
  state='settled',amount_metered_brl=v_used,settled_at=now() where job_id=p_job_id;
 update public.regente10_mission_budgets set
  reserved_brl=reserved_brl-v_r.amount_reserved_brl,
  metered_brl=metered_brl+v_used,
  updated_at=now() where mission_id=v_r.mission_id;
 return jsonb_build_object('state','settled','metered_brl',v_used,'model','gpt-4.1-mini',
 'note','Estimativa com tokens declarados pelo provedor, preço publicado e câmbio orçamentário; não equivale à fatura.');
end$$;

revoke all on function public.regente10_budget_submit(uuid,numeric,numeric,numeric) from public,anon;
revoke all on function public.regente10_budget_approve(uuid,boolean) from public,anon;
revoke all on function public.regente10_reserve_ai_budget(uuid,text,integer,text,integer,integer) from public,anon;
revoke all on function public.regente10_settle_ai_budget(uuid,integer,integer,integer) from public,anon;
grant execute on function public.regente10_budget_submit(uuid,numeric,numeric,numeric) to authenticated;
grant execute on function public.regente10_budget_approve(uuid,boolean) to authenticated;
grant execute on function public.regente10_reserve_ai_budget(uuid,text,integer,text,integer,integer) to authenticated;
grant execute on function public.regente10_settle_ai_budget(uuid,integer,integer,integer) to authenticated;
