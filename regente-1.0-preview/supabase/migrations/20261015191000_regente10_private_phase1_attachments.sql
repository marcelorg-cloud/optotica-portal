-- Private, mission-scoped Fase 1 files. No service_role in browser or agent.
-- User must affirm file contains NO clinical, personal, or sensitive material while CE14 is pending.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('regente10-phase1','regente10-phase1',false,3145728,
 array['text/plain','text/markdown','text/csv','application/json','application/pdf',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg']::text[])
on conflict(id) do nothing;
do $check$
begin
 if not exists(select 1 from storage.buckets where id='regente10-phase1'
  and public=false and file_size_limit<=3145728)
 then raise exception 'Bucket de anexos ausente ou com política de privacidade inadequada';end if;
end$check$;

create table if not exists public.regente10_mission_files(
 id uuid primary key,
 owner_id uuid not null references auth.users(id),
 mission_id uuid not null references public.regente10_missions(id) on delete cascade,
 storage_path text not null unique,
 filename text not null,
 mime text not null,
 size_bytes integer not null check(size_bytes>0 and size_bytes<=3145728),
 include_in_ai boolean not null default false,
 acknowledged_nonpersonal boolean not null default true check(acknowledged_nonpersonal=true),
 created_at timestamptz not null default now(),
 check(char_length(filename) between 1 and 130),
 check(storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.](txt|md|csv|json|pdf|docx|png|jpg)$'),
 check(mime in('text/plain','text/markdown','text/csv','application/json','application/pdf',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg')),
 check((include_in_ai=false) or mime in ('text/plain','text/markdown','text/csv','application/json',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
);
create index if not exists idx_regente10_mission_files_owner_mission on public.regente10_mission_files(owner_id,mission_id,created_at);
alter table public.regente10_mission_files enable row level security;
revoke all on public.regente10_mission_files from anon,authenticated;
grant select,insert,delete on public.regente10_mission_files to authenticated;

create policy regente10_files_master_select on public.regente10_mission_files
 for select to authenticated using(owner_id=(select auth.uid())
  and exists(select 1 from public.system_admins a where a.user_id=(select auth.uid()) and a.active)
  and exists(select 1 from public.regente10_missions m where m.id=mission_id and m.owner_id=(select auth.uid())));
create policy regente10_files_master_insert on public.regente10_mission_files
 for insert to authenticated with check(owner_id=(select auth.uid())
  and exists(select 1 from public.system_admins a where a.user_id=(select auth.uid()) and a.active)
  and exists(select 1 from public.regente10_missions m where m.id=mission_id and m.owner_id=(select auth.uid())
    and m.status in('afinamento','aguardando_autorizacao') and m.paused=false));
create policy regente10_files_master_delete on public.regente10_mission_files
 for delete to authenticated using(owner_id=(select auth.uid())
  and exists(select 1 from public.system_admins a where a.user_id=(select auth.uid()) and a.active));

-- Prevent a fabricated DB record for non-existing object and enforce a 5 file cap.
create or replace function public.regente10_check_mission_file() returns trigger
language plpgsql security definer set search_path=public,storage,pg_temp as $guard$
declare v_object storage.objects%rowtype;v_extension text;v_mimetype text;
begin
 if new.storage_path not like new.owner_id::text||'/'||new.mission_id::text||'/'||new.id::text||'.%' then
  raise exception 'Caminho do arquivo fora da missão';end if;
 perform pg_advisory_xact_lock(hashtextextended(new.mission_id::text,62015));
 if (select count(*) from public.regente10_mission_files where mission_id=new.mission_id)>=5
 then raise exception 'Limite de 5 arquivos por missão';end if;
 select * into v_object from storage.objects
 where bucket_id='regente10-phase1' and name=new.storage_path and owner_id=new.owner_id::text
 limit 1;
 if not found then raise exception 'Arquivo precisa ser enviado ao armazenamento privado antes do registro';end if;
 if (v_object.metadata->>'size') is null or (v_object.metadata->>'size')::bigint<>new.size_bytes
 then raise exception 'Tamanho do arquivo não coincide com o objeto privado';end if;
 v_extension=lower(split_part(new.storage_path,'.',2));
 if (v_extension='txt' and new.mime<>'text/plain')
 or (v_extension='md' and new.mime<>'text/markdown')
 or (v_extension='csv' and new.mime<>'text/csv')
 or (v_extension='json' and new.mime<>'application/json')
 or (v_extension='pdf' and new.mime<>'application/pdf')
 or (v_extension='docx' and new.mime<>'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
 or (v_extension='png' and new.mime<>'image/png')
 or (v_extension='jpg' and new.mime<>'image/jpeg')
 then raise exception 'Tipo do anexo difere da extensão';end if;
 if new.include_in_ai and new.mime in('application/pdf','image/png','image/jpeg')
 then raise exception 'Imagem/PDF ainda requerem revisão humana para análise de conteúdo';end if;
 return new;
end$guard$;
drop trigger if exists trg_regente10_check_mission_file on public.regente10_mission_files;
create trigger trg_regente10_check_mission_file before insert on public.regente10_mission_files
 for each row execute function public.regente10_check_mission_file();
revoke all on function public.regente10_check_mission_file() from public,anon,authenticated;

-- Private Storage RLS: object ID is owner UUID / mission UUID / random UUID.extension.
-- No global SELECT and no UPDATE/upsert policies.
create policy regente10_phase1_file_insert on storage.objects
 for insert to authenticated with check(
 bucket_id='regente10-phase1'
 and owner_id=(select auth.uid())::text
 and (storage.foldername(name))[1]=(select auth.uid())::text
 and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.](txt|md|csv|json|pdf|docx|png|jpg)$'
 and exists(select 1 from public.regente10_missions m
  where m.owner_id=(select auth.uid())
    and m.id::text=(storage.foldername(name))[2]
    and m.status in('afinamento','aguardando_autorizacao') and not m.paused)
 and exists(select 1 from public.system_admins a where a.user_id=(select auth.uid()) and a.active)
);
create policy regente10_phase1_file_read on storage.objects
 for select to authenticated using(
 bucket_id='regente10-phase1'
 and owner_id=(select auth.uid())::text
 and (storage.foldername(name))[1]=(select auth.uid())::text
 and exists(select 1 from public.regente10_missions m where m.owner_id=(select auth.uid())
  and m.id::text=(storage.foldername(name))[2])
 and exists(select 1 from public.system_admins a where a.user_id=(select auth.uid()) and a.active)
);
create policy regente10_phase1_file_delete on storage.objects
 for delete to authenticated using(
 bucket_id='regente10-phase1'
 and owner_id=(select auth.uid())::text
 and (storage.foldername(name))[1]=(select auth.uid())::text
 and exists(select 1 from public.system_admins a where a.user_id=(select auth.uid()) and a.active)
);
