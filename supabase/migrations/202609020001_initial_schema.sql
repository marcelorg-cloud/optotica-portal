begin;

create extension if not exists pgcrypto;
create extension if not exists citext;

create sequence if not exists public.order_number_seq start with 1289;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  status text not null default 'active' check (status in ('active','suspended','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  code text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  unique (company_id, id)
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email citext not null unique,
  full_name text not null,
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
  professional_registration text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  role text not null check (role in ('owner','admin','optometrist','staff','viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

alter table public.company_members
  add constraint company_members_unit_company_fk foreign key (company_id, unit_id) references public.units(company_id, id);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  auth_user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  whatsapp_e164 text not null check (whatsapp_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
  email citext,
  dnp_od numeric(5,2),
  dnp_oe numeric(5,2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, whatsapp_e164),
  unique (company_id, id),
  constraint clients_unit_company_fk foreign key (company_id, unit_id) references public.units(company_id, id)
);
create unique index clients_company_auth_user_unique on public.clients(company_id, auth_user_id) where auth_user_id is not null;

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  consent_type text not null check (consent_type in ('privacy','whatsapp','clinical_data','image','marketing')),
  source text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.consents
  add constraint consents_client_company_fk foreign key (company_id, client_id) references public.clients(company_id, id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  client_id uuid not null references public.clients(id) on delete restrict,
  assigned_professional_id uuid references auth.users(id) on delete set null,
  order_number bigint not null default nextval('public.order_number_seq'),
  status text not null default 'draft' check (status in ('draft','awaiting_choices','confirmed','frame_ordered','lens_production','assembly','ready','shipped','delivered','cancelled')),
  final_amount numeric(12,2) check (final_amount is null or final_amount >= 0),
  payment_method text check (payment_method is null or payment_method in ('cash','pix','payment_link','card_machine','other')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, order_number),
  unique (company_id, id),
  constraint orders_unit_company_fk foreign key (company_id, unit_id) references public.units(company_id, id),
  constraint orders_client_company_fk foreign key (company_id, client_id) references public.clients(company_id, id)
);

alter table public.prescriptions
  add constraint prescriptions_order_company_fk foreign key (company_id, order_id) references public.orders(company_id, id);

create table public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null unique references public.orders(id) on delete cascade,
  prescribed_by uuid references auth.users(id) on delete set null,
  od_sphere numeric(6,2), od_cylinder numeric(6,2), od_axis smallint check (od_axis between 0 and 180), od_addition numeric(6,2),
  oe_sphere numeric(6,2), oe_cylinder numeric(6,2), oe_axis smallint check (oe_axis between 0 and 180), oe_addition numeric(6,2),
  issued_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sku text,
  name text not null,
  lens_type text,
  refractive_index text,
  material text,
  treatment text,
  laboratory text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, sku),
  unique (company_id, id)
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  lens_id uuid references public.lenses(id) on delete set null,
  legacy_key text,
  details text not null,
  laboratory text,
  amount numeric(12,2) not null check (amount >= 0),
  notes text,
  selected_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.budgets
  add constraint budgets_order_company_fk foreign key (company_id, order_id) references public.orders(company_id, id),
  add constraint budgets_lens_company_fk foreign key (company_id, lens_id) references public.lenses(company_id, id),
  add constraint budgets_order_id_unique unique (order_id, id),
  add constraint budgets_order_legacy_unique unique (order_id, legacy_key);

alter table public.orders
  add column selected_budget_id uuid references public.budgets(id) on delete set null,
  add constraint orders_selected_budget_same_order_fk foreign key (id, selected_budget_id) references public.budgets(order_id, id);

create table public.frames (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sku text not null,
  name text not null,
  color text,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, sku),
  unique (company_id, id)
);

alter table public.order_frames
  add constraint order_frames_order_company_fk foreign key (company_id, order_id) references public.orders(company_id, id),
  add constraint order_frames_frame_company_fk foreign key (company_id, frame_id) references public.frames(company_id, id);

create table public.order_frames (
  order_id uuid primary key references public.orders(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  frame_id uuid references public.frames(id) on delete set null,
  frame_name text not null,
  sku text,
  color text,
  source text,
  selected_at timestamptz not null default now()
);

alter table public.documents
  add constraint documents_client_company_fk foreign key (company_id, client_id) references public.clients(company_id, id),
  add constraint documents_order_company_fk foreign key (company_id, order_id) references public.orders(company_id, id);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  document_type text not null check (document_type in ('photo','prescription','pdf','consent','other')),
  storage_bucket text not null default 'patient-documents',
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  company_id uuid,
  actor_user_id uuid,
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  occurred_at timestamptz not null default now()
);

create index clients_company_idx on public.clients(company_id);
create index clients_auth_user_idx on public.clients(auth_user_id);
create index orders_company_client_idx on public.orders(company_id, client_id);
create index orders_status_idx on public.orders(company_id, status);
create index documents_client_idx on public.documents(company_id, client_id);
create index audit_company_time_idx on public.audit_events(company_id, occurred_at desc);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create or replace function public.is_company_member(target_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.company_members m where m.company_id = target_company and m.user_id = auth.uid() and m.active);
$$;

create or replace function public.has_company_role(target_company uuid, allowed_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.company_members m where m.company_id = target_company and m.user_id = auth.uid() and m.active and m.role = any(allowed_roles));
$$;

create or replace function public.is_client_owner(target_client uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.clients c where c.id = target_client and c.auth_user_id = auth.uid() and c.active);
$$;

create or replace function public.can_access_company(target_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_company_member(target_company) or exists(select 1 from public.clients c where c.company_id = target_company and c.auth_user_id = auth.uid() and c.active);
$$;

create or replace function public.select_order_budget(target_order uuid, target_budget uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.orders o
    join public.budgets b on b.order_id = o.id
    where o.id = target_order and b.id = target_budget and public.is_client_owner(o.client_id)
  ) then
    raise exception 'budget_not_allowed';
  end if;
  update public.orders set selected_budget_id = target_budget, updated_at = now() where id = target_order;
  update public.budgets set selected_at = case when id = target_budget then now() else null end where order_id = target_order;
end;
$$;

create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare row_data jsonb; target_company uuid; target_id uuid;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  target_company := nullif(row_data->>'company_id','')::uuid;
  target_id := nullif(row_data->>'id','')::uuid;
  insert into public.audit_events(company_id, actor_user_id, table_name, record_id, action)
  values(target_company, auth.uid(), tg_table_name, target_id, tg_op);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['companies','units','profiles','clients','orders','prescriptions','budgets','frames'] loop
    execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
  foreach t in array array['clients','consents','orders','prescriptions','budgets','lenses','frames','order_frames','documents'] loop
    execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t, t);
  end loop;
end $$;

alter table public.companies enable row level security;
alter table public.units enable row level security;
alter table public.profiles enable row level security;
alter table public.company_members enable row level security;
alter table public.clients enable row level security;
alter table public.consents enable row level security;
alter table public.orders enable row level security;
alter table public.prescriptions enable row level security;
alter table public.lenses enable row level security;
alter table public.budgets enable row level security;
alter table public.frames enable row level security;
alter table public.order_frames enable row level security;
alter table public.documents enable row level security;
alter table public.audit_events enable row level security;

create policy companies_select on public.companies for select using (public.can_access_company(id));
create policy companies_admin on public.companies for update using (public.has_company_role(id,array['owner','admin'])) with check (public.has_company_role(id,array['owner','admin']));
create policy units_select on public.units for select using (public.can_access_company(company_id));
create policy units_write on public.units for all using (public.has_company_role(company_id,array['owner','admin'])) with check (public.has_company_role(company_id,array['owner','admin']));
create policy profiles_self_select on public.profiles for select using (user_id = auth.uid() or exists(select 1 from public.company_members mine join public.company_members theirs using(company_id) where mine.user_id=auth.uid() and mine.active and theirs.user_id=profiles.user_id and theirs.active));
create policy profiles_self_update on public.profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy members_select on public.company_members for select using (public.is_company_member(company_id));
create policy members_admin on public.company_members for all using (public.has_company_role(company_id,array['owner','admin'])) with check (public.has_company_role(company_id,array['owner','admin']));
create policy clients_select on public.clients for select using (public.is_company_member(company_id) or auth_user_id = auth.uid());
create policy clients_write on public.clients for all using (public.has_company_role(company_id,array['owner','admin','optometrist','staff'])) with check (public.has_company_role(company_id,array['owner','admin','optometrist','staff']));
create policy consents_select on public.consents for select using (public.is_company_member(company_id) or public.is_client_owner(client_id));
create policy consents_write on public.consents for all using (public.has_company_role(company_id,array['owner','admin','optometrist','staff'])) with check (public.has_company_role(company_id,array['owner','admin','optometrist','staff']));
create policy orders_select on public.orders for select using (public.is_company_member(company_id) or public.is_client_owner(client_id));
create policy orders_write on public.orders for all using (public.has_company_role(company_id,array['owner','admin','optometrist','staff'])) with check (public.has_company_role(company_id,array['owner','admin','optometrist','staff']));
create policy prescriptions_select on public.prescriptions for select using (public.is_company_member(company_id) or exists(select 1 from public.orders o where o.id=order_id and public.is_client_owner(o.client_id)));
create policy prescriptions_write on public.prescriptions for all using (public.has_company_role(company_id,array['owner','admin','optometrist'])) with check (public.has_company_role(company_id,array['owner','admin','optometrist']));
create policy lenses_select on public.lenses for select using (public.can_access_company(company_id));
create policy lenses_write on public.lenses for all using (public.has_company_role(company_id,array['owner','admin','optometrist','staff'])) with check (public.has_company_role(company_id,array['owner','admin','optometrist','staff']));
create policy budgets_select on public.budgets for select using (public.is_company_member(company_id) or exists(select 1 from public.orders o where o.id=order_id and public.is_client_owner(o.client_id)));
create policy budgets_professional_write on public.budgets for all using (public.has_company_role(company_id,array['owner','admin','optometrist','staff'])) with check (public.has_company_role(company_id,array['owner','admin','optometrist','staff']));
create policy frames_select on public.frames for select using (public.can_access_company(company_id));
create policy frames_write on public.frames for all using (public.has_company_role(company_id,array['owner','admin','staff'])) with check (public.has_company_role(company_id,array['owner','admin','staff']));
create policy order_frames_select on public.order_frames for select using (public.is_company_member(company_id) or exists(select 1 from public.orders o where o.id=order_id and public.is_client_owner(o.client_id)));
create policy order_frames_professional_write on public.order_frames for all using (public.has_company_role(company_id,array['owner','admin','optometrist','staff'])) with check (public.has_company_role(company_id,array['owner','admin','optometrist','staff']));
create policy documents_select on public.documents for select using (public.is_company_member(company_id) or public.is_client_owner(client_id));
create policy documents_write on public.documents for all using (public.has_company_role(company_id,array['owner','admin','optometrist','staff'])) with check (public.has_company_role(company_id,array['owner','admin','optometrist','staff']));
create policy audit_admin_select on public.audit_events for select using (public.has_company_role(company_id,array['owner','admin']));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('patient-documents','patient-documents',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

create policy patient_documents_select on storage.objects for select to authenticated using (
  bucket_id='patient-documents' and public.can_access_company((storage.foldername(name))[1]::uuid)
);
create policy patient_documents_insert on storage.objects for insert to authenticated with check (
  bucket_id='patient-documents' and public.has_company_role((storage.foldername(name))[1]::uuid,array['owner','admin','optometrist','staff'])
);
create policy patient_documents_update on storage.objects for update to authenticated using (
  bucket_id='patient-documents' and public.has_company_role((storage.foldername(name))[1]::uuid,array['owner','admin','optometrist','staff'])
) with check (
  bucket_id='patient-documents' and public.has_company_role((storage.foldername(name))[1]::uuid,array['owner','admin','optometrist','staff'])
);
create policy patient_documents_delete on storage.objects for delete to authenticated using (
  bucket_id='patient-documents' and public.has_company_role((storage.foldername(name))[1]::uuid,array['owner','admin'])
);

revoke all on public.audit_events from anon, authenticated;
grant select on public.audit_events to authenticated;
grant usage, select on sequence public.order_number_seq to authenticated;
revoke all on function public.select_order_budget(uuid,uuid) from public;
grant execute on function public.select_order_budget(uuid,uuid) to authenticated;

commit;
