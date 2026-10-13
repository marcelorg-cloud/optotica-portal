-- Additive Regente-only kernel. Provider credentials never enter the database.
create schema if not exists regente10_portao;
revoke all on schema regente10_portao from public,anon,authenticated;
create table regente10_portao.configuration(
 singleton boolean primary key default true check(singleton),owner_id uuid not null references auth.users(id),
 key_hash text check(key_hash ~ '^[a-f0-9]{64}$'),policy_version text not null default 's00-operative-v1',
 authorization_source text not null,created_at timestamptz not null default now()
);
create table regente10_portao.projects(
 project_id text primary key references public.regente10_projects(id),owner_id uuid not null references auth.users(id),
 mission_id uuid not null unique references public.regente10_missions(id),control_approved boolean not null default true,
 max_control_tool_spend_brl numeric not null default 0 check(max_control_tool_spend_brl=0),created_at timestamptz not null default now()
);
create table regente10_portao.bindings(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
 project_id text not null references regente10_portao.projects(project_id),service_key text not null check(service_key ~ '^[a-z0-9_]{1,70}$'),
 service_name text not null check(length(service_name)<=90),toolkit text check(toolkit ~ '^[a-z0-9_]{1,90}$'),
 provider_user_id text not null,revision integer not null default 0 check(revision>=0),
 status text not null default 'planned' check(status in('planned','discovered','preparing','pending','active','no_auth','needs_credentials','needs_config','unsupported','error','expired','blocked')),
 managed_oauth boolean not null default false,no_auth boolean not null default false,auth_schemes text[] not null default '{}',
 session_id text,account_id text unique,attempt_id uuid,encrypted_link text check(length(encrypted_link)<=12000),link_expires_at timestamptz,
 diagnostic text check(diagnostic ~ '^[a-zA-Z0-9_.-]{1,100}$'),verified_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(owner_id,project_id,service_key)
);
create index gateway_bindings_project on regente10_portao.bindings(project_id,status);
create table regente10_portao.tools(
 project_id text not null references regente10_portao.projects(project_id),binding_id uuid not null references regente10_portao.bindings(id),
 slug text not null check(slug ~ '^[A-Z0-9_]{1,150}$'),version text not null check(version ~ '^[a-zA-Z0-9_.-]{1,80}$'),
 contract_hash text not null check(contract_hash ~ '^[a-f0-9]{64}$'),schema jsonb not null,
 name text not null,description text not null default '',tags text[] not null default '{}',
 no_auth boolean not null default false,pricing jsonb,discovered_at timestamptz not null default now(),primary key(project_id,binding_id,slug,version)
);
create table regente10_portao.grants(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),project_id text not null references regente10_portao.projects(project_id),
 mission_id uuid not null references public.regente10_missions(id),binding_id uuid not null references regente10_portao.bindings(id),binding_revision integer not null,
 resource_alias text not null references public.regente10_resources(alias),resource_db_hash text not null check(resource_db_hash ~ '^[a-f0-9]{64}$'),resource_hash text not null check(resource_hash ~ '^[a-f0-9]{64}$'),
 operation text not null,tool_slug text not null,tool_version text not null,contract_hash text not null check(contract_hash ~ '^[a-f0-9]{64}$'),
 arguments jsonb not null check(jsonb_typeof(arguments)='object' and octet_length(arguments::text)<=64000),args_hash text not null check(args_hash ~ '^[a-f0-9]{64}$'),
 unit_max_brl numeric(14,4) not null check(unit_max_brl>=0 and unit_max_brl<=10000),price_source text not null check(length(price_source) between 8 and 500),
 max_calls integer not null check(max_calls between 1 and 100),used_calls integer not null default 0 check(used_calls>=0 and used_calls<=max_calls),
 status text not null default 'approved' check(status in('approved','revoked')),expires_at timestamptz not null,
 approved_at timestamptz not null default now(),approved_by uuid not null references auth.users(id)
);
create index gateway_grants_mission on regente10_portao.grants(mission_id,status);
create table regente10_portao.scopes(
 resource_alias text primary key references public.regente10_resources(alias),owner_id uuid not null references auth.users(id),
 project_id text not null references regente10_portao.projects(project_id),binding_id uuid not null references regente10_portao.bindings(id),
 tool_slug text not null,tool_version text not null,args_hash text not null check(args_hash ~ '^[a-f0-9]{64}$'),
 confirmed_at timestamptz not null default now()
);
create table regente10_portao.events(
 id uuid primary key default gen_random_uuid(),request_key uuid not null unique,owner_id uuid not null references auth.users(id),project_id text not null references regente10_portao.projects(project_id),
 mission_id uuid references public.regente10_missions(id),binding_id uuid references regente10_portao.bindings(id),grant_id uuid references regente10_portao.grants(id),
 operation text not null,state text not null check(state in('approved','reserved','dispatched','completed','failed','uncertain','cancelled','blocked')),
 amount_brl numeric(14,4) not null default 0 check(amount_brl>=0),provider_log_id text,diagnostic text,result jsonb,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index gateway_events_project_time on regente10_portao.events(project_id,created_at desc);
-- Not exposed by PostgREST; no direct mutation rights, even for authenticated Master.
do $rls$ declare t text;begin
 foreach t in array array['configuration','projects','bindings','tools','grants','scopes','events'] loop
  execute format('alter table regente10_portao.%I enable row level security',t);
  execute format('revoke all on regente10_portao.%I from public,anon,authenticated',t);
 end loop;
end $rls$;
-- This mission explicitly authorizes technical setup; zero tool expenditure is allowed.
do $seed$ declare u uuid;p record;mid uuid;names text[];s text;begin
 if (select count(*) from public.system_admins where active)<>1 then raise exception 'Gateway setup needs one unambiguous active Master';end if;
 select user_id into u from public.system_admins where active;
 insert into regente10_portao.configuration(owner_id,authorization_source) values(u,'human_mission_2026-10-12_22-35_BRT_operational_gateway');
 insert into public.regente10_controls(owner_id,emergency_stop) values(u,false) on conflict(owner_id) do nothing;
 for p in select id,label from public.regente10_projects where status='active' loop
  insert into public.regente10_missions(owner_id,project,title,original_request,status,envelope_approved_at,budget_policy)
   values(u,p.id,'Gateway de instrumentos · '||p.label,'Implementação operacional solicitada pelo Master em 12/10/2026: descoberta e preparação técnica de conexões Composio, sem executar ferramentas até aprovação de recurso e limite financeiro.','em_execucao',now(),'budget_v1') returning id into mid;
  insert into regente10_portao.projects(project_id,owner_id,mission_id) values(p.id,u,mid);
  names:=case p.id
   when 'optotica' then array['GitHub','Vercel','Supabase','Canva','Google Drive','Google Docs','Google Sheets','Gmail','Replicate','Resend','Cloudflare','Bling']
   when 'ensavim' then array['Canva','HeyGen','Google Drive','Google Docs','Google Sheets','Gmail','Google Calendar','Facebook Ads','Instagram','Windsor']
   when 'born-robot' then array['GitHub','Vercel','Supabase','Google Drive','Google Docs','Google Sheets']
   else array['Google Drive','Google Docs','Google Sheets','Gmail','Google Calendar','GitHub','Vercel'] end;
  foreach s in array names loop
   insert into regente10_portao.bindings(owner_id,project_id,service_key,service_name,provider_user_id)
    values(u,p.id,lower(regexp_replace(s,'[^a-zA-Z0-9]','','g')),s,'r10_'||replace(u::text,'-','')||'_'||replace(p.id,'-','_'));
  end loop;
 end loop;
end $seed$;
create function regente10_portao.assert_resource(pr text, alias text, op text) returns jsonb
language plpgsql security invoker set search_path='' as $resource$
declare r public.regente10_resources%rowtype;seen text[]:='{}';initial boolean:=true;chain jsonb:='[]';begin
 loop
  if alias=any(seen) or cardinality(seen)>=8 then raise exception 'Resource ancestry invalid';end if;
  seen:=array_append(seen,alias);
  select * into r from public.regente10_resources where regente10_resources.alias=assert_resource.alias;
  if not found or r.lifecycle<>'active' or r.data_class not in('public','internal') or not ((r.owner_kind='project' and r.owner_project=pr) or (r.owner_kind='institute' and r.share_category='institutional_common') or (r.share_category='shared' and pr=any(r.shared_projects))) then raise exception 'S00 resource ancestry or project denied';end if;
  if initial and not (op=any(r.allowed_operations)) then raise exception 'Resource operation denied';end if;
  chain:=chain||jsonb_build_array(to_jsonb(r));if r.parent_alias is null then return chain;end if;alias:=r.parent_alias;initial:=false;
 end loop;
end $resource$;
revoke all on function regente10_portao.assert_resource(text,text,text) from public,anon,authenticated;

-- The private definer is the sole privileged gateway kernel; public wrapper is invoker.
create function regente10_portao.kernel(p_op text,p jsonb,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $kernel$
declare cfg regente10_portao.configuration%rowtype;uid uuid:=auth.uid();pr text:=p->>'project';
 b regente10_portao.bindings%rowtype;g regente10_portao.grants%rowtype;e regente10_portao.events%rowtype;
 m public.regente10_missions%rowtype;bud public.regente10_mission_budgets%rowtype;r public.regente10_resources%rowtype;
 x jsonb;v_id uuid;expiry timestamptz;res jsonb;cap numeric;fx numeric;total numeric;
begin
 select * into cfg from regente10_portao.configuration where singleton;
 if cfg.key_hash is null or length(coalesce(p_key,''))<32 or encode(extensions.digest(p_key,'sha256'),'hex') is distinct from cfg.key_hash then raise exception 'Gateway credential rejected';end if;
 if not exists(select 1 from public.system_admins where user_id=cfg.owner_id and active) then raise exception 'Active Master required';end if;
 if uid is not null and uid<>cfg.owner_id then raise exception 'Identity outside gateway scope';end if;
 if pr is null or not exists(select 1 from regente10_portao.projects gp join public.regente10_projects rp on rp.id=gp.project_id where gp.project_id=pr and gp.owner_id=cfg.owner_id and gp.control_approved and rp.status='active') then raise exception 'Project outside approved scope';end if;
 if p_op='status' then
  if uid is distinct from cfg.owner_id then raise exception 'Master session required';end if;
  return jsonb_build_object('policy',cfg.policy_version,'project',pr,'setupMissionId',(select mission_id from regente10_portao.projects where project_id=pr),
   'connections',coalesce((select jsonb_agg(to_jsonb(v)) from(select id,project_id,service_key,service_name,toolkit,status,revision,managed_oauth,no_auth,auth_schemes,account_id,attempt_id,encrypted_link,link_expires_at,diagnostic,verified_at,updated_at from regente10_portao.bindings where project_id=pr order by service_name)v),'[]'),
   'grants',coalesce((select jsonb_agg(to_jsonb(v)) from(select id,mission_id,binding_id,resource_alias,operation,tool_slug,tool_version,arguments,unit_max_brl,price_source,max_calls,used_calls,status,expires_at from regente10_portao.grants where project_id=pr order by approved_at desc limit 50)v),'[]'),
   'events',coalesce((select jsonb_agg(to_jsonb(v)) from(select id,operation,state,amount_brl,provider_log_id,diagnostic,created_at,grant_id,binding_id from regente10_portao.events where project_id=pr order by created_at desc limit 50)v),'[]'),
   'budget',(select to_jsonb(v) from(select mb.mission_id,mb.cap_brl,mb.reserved_brl,mb.metered_brl,mb.state,mb.fx_brl_per_usd from public.regente10_mission_budgets mb join regente10_portao.projects gp on gp.mission_id=mb.mission_id where gp.project_id=pr)v),
   'stopped',coalesce((select emergency_stop from public.regente10_controls where owner_id=cfg.owner_id),true));
 end if;
 if p_op='worker_state' then return jsonb_build_object('bindings',coalesce((select jsonb_agg(to_jsonb(bd)) from regente10_portao.bindings bd where bd.project_id=pr),'[]'));end if;
 if p_op not in('complete','control_result','cancel') and coalesce((select emergency_stop from public.regente10_controls where owner_id=cfg.owner_id),true) then raise exception 'Emergency stop active';end if;
 if p_op='control' then
  if p->>'operation' not in('discover','tools.discover','connection.verify') then raise exception 'Control operation denied';end if;
  insert into regente10_portao.events(request_key,owner_id,project_id,operation,state) values((p->>'requestKey')::uuid,cfg.owner_id,pr,p->>'operation','approved') on conflict(request_key) do nothing returning * into e;
  if e.id is null then select * into e from regente10_portao.events where request_key=(p->>'requestKey')::uuid and project_id=pr and owner_id=cfg.owner_id and operation=p->>'operation';end if;
  if e.id is null then raise exception 'Idempotency key belongs to another operation';end if;
  return jsonb_build_object('id',e.id,'state',e.state);
 elsif p_op='control_result' then
  update regente10_portao.events set state=case when p->>'state'='completed' then 'completed' else 'failed' end,diagnostic=left(p->>'diagnostic',100),updated_at=now()
   where id=(p->>'id')::uuid and project_id=pr and owner_id=cfg.owner_id and state='approved' and grant_id is null returning id into v_id;
  return jsonb_build_object('recorded',v_id is not null);
 elsif p_op='discovery' then
  update regente10_portao.bindings set toolkit=nullif(p->>'toolkit',''),managed_oauth=coalesce((p->>'managedOauth')::boolean,false),no_auth=coalesce((p->>'noAuth')::boolean,false),
   auth_schemes=coalesce(array(select jsonb_array_elements_text(p->'authSchemes')),'{}'),
   status=case when status in('planned','unsupported','discovered','needs_config') then case when nullif(p->>'toolkit','') is null then 'unsupported' else 'discovered' end else status end,
   diagnostic=case when nullif(p->>'toolkit','') is null then 'toolkit_not_found' else null end,updated_at=now()
   where id=(p->>'bindingId')::uuid and project_id=pr and owner_id=cfg.owner_id returning id into v_id;
  if v_id is null then raise exception 'Connection outside project';end if;return jsonb_build_object('id',v_id);
 elsif p_op='prepare_connection' then
  select * into b from regente10_portao.bindings where id=(p->>'bindingId')::uuid and project_id=pr and owner_id=cfg.owner_id for update;
  if not found then raise exception 'Connection outside project';end if;
  if b.toolkit is null then raise exception 'Toolkit unavailable';end if;
  if b.status in('active','no_auth') and coalesce((p->>'force')::boolean,false)=false then return jsonb_build_object('reused',true,'binding',to_jsonb(b));end if;
  if b.status in('preparing','pending') and b.link_expires_at>now() and coalesce((p->>'force')::boolean,false)=false then return jsonb_build_object('reused',true,'binding',to_jsonb(b));end if;
  update regente10_portao.bindings set attempt_id=gen_random_uuid(),revision=revision+1,status='preparing',session_id=null,encrypted_link=null,link_expires_at=now()+interval '15 minutes',diagnostic=null,updated_at=now() where id=b.id returning * into b;
  insert into regente10_portao.events(request_key,owner_id,project_id,binding_id,operation,state) values(b.attempt_id,cfg.owner_id,pr,b.id,'connection.prepare','approved');
  return jsonb_build_object('reused',false,'binding',to_jsonb(b));
 elsif p_op='connection_result' then
  if p->>'state' not in('pending','no_auth','needs_credentials','needs_config','error','blocked') then raise exception 'Invalid connection state';end if;
  update regente10_portao.bindings set status=p->>'state',session_id=p->>'sessionId',account_id=coalesce(p->>'accountId',account_id),encrypted_link=p->>'encryptedLink',diagnostic=p->>'diagnostic',updated_at=now(),verified_at=case when p->>'state'='no_auth' then now() else verified_at end
   where id=(p->>'bindingId')::uuid and project_id=pr and owner_id=cfg.owner_id and attempt_id=(p->>'attemptId')::uuid and status='preparing' returning * into b;
  if b.id is null then raise exception 'Stale connection attempt';end if;
  update regente10_portao.events set state=case when b.status in('pending','no_auth') then 'completed' else 'failed' end,diagnostic=b.diagnostic,updated_at=now() where request_key=b.attempt_id;
  return jsonb_build_object('id',b.id,'state',b.status);
 elsif p_op='verified' then
  if p->>'state' not in('active','pending','expired','error','blocked') then raise exception 'Invalid verification state';end if;
  update regente10_portao.bindings set status=p->>'state',verified_at=now(),diagnostic=p->>'diagnostic',encrypted_link=case when p->>'state'='active' then null else encrypted_link end,updated_at=now()
   where id=(p->>'bindingId')::uuid and project_id=pr and owner_id=cfg.owner_id and revision=(p->>'revision')::integer returning id into v_id;
  if v_id is null then raise exception 'Stale verification';end if;return jsonb_build_object('verified',true);
 elsif p_op='tools' then
  select * into b from regente10_portao.bindings where id=(p->>'bindingId')::uuid and project_id=pr and owner_id=cfg.owner_id;
  if not found then raise exception 'Connection outside project';end if;
  for x in select jsonb_array_elements(p->'tools') loop
   insert into regente10_portao.tools(project_id,binding_id,slug,version,contract_hash,schema,name,description,tags,no_auth,pricing)
    values(pr,b.id,x->>'slug',x->>'version',x->>'contractHash',x->'schema',left(x->>'name',160),left(x->>'description',2000),array(select jsonb_array_elements_text(x->'tags')),coalesce((x->>'noAuth')::boolean,false),x->'pricing')
    on conflict(project_id,binding_id,slug,version) do update set contract_hash=excluded.contract_hash,schema=excluded.schema,description=excluded.description,tags=excluded.tags,pricing=excluded.pricing,discovered_at=now();
  end loop;return jsonb_build_object('saved',true);
 elsif p_op='resources' then
  if uid is distinct from cfg.owner_id then raise exception 'Master session required';end if;
  return jsonb_build_object('resources',coalesce((select jsonb_agg(to_jsonb(r)) from public.regente10_resources r where lifecycle='active' and data_class in('public','internal') and ((owner_kind='project' and owner_project=pr) or (owner_kind='institute' and share_category='institutional_common') or (share_category='shared' and pr=any(shared_projects)))),'[]'));
 elsif p_op='resource' then
  return jsonb_build_object('chain',regente10_portao.assert_resource(pr,p->>'resourceAlias',p->>'operation'));
 elsif p_op='tool_list' then
  if uid is distinct from cfg.owner_id then raise exception 'Master session required';end if;
  return jsonb_build_object('tools',coalesce((select jsonb_agg(to_jsonb(t)) from regente10_portao.tools t where project_id=pr and binding_id=(p->>'bindingId')::uuid),'[]'));
 elsif p_op='cap' then
  if uid is distinct from cfg.owner_id or (p->>'confirm')::boolean is distinct from true then raise exception 'Explicit Master approval required';end if;
  cap:=(p->>'capBrl')::numeric;fx:=(p->>'fx')::numeric;
  if cap is null or cap<0 or cap>100000 or fx is null or fx<1 or fx>20 then raise exception 'Invalid financial cap';end if;
  select * into m from public.regente10_missions where id=(select mission_id from regente10_portao.projects where project_id=pr) and owner_id=cfg.owner_id for update;
  select * into bud from public.regente10_mission_budgets where mission_id=m.id for update;
  if found and bud.reserved_brl+bud.metered_brl>0 then raise exception 'Committed budget cannot be replaced';end if;
  insert into public.regente10_mission_budgets(mission_id,owner_id,fx_brl_per_usd,estimated_text_brl,estimated_other_brl,estimated_total_brl,margin_pct,cap_brl,state,approved_at,approved_by)
   values(m.id,cfg.owner_id,fx,0,0,0,0,cap,'approved',now(),cfg.owner_id)
   on conflict(mission_id) do update set fx_brl_per_usd=excluded.fx_brl_per_usd,cap_brl=excluded.cap_brl,state='approved',approved_at=now(),approved_by=cfg.owner_id,updated_at=now();
  update regente10_portao.grants set status='revoked' where mission_id=m.id;
  return jsonb_build_object('approved',true,'capBrl',cap,'missionId',m.id);
 elsif p_op='scope' then
  if uid is distinct from cfg.owner_id or (p->>'confirmNonPersonal')::boolean is distinct from true or p->>'dataClass' not in('public','internal') then raise exception 'Explicit non-personal resource approval required';end if;
  select * into b from regente10_portao.bindings where id=(p->>'bindingId')::uuid and owner_id=cfg.owner_id and project_id=pr;
  if not found or not exists(select 1 from regente10_portao.tools t where t.project_id=pr and t.binding_id=b.id and t.slug=p->>'toolSlug' and t.version=p->>'version') then raise exception 'Tool outside discovered project';end if;
  v_id:=gen_random_uuid();
  insert into public.regente10_resources(alias,resource_kind,owner_kind,owner_project,share_category,shared_projects,parent_alias,data_class,lifecycle,allowed_operations,description,policy_version)
   values('GW/'||pr||'/'||v_id::text,'service','project',pr,'exclusive','{}',null,p->>'dataClass','active',array['instrument.execute'],left(p->>'description',500),1);
  insert into regente10_portao.scopes(resource_alias,owner_id,project_id,binding_id,tool_slug,tool_version,args_hash)
   values('GW/'||pr||'/'||v_id::text,cfg.owner_id,pr,b.id,p->>'toolSlug',p->>'version',p->>'argsHash');
  return jsonb_build_object('resourceAlias','GW/'||pr||'/'||v_id::text);
 elsif p_op='grant' then
  if uid is distinct from cfg.owner_id or (p->>'confirm')::boolean is distinct from true or (p->>'costVerified')::boolean is distinct from true then raise exception 'Master approval and known tariff required';end if;
  select * into m from public.regente10_missions where id=(p->>'missionId')::uuid and owner_id=cfg.owner_id and project=pr for update;
  if not found or m.paused or m.envelope_approved_at is null or m.status='concluida' then raise exception 'Mission not eligible';end if;
  select * into bud from public.regente10_mission_budgets where mission_id=m.id and owner_id=cfg.owner_id for update;
  if not found or bud.state<>'approved' then raise exception 'Financial approval pending';end if;
  select * into b from regente10_portao.bindings where id=(p->>'bindingId')::uuid and project_id=pr and owner_id=cfg.owner_id;
  if not found or b.status not in('active','no_auth') then raise exception 'Connection not verified';end if;
  select * into r from public.regente10_resources where alias=p->>'resourceAlias';
  if not found or r.lifecycle<>'active' or r.data_class not in('public','internal') or not ((r.owner_kind='project' and r.owner_project=pr) or (r.owner_kind='institute' and r.share_category='institutional_common') or (r.share_category='shared' and pr=any(r.shared_projects))) or not (p->>'operation'=any(r.allowed_operations)) then raise exception 'S00 resource denied';end if;
  perform regente10_portao.assert_resource(pr,r.alias,p->>'operation');
  if not exists(select 1 from regente10_portao.scopes sc where sc.resource_alias=r.alias and sc.owner_id=cfg.owner_id and sc.project_id=pr and sc.binding_id=b.id and sc.tool_slug=p->>'toolSlug' and sc.tool_version=p->>'version' and sc.args_hash=p->>'argsHash') then raise exception 'Exact instrument resource scope required';end if;
  if not exists(select 1 from regente10_portao.tools t where t.project_id=pr and t.binding_id=b.id and t.slug=p->>'toolSlug' and t.version=p->>'version' and t.contract_hash=p->>'contractHash') then raise exception 'Tool contract not discovered';end if;
  if (p->>'unitMaxBrl')::numeric<0 or (p->>'maxCalls')::integer not between 1 and 100 or (p->>'ttlMinutes')::integer not between 1 and 60 then raise exception 'Invalid envelope limits';end if;
  total:=(p->>'unitMaxBrl')::numeric*(p->>'maxCalls')::integer;
  if total+bud.reserved_brl+bud.metered_brl>bud.cap_brl then raise exception 'Envelope exceeds mission cap';end if;
  insert into regente10_portao.grants(owner_id,project_id,mission_id,binding_id,binding_revision,resource_alias,resource_db_hash,resource_hash,operation,tool_slug,tool_version,contract_hash,arguments,args_hash,unit_max_brl,price_source,max_calls,expires_at,approved_by)
   values(cfg.owner_id,pr,m.id,b.id,b.revision,r.alias,encode(extensions.digest(regente10_portao.assert_resource(pr,r.alias,p->>'operation')::text,'sha256'),'hex'),p->>'resourceHash',p->>'operation',p->>'toolSlug',p->>'version',p->>'contractHash',p->'arguments',p->>'argsHash',(p->>'unitMaxBrl')::numeric,p->>'priceSource',(p->>'maxCalls')::integer,now()+make_interval(mins=>(p->>'ttlMinutes')::integer),cfg.owner_id) returning id into v_id;
  return jsonb_build_object('grantId',v_id,'approved',true);
 elsif p_op='revoke' then
  if uid is distinct from cfg.owner_id then raise exception 'Master approval required';end if;
  update regente10_portao.grants set status='revoked' where id=(p->>'grantId')::uuid and project_id=pr and owner_id=cfg.owner_id returning id into v_id;
  return jsonb_build_object('revoked',v_id is not null);
 elsif p_op='claim' then
  select * into g from regente10_portao.grants where id=(p->>'grantId')::uuid and owner_id=cfg.owner_id and project_id=pr;
  if not found then raise exception 'Grant outside project';end if;
  select * into m from public.regente10_missions where id=g.mission_id and owner_id=cfg.owner_id and project=pr for update;
  if not found or m.paused or m.envelope_approved_at is null or m.status='concluida' then raise exception 'Mission not eligible';end if;
  select * into bud from public.regente10_mission_budgets where mission_id=m.id and owner_id=cfg.owner_id for update;
  if not found or bud.state<>'approved' then raise exception 'Financial approval pending';end if;
  select * into g from regente10_portao.grants where id=g.id for update;
  select * into e from regente10_portao.events where request_key=(p->>'requestKey')::uuid;
  if found then
   if e.grant_id is distinct from g.id or e.owner_id<>cfg.owner_id or e.project_id<>pr then raise exception 'Idempotency collision';end if;
   return jsonb_build_object('reused',true,'event',to_jsonb(e));
  end if;
  select * into b from regente10_portao.bindings where id=g.binding_id and owner_id=cfg.owner_id and project_id=pr for update;
  if not found or b.status not in('active','no_auth') or b.revision<>g.binding_revision or (b.verified_at is null or b.verified_at<now()-interval '5 minutes') then raise exception 'Stale connection';end if;
  if g.status<>'approved' or g.expires_at<=now() or g.used_calls>=g.max_calls then raise exception 'Grant expired or exhausted';end if;
  if g.args_hash is distinct from p->>'argsHash' or g.contract_hash is distinct from p->>'contractHash' or g.resource_hash is distinct from p->>'resourceHash' then raise exception 'Approved scope changed';end if;
  select * into r from public.regente10_resources where alias=g.resource_alias;
  if not found or r.lifecycle<>'active' or r.data_class not in('public','internal') or not (g.operation=any(r.allowed_operations)) then raise exception 'Resource no longer eligible';end if;
  if g.resource_db_hash is distinct from encode(extensions.digest(regente10_portao.assert_resource(pr,g.resource_alias,g.operation)::text,'sha256'),'hex') then raise exception 'Resource policy changed';end if;
  if bud.reserved_brl+bud.metered_brl+g.unit_max_brl>bud.cap_brl then raise exception 'Insufficient monetary headroom';end if;
  update public.regente10_mission_budgets set reserved_brl=reserved_brl+g.unit_max_brl,updated_at=now() where mission_id=m.id;
  update regente10_portao.grants set used_calls=used_calls+1 where id=g.id;
  insert into regente10_portao.events(request_key,owner_id,project_id,mission_id,binding_id,grant_id,operation,state,amount_brl)
   values((p->>'requestKey')::uuid,cfg.owner_id,pr,m.id,b.id,g.id,g.operation,'reserved',g.unit_max_brl) returning * into e;
  return jsonb_build_object('reused',false,'event',to_jsonb(e),'grant',to_jsonb(g),'binding',to_jsonb(b));
 elsif p_op='grant_private' then
  select * into g from regente10_portao.grants where id=(p->>'grantId')::uuid and project_id=pr and owner_id=cfg.owner_id;
  if not found then raise exception 'Grant outside project';end if;
  select * into b from regente10_portao.bindings where id=g.binding_id and project_id=pr and owner_id=cfg.owner_id;
  return jsonb_build_object('grant',to_jsonb(g),'binding',to_jsonb(b));
 elsif p_op='arm' then
  select * into e from regente10_portao.events where id=(p->>'eventId')::uuid and project_id=pr and owner_id=cfg.owner_id;
  if not found then raise exception 'Operation outside project';end if;
  perform 1 from public.regente10_missions where id=e.mission_id for update;
  perform 1 from public.regente10_mission_budgets where mission_id=e.mission_id for update;
  perform 1 from regente10_portao.grants where id=e.grant_id for update;
  perform 1 from regente10_portao.bindings where id=e.binding_id for update;
  select * into e from regente10_portao.events where id=e.id for update;
  if e.state<>'reserved' then raise exception 'Dispatch already claimed or unavailable';end if;
  select * into g from regente10_portao.grants where id=e.grant_id;
  select * into b from regente10_portao.bindings where id=e.binding_id;
  select * into m from public.regente10_missions where id=e.mission_id;
  if g.status<>'approved' or g.expires_at<=now() or b.revision<>g.binding_revision or b.status not in('active','no_auth') or m.owner_id<>cfg.owner_id or m.project<>pr or m.paused or m.status='concluida' then raise exception 'Dispatch authorization revoked';end if;
  if g.resource_db_hash is distinct from encode(extensions.digest(regente10_portao.assert_resource(pr,g.resource_alias,g.operation)::text,'sha256'),'hex') then raise exception 'Resource policy changed';end if;
  if not exists(select 1 from public.regente10_mission_budgets where mission_id=m.id and owner_id=cfg.owner_id and state='approved') then raise exception 'Financial authorization revoked';end if;
  update regente10_portao.events set state='dispatched',updated_at=now() where id=e.id;
  return jsonb_build_object('dispatch',true);
 elsif p_op in('complete','cancel') then
  select * into e from regente10_portao.events where id=(p->>'eventId')::uuid and project_id=pr and owner_id=cfg.owner_id;
  if not found then raise exception 'Operation outside project';end if;
  perform 1 from public.regente10_missions where id=e.mission_id for update;
  perform 1 from public.regente10_mission_budgets where mission_id=e.mission_id for update;
  select * into e from regente10_portao.events where id=e.id for update;
  if p_op='cancel' then
   if e.state<>'reserved' then raise exception 'Only undispatched work can release a reservation';end if;
   update public.regente10_mission_budgets set reserved_brl=reserved_brl-e.amount_brl,updated_at=now() where mission_id=e.mission_id;
   update regente10_portao.events set state='cancelled',diagnostic=p->>'diagnostic',updated_at=now() where id=e.id;
  else
   if e.state<>'dispatched' then raise exception 'Operation already settled or never dispatched';end if;
   if p->>'state'='completed' and length(coalesce(p->>'logId',''))>=5 then
    update public.regente10_mission_budgets set reserved_brl=reserved_brl-e.amount_brl,metered_brl=metered_brl+e.amount_brl,updated_at=now() where mission_id=e.mission_id;
    update regente10_portao.events set state='completed',provider_log_id=left(p->>'logId',150),result=p->'result',diagnostic='ceiling_committed_not_invoice',updated_at=now() where id=e.id;
   else
    update regente10_portao.events set state='uncertain',provider_log_id=left(p->>'logId',150),diagnostic=left(coalesce(p->>'diagnostic','provider_outcome_uncertain'),100),updated_at=now() where id=e.id;
   end if;
  end if;
  return jsonb_build_object('recorded',true);
 end if;
 raise exception 'Unknown gateway operation';
end $kernel$;
revoke all on function regente10_portao.kernel(text,jsonb,text) from public;
grant usage on schema regente10_portao to anon,authenticated;
grant execute on function regente10_portao.kernel(text,jsonb,text) to anon,authenticated;
create function public.regente10_gateway(p_operation text,p_payload jsonb,p_dispatch_key text) returns jsonb
language sql security invoker set search_path='' as $wrapper$
 select regente10_portao.kernel(p_operation,p_payload,p_dispatch_key);
$wrapper$;
revoke all on function public.regente10_gateway(text,jsonb,text) from public;
grant execute on function public.regente10_gateway(text,jsonb,text) to anon,authenticated;
