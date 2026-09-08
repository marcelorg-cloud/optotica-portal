begin;

-- Sincroniza o repositório com o schema real de produção (projeto optotica-dev),
-- extraído via pg_dump --schema-only em 07/09/2026.
--
-- Contexto: as migrações 202609020002 (self_registration), 202609020003
-- (master_professional_whatsapp), 202609030004 (cleanup_legacy_policies) e
-- 202609030005 (org_per_professional), citadas no histórico do projeto, nunca
-- chegaram a ser commitadas no GitHub — só existiam aplicadas diretamente em
-- produção. Este arquivo único traz todo esse conteúdo para o controle de
-- versão, com base no schema real (não numa reconstrução por descrição).
--
-- Idempotente: seguro de rodar tanto numa base já em dia com produção quanto
-- numa base nova que só tenha a migração 202609020001 aplicada.

-- =========================================================================
-- 1. Tabelas novas (controle de acesso: master, aprovação profissional,
--    convites de paciente por WhatsApp, laboratórios/catálogos, auditoria)
-- =========================================================================

create table if not exists public.system_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'master_admin' check (role = 'master_admin'),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.professional_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  email text not null,
  account_type text not null default 'professional' check (account_type in ('professional','optical_store')),
  display_name text not null,
  legal_name text,
  council_registration text,
  technical_responsible_name text,
  technical_responsible_registration text,
  cnpj text,
  address_line text,
  address_number text,
  address_complement text,
  district text,
  city text,
  state text,
  postal_code text,
  phone_e164 text,
  contact_name text,
  contact_email text,
  contact_phone_e164 text,
  status text not null default 'draft'
    check (status in ('draft','under_review','changes_requested','approved','rejected','suspended')),
  submitted_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.professional_laboratories (
  id uuid primary key default gen_random_uuid(),
  professional_profile_id uuid not null references public.professional_profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  name text not null,
  legal_name text,
  cnpj text not null,
  address_line text not null,
  address_number text,
  address_complement text,
  district text,
  city text not null,
  state text not null,
  postal_code text,
  phone_e164 text not null,
  contact_name text,
  status text not null default 'under_review'
    check (status in ('draft','under_review','changes_requested','approved','rejected','suspended')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.professional_profile_change_requests (
  id uuid primary key default gen_random_uuid(),
  professional_profile_id uuid not null references public.professional_profiles(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  reason text not null,
  proposed_changes jsonb not null default '{}'::jsonb check (jsonb_typeof(proposed_changes) = 'object'),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.laboratory_catalogs (
  id uuid primary key default gen_random_uuid(),
  laboratory_id uuid not null references public.professional_laboratories(id) on delete cascade,
  name text not null,
  version text,
  currency text not null default 'BRL',
  catalog_data jsonb not null default '{}'::jsonb check (jsonb_typeof(catalog_data) = 'object'),
  status text not null default 'draft'
    check (status in ('draft','under_review','changes_requested','approved','rejected','suspended')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.registration_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  email text not null,
  full_name text not null,
  requested_role text not null check (requested_role in ('patient','professional')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  source text not null default 'portal',
  policy_version text not null default '2026-09-01',
  accepted_terms_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.patient_access_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  professional_user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  expires_at timestamptz not null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  patient_name text,
  expected_whatsapp_e164 text,
  accepted_whatsapp_e164 text,
  opt_in_message_id text,
  revoked_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.patient_whatsapp_identities (
  whatsapp_e164 text primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.professional_client_assignments (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  professional_user_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  invitation_id uuid references public.patient_access_invitations(id) on delete set null,
  primary key (client_id, professional_user_id)
);

-- whatsapp_access_requests já existe desde 202609020001 (referenciada em política).
-- Aqui só garantimos as colunas adicionadas depois: o vínculo com o convite e o
-- controle de uso único (status/consumed_at), usado por /auth/confirm para
-- invalidar o link do WhatsApp depois do primeiro uso.
alter table public.whatsapp_access_requests
  add column if not exists invitation_id uuid references public.patient_access_invitations(id) on delete set null;
alter table public.whatsapp_access_requests
  add column if not exists status text not null default 'pending';
alter table public.whatsapp_access_requests
  add column if not exists consumed_at timestamptz;
alter table public.whatsapp_access_requests
  drop constraint if exists whatsapp_access_requests_status_check;
alter table public.whatsapp_access_requests
  add constraint whatsapp_access_requests_status_check
  check (status = any (array['pending','consumed','expired','revoked']));

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_type text not null check (actor_type in ('professional','client','system','master_admin')),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  ip_address inet,
  created_at timestamptz not null default now()
);

-- Correção de bug real encontrado em produção: log_master_action() grava
-- actor_type='master_admin', mas a constraint original (herdada de quando a
-- tabela foi criada só com 'professional'/'client'/'system') não permitia
-- esse valor. Isso nunca deu erro em produção só porque ninguém aprovou um
-- profissional de verdade ainda (banco praticamente vazio). Corrige tanto
-- quem já tem a tabela com a constraint antiga quanto quem está criando agora.
alter table public.audit_logs drop constraint if exists audit_logs_actor_type_check;
alter table public.audit_logs add constraint audit_logs_actor_type_check
  check (actor_type = any (array['professional','client','system','master_admin']));

-- =========================================================================
-- 2. Índices
-- =========================================================================

create index if not exists audit_organization_created_idx on public.audit_logs (organization_id, created_at desc);
create index if not exists patient_invitations_lookup_idx on public.patient_access_invitations (email, status, expires_at desc);
create index if not exists patient_invitations_professional_idx on public.patient_access_invitations (professional_user_id, status, expires_at desc);
create index if not exists professional_assignments_invitation_idx on public.professional_client_assignments (invitation_id) where (active = true);
create index if not exists professional_assignments_user_idx on public.professional_client_assignments (professional_user_id, active);
create index if not exists professional_laboratories_owner_idx on public.professional_laboratories (professional_profile_id, status);
create index if not exists professional_profiles_review_idx on public.professional_profiles (status, submitted_at desc);
create index if not exists registration_requests_status_idx on public.registration_requests (status, requested_role, created_at desc);

-- =========================================================================
-- 3. Funções de autorização e administração
-- =========================================================================

create or replace function public.is_master_admin() returns boolean
    language sql stable security definer
    set search_path to 'public'
    as $$
  select exists (
    select 1 from public.system_admins a
    where a.user_id = auth.uid() and a.active = true and a.role = 'master_admin'
  );
$$;

create or replace function public.is_approved_professional(target_user uuid default auth.uid()) returns boolean
    language sql stable security definer
    set search_path to 'public'
    as $$
  select exists (
    select 1 from public.professional_profiles p
    where p.user_id = target_user and p.status = 'approved'
  );
$$;

create or replace function public.can_access_client(target_client uuid, target_org uuid) returns boolean
    language sql stable security definer
    set search_path to 'public'
    as $$
  select target_client is not null and exists (
    select 1
    from public.clients c
    where c.id = target_client
      and c.organization_id = target_org
      and (
        public.is_client_user(target_client)
        or exists (
          select 1
          from public.professional_client_assignments a
          join public.patient_access_invitations i
            on i.id = a.invitation_id
            and i.professional_user_id = a.professional_user_id
            and i.client_id = a.client_id
            and i.status = 'accepted'
          where a.client_id = target_client
            and a.organization_id = target_org
            and a.professional_user_id = auth.uid()
            and a.active = true
            and public.is_approved_professional(a.professional_user_id)
        )
      )
  );
$$;

create or replace function public.can_manage_client(target_client uuid, target_org uuid) returns boolean
    language sql stable security definer
    set search_path to 'public'
    as $$
  select target_client is not null and exists (
    select 1
    from public.professional_client_assignments a
    join public.patient_access_invitations i
      on i.id = a.invitation_id
      and i.professional_user_id = a.professional_user_id
      and i.client_id = a.client_id
      and i.status = 'accepted'
    where a.client_id = target_client
      and a.organization_id = target_org
      and a.professional_user_id = auth.uid()
      and a.active = true
      and public.is_approved_professional(a.professional_user_id)
  );
$$;

create or replace function public.slugify(input text) returns text
    language sql immutable
    as $$
  select coalesce(
    nullif(
      trim(both '-' from
        regexp_replace(
          lower(translate(
            coalesce(input, ''),
            'áàâãäéèêëíìîïóòôõöúùûüñçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÑÇ',
            'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'
          )),
          '[^a-z0-9]+', '-', 'g'
        )
      ),
      ''
    ),
    'otica'
  );
$$;

create or replace function public.unique_org_slug(base text) returns text
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
  root      text := public.slugify(base);
  candidate text := root;
  n         int  := 0;
begin
  while exists (select 1 from public.organizations o where o.slug = candidate) loop
    n := n + 1;
    candidate := root || '-' || n::text;
  end loop;
  return candidate;
end;
$$;

create or replace function public.log_master_action(target_org uuid, action_name text, entity_kind text, entity uuid, extra jsonb default '{}'::jsonb) returns void
    language plpgsql security definer
    set search_path to 'public'
    as $$
begin
  insert into public.audit_logs (
    organization_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    target_org, auth.uid(), 'master_admin', action_name, entity_kind, entity, coalesce(extra, '{}'::jsonb)
  );
end;
$$;

create or replace function public.approve_professional(target_profile uuid, notes text default null::text) returns void
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
  prof public.professional_profiles;
begin
  if not public.is_master_admin() then
    raise exception 'apenas o master pode aprovar profissionais';
  end if;

  select * into prof from public.professional_profiles where id = target_profile;
  if not found then
    raise exception 'perfil profissional % nao encontrado', target_profile;
  end if;
  if prof.organization_id is null then
    raise exception 'perfil % nao possui organizacao vinculada', target_profile;
  end if;

  update public.professional_profiles
     set status       = 'approved',
         approved_at  = now(),
         reviewed_by  = auth.uid(),
         reviewed_at  = now(),
         review_notes = notes,
         updated_at   = now()
   where id = target_profile;

  update public.organizations
     set active = true, updated_at = now()
   where id = prof.organization_id;

  update public.organization_members
     set active = true
   where organization_id = prof.organization_id
     and user_id = prof.user_id;

  update public.registration_requests
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
         review_notes = notes, updated_at = now()
   where user_id = prof.user_id;

  perform public.log_master_action(
    prof.organization_id, 'professional.approved', 'professional_profile',
    target_profile, jsonb_build_object('notes', notes)
  );
end;
$$;

create or replace function public.reject_professional(target_profile uuid, notes text) returns void
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
  prof public.professional_profiles;
begin
  if not public.is_master_admin() then
    raise exception 'apenas o master pode rejeitar profissionais';
  end if;
  if coalesce(trim(notes), '') = '' then
    raise exception 'a rejeicao exige justificativa';
  end if;

  select * into prof from public.professional_profiles where id = target_profile;
  if not found then
    raise exception 'perfil profissional % nao encontrado', target_profile;
  end if;

  update public.professional_profiles
     set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
         review_notes = notes, approved_at = null, updated_at = now()
   where id = target_profile;

  update public.organizations   set active = false, updated_at = now() where id = prof.organization_id;
  update public.organization_members set active = false
   where organization_id = prof.organization_id and user_id = prof.user_id;

  update public.registration_requests
     set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
         review_notes = notes, updated_at = now()
   where user_id = prof.user_id;

  perform public.log_master_action(
    prof.organization_id, 'professional.rejected', 'professional_profile',
    target_profile, jsonb_build_object('notes', notes)
  );
end;
$$;

create or replace function public.request_professional_changes(target_profile uuid, notes text) returns void
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
  prof public.professional_profiles;
begin
  if not public.is_master_admin() then
    raise exception 'apenas o master pode solicitar correcoes';
  end if;
  if coalesce(trim(notes), '') = '' then
    raise exception 'o pedido de correcao exige descricao do que corrigir';
  end if;

  select * into prof from public.professional_profiles where id = target_profile;
  if not found then
    raise exception 'perfil profissional % nao encontrado', target_profile;
  end if;

  update public.professional_profiles
     set status = 'changes_requested', reviewed_by = auth.uid(), reviewed_at = now(),
         review_notes = notes, updated_at = now()
   where id = target_profile;

  perform public.log_master_action(
    prof.organization_id, 'professional.changes_requested', 'professional_profile',
    target_profile, jsonb_build_object('notes', notes)
  );
end;
$$;

create or replace function public.suspend_professional(target_profile uuid, notes text) returns void
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
  prof public.professional_profiles;
begin
  if not public.is_master_admin() then
    raise exception 'apenas o master pode suspender profissionais';
  end if;
  if coalesce(trim(notes), '') = '' then
    raise exception 'a suspensao exige justificativa';
  end if;

  select * into prof from public.professional_profiles where id = target_profile;
  if not found then
    raise exception 'perfil profissional % nao encontrado', target_profile;
  end if;

  update public.professional_profiles
     set status = 'suspended', reviewed_by = auth.uid(), reviewed_at = now(),
         review_notes = notes, updated_at = now()
   where id = target_profile;

  update public.organization_members set active = false
   where organization_id = prof.organization_id and user_id = prof.user_id;

  update public.organizations set active = false, updated_at = now()
   where id = prof.organization_id;

  perform public.log_master_action(
    prof.organization_id, 'professional.suspended', 'professional_profile',
    target_profile, jsonb_build_object('notes', notes)
  );
end;
$$;

create or replace function public.reactivate_professional(target_profile uuid, notes text default null::text) returns void
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
  prof public.professional_profiles;
begin
  if not public.is_master_admin() then
    raise exception 'apenas o master pode reativar profissionais';
  end if;

  select * into prof from public.professional_profiles where id = target_profile;
  if not found then
    raise exception 'perfil profissional % nao encontrado', target_profile;
  end if;
  if prof.status <> 'suspended' then
    raise exception 'somente perfil suspenso pode ser reativado (status atual: %)', prof.status;
  end if;

  update public.professional_profiles
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
         review_notes = notes, updated_at = now()
   where id = target_profile;

  update public.organizations set active = true, updated_at = now()
   where id = prof.organization_id;

  update public.organization_members set active = true
   where organization_id = prof.organization_id and user_id = prof.user_id;

  perform public.log_master_action(
    prof.organization_id, 'professional.reactivated', 'professional_profile',
    target_profile, jsonb_build_object('notes', notes)
  );
end;
$$;

-- =========================================================================
-- 4. Autocadastro profissional (organização própria por profissional/ótica)
-- =========================================================================

create or replace function public.handle_self_registration() returns trigger
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
  target_name text;
  new_org     uuid;
begin
  if coalesce(new.raw_user_meta_data ->> 'requested_role', '') <> 'professional' then
    return new;
  end if;

  target_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    split_part(coalesce(new.email, 'novo profissional'), '@', 1)
  );

  -- Organização exclusiva deste profissional/ótica.
  -- active = false: nada é liberado antes da aprovação do master.
  insert into public.organizations (name, slug, active)
  values (target_name, public.unique_org_slug(target_name), false)
  returning id into new_org;

  -- Profissional é dono da própria organização, membro inativo por enquanto.
  -- is_org_member() exige active = true, então catálogos seguem bloqueados.
  insert into public.organization_members (organization_id, user_id, role, active)
  values (new_org, new.id, 'owner', false)
  on conflict do nothing;

  insert into public.professional_profiles (user_id, organization_id, email, display_name)
  values (new.id, new_org, coalesce(new.email, ''), target_name)
  on conflict (user_id) do nothing;

  insert into public.registration_requests (
    user_id, organization_id, email, full_name, requested_role, source, policy_version
  ) values (
    new.id, new_org, coalesce(new.email, ''), target_name, 'professional',
    coalesce(new.raw_user_meta_data ->> 'registration_source', 'portal'),
    coalesce(new.raw_user_meta_data ->> 'policy_version', '2026-09-01')
  ) on conflict (user_id) do nothing;

  return new;
end;
$$;

create or replace trigger on_auth_user_self_registration
  after insert on auth.users
  for each row execute function public.handle_self_registration();

-- =========================================================================
-- 5. Row Level Security
-- =========================================================================

alter table public.system_admins enable row level security;
alter table public.professional_profiles enable row level security;
alter table public.professional_laboratories enable row level security;
alter table public.professional_profile_change_requests enable row level security;
alter table public.laboratory_catalogs enable row level security;
alter table public.registration_requests enable row level security;
alter table public.patient_access_invitations enable row level security;
alter table public.patient_whatsapp_identities enable row level security;
alter table public.professional_client_assignments enable row level security;
alter table public.audit_logs enable row level security;

-- system_admins: cada admin só enxerga o próprio registro (sem política de
-- escrita: cadastro de master é feito só via service role).
drop policy if exists system_admins_self_read on public.system_admins;
create policy system_admins_self_read on public.system_admins
  for select to authenticated using (user_id = auth.uid());

-- professional_profiles: o próprio profissional ou o master.
drop policy if exists professional_profiles_owner_read on public.professional_profiles;
create policy professional_profiles_owner_read on public.professional_profiles
  for select to authenticated using ((user_id = auth.uid()) or public.is_master_admin());

-- professional_laboratories: dono do perfil profissional vinculado, ou master.
drop policy if exists professional_labs_owner_read on public.professional_laboratories;
create policy professional_labs_owner_read on public.professional_laboratories
  for select to authenticated using (
    public.is_master_admin() or exists (
      select 1 from public.professional_profiles p
      where p.id = professional_laboratories.professional_profile_id and p.user_id = auth.uid()
    )
  );

-- professional_profile_change_requests: quem pediu, ou o master.
drop policy if exists profile_changes_owner_read on public.professional_profile_change_requests;
create policy profile_changes_owner_read on public.professional_profile_change_requests
  for select to authenticated using ((requested_by = auth.uid()) or public.is_master_admin());

-- laboratory_catalogs: dono do laboratório (via perfil profissional), ou master.
drop policy if exists laboratory_catalogs_owner_read on public.laboratory_catalogs;
create policy laboratory_catalogs_owner_read on public.laboratory_catalogs
  for select to authenticated using (
    public.is_master_admin() or exists (
      select 1
      from public.professional_laboratories l
      join public.professional_profiles p on p.id = l.professional_profile_id
      where l.id = laboratory_catalogs.laboratory_id and p.user_id = auth.uid()
    )
  );

-- registration_requests: o próprio solicitante, ou owner/admin da organização.
drop policy if exists registration_requests_read on public.registration_requests;
create policy registration_requests_read on public.registration_requests
  for select using ((user_id = auth.uid()) or public.has_org_role(organization_id, array['owner','admin']));

drop policy if exists registration_requests_review on public.registration_requests;
create policy registration_requests_review on public.registration_requests
  for update using (public.has_org_role(organization_id, array['owner','admin']))
  with check (public.has_org_role(organization_id, array['owner','admin']));

-- patient_access_invitations: só o profissional que criou o convite enxerga
-- (o paciente acessa pela rota pública com token, fora de RLS).
drop policy if exists invitations_read on public.patient_access_invitations;
create policy invitations_read on public.patient_access_invitations
  for select to authenticated using (professional_user_id = auth.uid());

-- patient_whatsapp_identities: sem política (toda leitura/escrita passa por
-- função security definer / rota de servidor) — igual à produção.

-- professional_client_assignments: o profissional do vínculo, ou o próprio paciente.
drop policy if exists assignments_read on public.professional_client_assignments;
create policy assignments_read on public.professional_client_assignments
  for select to authenticated using ((professional_user_id = auth.uid()) or public.is_client_user(client_id));

-- audit_logs: owner/admin da organização auditada.
drop policy if exists audit_read_admin on public.audit_logs;
create policy audit_read_admin on public.audit_logs
  for select to authenticated using (public.has_org_role(organization_id, array['owner','admin']));

-- =========================================================================
-- 6. Storage: políticas por convite/vínculo (substituem as por organização
--    criadas em 202609020001 — cleanup de storage, ex-migração 004)
-- =========================================================================

drop policy if exists client_documents_read on storage.objects;
drop policy if exists client_documents_add_staff on storage.objects;
drop policy if exists client_documents_change_staff on storage.objects;
drop policy if exists client_documents_remove_staff on storage.objects;
drop policy if exists client_documents_remove on storage.objects;
drop policy if exists try_on_photos_read on storage.objects;
drop policy if exists try_on_photos_add on storage.objects;
drop policy if exists try_on_photos_change on storage.objects;
drop policy if exists try_on_photos_remove on storage.objects;

create policy client_documents_read on storage.objects for select to authenticated using (
  bucket_id = 'client-documents' and public.can_access_client(public.safe_storage_uuid(name,2), public.safe_storage_uuid(name,1))
);
create policy client_documents_add_staff on storage.objects for insert to authenticated with check (
  bucket_id = 'client-documents' and public.can_manage_client(public.safe_storage_uuid(name,2), public.safe_storage_uuid(name,1))
);
create policy client_documents_change_staff on storage.objects for update to authenticated using (
  bucket_id = 'client-documents' and public.can_manage_client(public.safe_storage_uuid(name,2), public.safe_storage_uuid(name,1))
) with check (
  bucket_id = 'client-documents' and public.can_manage_client(public.safe_storage_uuid(name,2), public.safe_storage_uuid(name,1))
);
create policy client_documents_remove on storage.objects for delete to authenticated using (
  bucket_id = 'client-documents' and public.can_manage_client(public.safe_storage_uuid(name,2), public.safe_storage_uuid(name,1))
);

create policy try_on_photos_read on storage.objects for select to authenticated using (
  bucket_id = 'try-on-photos' and public.can_access_client(public.safe_storage_uuid(name,2), public.safe_storage_uuid(name,1))
);
create policy try_on_photos_add on storage.objects for insert to authenticated with check (
  bucket_id = 'try-on-photos' and (
    public.is_client_user(public.safe_storage_uuid(name,2))
    or public.can_manage_client(public.safe_storage_uuid(name,2), public.safe_storage_uuid(name,1))
  )
);
create policy try_on_photos_remove on storage.objects for delete to authenticated using (
  bucket_id = 'try-on-photos' and (
    public.is_client_user(public.safe_storage_uuid(name,2))
    or public.can_manage_client(public.safe_storage_uuid(name,2), public.safe_storage_uuid(name,1))
  )
);
-- Nota: produção não tem política de UPDATE para try-on-photos (só read/add/remove).

-- =========================================================================
-- 7. Privilégios das funções administrativas (só o master, via authenticated;
--    nunca anon/public)
-- =========================================================================

revoke all on function public.approve_professional(uuid, text) from public;
revoke all on function public.reject_professional(uuid, text) from public;
revoke all on function public.request_professional_changes(uuid, text) from public;
revoke all on function public.suspend_professional(uuid, text) from public;
revoke all on function public.reactivate_professional(uuid, text) from public;

grant execute on function public.approve_professional(uuid, text) to authenticated;
grant execute on function public.reject_professional(uuid, text) to authenticated;
grant execute on function public.request_professional_changes(uuid, text) to authenticated;
grant execute on function public.suspend_professional(uuid, text) to authenticated;
grant execute on function public.reactivate_professional(uuid, text) to authenticated;

commit;
