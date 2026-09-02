begin;

-- Extensão incremental do esquema que já existe no projeto optotica-dev.
-- Preserva organizations, organization_members, profiles e todos os demais registros.

alter table public.clients add column if not exists dnp_od numeric(5,2);
alter table public.clients add column if not exists dnp_oe numeric(5,2);
alter table public.orders add column if not exists payment_method text;
alter table public.quotes add column if not exists legacy_key text;
alter table public.quote_items add column if not exists legacy_key text;

create unique index if not exists prescriptions_order_unique on public.prescriptions(order_id) where order_id is not null;
create unique index if not exists quotes_org_legacy_unique on public.quotes(organization_id, legacy_key) where legacy_key is not null;
create unique index if not exists quote_items_quote_legacy_unique on public.quote_items(quote_id, legacy_key) where legacy_key is not null;

create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, code)
);

create table if not exists public.lenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sku text,
  name text not null,
  lens_type text,
  refractive_index text,
  material text,
  treatment text,
  laboratory text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, sku)
);

create table if not exists public.frames (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sku text not null,
  name text not null,
  color text,
  source text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, sku)
);

create table if not exists public.order_frames (
  order_id uuid primary key references public.orders(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  frame_id uuid references public.frames(id) on delete set null,
  frame_name text not null,
  sku text,
  color text,
  source text,
  selected_at timestamptz not null default now()
);

alter table public.units enable row level security;
alter table public.lenses enable row level security;
alter table public.frames enable row level security;
alter table public.order_frames enable row level security;

create or replace function public.client_belongs_to_org(target_client uuid, target_org uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.clients c where c.id=target_client and c.organization_id=target_org);
$$;

create or replace function public.order_belongs_to_org(target_order uuid, target_org uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.orders o where o.id=target_order and o.organization_id=target_org);
$$;

drop policy if exists consents_add_staff on public.client_consents;
create policy consents_add_staff on public.client_consents for insert with check (
  public.is_org_member(organization_id) and (client_id is null or public.client_belongs_to_org(client_id,organization_id))
);

drop policy if exists orders_add on public.orders;
create policy orders_add on public.orders for insert with check (
  public.is_org_member(organization_id) and public.client_belongs_to_org(client_id,organization_id)
);
drop policy if exists orders_change on public.orders;
create policy orders_change on public.orders for update using (
  public.is_org_member(organization_id)
) with check (
  public.is_org_member(organization_id) and public.client_belongs_to_org(client_id,organization_id)
);

drop policy if exists prescriptions_add on public.prescriptions;
create policy prescriptions_add on public.prescriptions for insert with check (
  public.is_org_member(organization_id)
  and public.client_belongs_to_org(client_id,organization_id)
  and (order_id is null or public.order_belongs_to_org(order_id,organization_id))
);
drop policy if exists prescriptions_change on public.prescriptions;
create policy prescriptions_change on public.prescriptions for update using (
  public.is_org_member(organization_id)
) with check (
  public.is_org_member(organization_id)
  and public.client_belongs_to_org(client_id,organization_id)
  and (order_id is null or public.order_belongs_to_org(order_id,organization_id))
);

drop policy if exists documents_add_staff on public.documents;
create policy documents_add_staff on public.documents for insert with check (
  public.is_org_member(organization_id)
  and public.client_belongs_to_org(client_id,organization_id)
  and (order_id is null or public.order_belongs_to_org(order_id,organization_id))
);
drop policy if exists documents_add_client_photo on public.documents;
create policy documents_add_client_photo on public.documents for insert with check (
  document_type='try_on_photo'
  and public.is_client_user(client_id)
  and public.client_belongs_to_org(client_id,organization_id)
);

drop policy if exists units_read on public.units;
create policy units_read on public.units for select using (public.is_org_member(organization_id));
drop policy if exists units_write on public.units;
create policy units_write on public.units for all using (public.has_org_role(organization_id,array['owner','admin'])) with check (public.has_org_role(organization_id,array['owner','admin']));

drop policy if exists lenses_read on public.lenses;
create policy lenses_read on public.lenses for select using (public.is_org_member(organization_id) or exists(select 1 from public.clients c where c.organization_id=lenses.organization_id and public.is_client_user(c.id)));
drop policy if exists lenses_write on public.lenses;
create policy lenses_write on public.lenses for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists frames_read on public.frames;
create policy frames_read on public.frames for select using (public.is_org_member(organization_id) or exists(select 1 from public.clients c where c.organization_id=frames.organization_id and public.is_client_user(c.id)));
drop policy if exists frames_write on public.frames;
create policy frames_write on public.frames for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists order_frames_read on public.order_frames;
create policy order_frames_read on public.order_frames for select using (
  public.is_org_member(organization_id) or exists(select 1 from public.orders o where o.id=order_id and public.is_client_user(o.client_id))
);
drop policy if exists order_frames_write on public.order_frames;
create policy order_frames_write on public.order_frames for all using (public.is_org_member(organization_id)) with check (
  public.is_org_member(organization_id) and public.order_belongs_to_org(order_id,organization_id)
);

drop policy if exists order_sequences_read on public.order_sequences;
create policy order_sequences_read on public.order_sequences for select using (public.is_org_member(organization_id));
drop policy if exists order_sequences_write on public.order_sequences;
create policy order_sequences_write on public.order_sequences for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists quotes_read on public.quotes;
create policy quotes_read on public.quotes for select using (public.is_org_member(organization_id) or public.is_client_user(client_id));
drop policy if exists quotes_write on public.quotes;
create policy quotes_write on public.quotes for all using (public.is_org_member(organization_id)) with check (
  public.is_org_member(organization_id)
  and public.client_belongs_to_org(client_id,organization_id)
  and (order_id is null or public.order_belongs_to_org(order_id,organization_id))
);

drop policy if exists quote_items_read on public.quote_items;
create policy quote_items_read on public.quote_items for select using (
  exists(select 1 from public.quotes q where q.id=quote_id and (public.is_org_member(q.organization_id) or public.is_client_user(q.client_id)))
);
drop policy if exists quote_items_write on public.quote_items;
create policy quote_items_write on public.quote_items for all using (
  exists(select 1 from public.quotes q where q.id=quote_id and public.is_org_member(q.organization_id))
) with check (
  exists(select 1 from public.quotes q where q.id=quote_id and public.is_org_member(q.organization_id))
);

drop policy if exists whatsapp_requests_read on public.whatsapp_access_requests;
create policy whatsapp_requests_read on public.whatsapp_access_requests for select using (
  public.has_org_role(organization_id,array['owner','admin'])
);

create or replace function public.safe_storage_uuid(object_name text, position_index integer)
returns uuid language plpgsql stable as $$
begin
  return (storage.foldername(object_name))[position_index]::uuid;
exception when others then
  return null;
end;
$$;

drop policy if exists client_documents_read on storage.objects;
create policy client_documents_read on storage.objects for select to authenticated using (
  bucket_id='client-documents' and (
    public.is_org_member(public.safe_storage_uuid(name,1)) or public.is_client_user(public.safe_storage_uuid(name,2))
  )
);
drop policy if exists client_documents_add_staff on storage.objects;
create policy client_documents_add_staff on storage.objects for insert to authenticated with check (
  bucket_id='client-documents' and public.is_org_member(public.safe_storage_uuid(name,1))
);
drop policy if exists client_documents_change_staff on storage.objects;
create policy client_documents_change_staff on storage.objects for update to authenticated using (
  bucket_id='client-documents' and public.is_org_member(public.safe_storage_uuid(name,1))
) with check (
  bucket_id='client-documents' and public.is_org_member(public.safe_storage_uuid(name,1))
);
drop policy if exists client_documents_remove_staff on storage.objects;
create policy client_documents_remove_staff on storage.objects for delete to authenticated using (
  bucket_id='client-documents' and public.has_org_role(public.safe_storage_uuid(name,1),array['owner','admin'])
);

drop policy if exists try_on_photos_read on storage.objects;
create policy try_on_photos_read on storage.objects for select to authenticated using (
  bucket_id='try-on-photos' and (
    public.is_org_member(public.safe_storage_uuid(name,1)) or public.is_client_user(public.safe_storage_uuid(name,2))
  )
);
drop policy if exists try_on_photos_add on storage.objects;
create policy try_on_photos_add on storage.objects for insert to authenticated with check (
  bucket_id='try-on-photos' and (
    public.is_org_member(public.safe_storage_uuid(name,1)) or public.is_client_user(public.safe_storage_uuid(name,2))
  )
);
drop policy if exists try_on_photos_change on storage.objects;
create policy try_on_photos_change on storage.objects for update to authenticated using (
  bucket_id='try-on-photos' and (
    public.is_org_member(public.safe_storage_uuid(name,1)) or public.is_client_user(public.safe_storage_uuid(name,2))
  )
) with check (
  bucket_id='try-on-photos' and (
    public.is_org_member(public.safe_storage_uuid(name,1)) or public.is_client_user(public.safe_storage_uuid(name,2))
  )
);
drop policy if exists try_on_photos_remove on storage.objects;
create policy try_on_photos_remove on storage.objects for delete to authenticated using (
  bucket_id='try-on-photos' and (
    public.is_org_member(public.safe_storage_uuid(name,1)) or public.is_client_user(public.safe_storage_uuid(name,2))
  )
);

commit;
