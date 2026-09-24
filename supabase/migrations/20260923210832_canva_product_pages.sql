create table public.canva_tryon_template (
  id text primary key check (id='default'),
  filename text not null,
  png_base64 text not null check (length(png_base64) <= 1398104),
  has_transparency boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create index canva_tryon_template_user on public.canva_tryon_template(updated_by);
create table public.canva_product_designs (
  product_id uuid primary key references public.catalog_products(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  canva_user_id text not null,
  canva_team_id text not null,
  design_id text unique,
  pending_color_id uuid references public.catalog_product_color_images(id) on delete set null,
  lock_token uuid,
  lock_until timestamptz not null default '-infinity',
  created_at timestamptz not null default now()
);
create index canva_product_designs_user on public.canva_product_designs(user_id);
create index canva_product_designs_pending on public.canva_product_designs(pending_color_id);
alter table public.canva_tryon_template enable row level security;
alter table public.canva_product_designs enable row level security;
revoke all on public.canva_tryon_template, public.canva_product_designs from public, anon, authenticated;
grant select, insert, update, delete on public.canva_tryon_template, public.canva_product_designs to service_role;
alter table public.catalog_canva_designs
  add column page_id text,
  add column page_number integer check (page_number between 1 and 500),
  add column page_filename text,
  add column page_stage text not null default 'idle' check (page_stage in ('idle','importing','imported','merging','ready','recovery')),
  add column import_job_id text,
  add column source_design_id text,
  add column merge_job_id text,
  add column before_page_ids jsonb,
  add column template_updated_at timestamptz;
create unique index catalog_canva_unique_page on public.catalog_canva_designs(design_id, page_id) where page_id is not null;
alter table public.canva_edit_sessions
  add column page_id text,
  add column export_filename text,
  add column export_page_ids jsonb,
  add column sku_snapshot text,
  add column variant_snapshot integer;

create or replace function public.save_canva_tryon(p_session_id uuid, p_user_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  s public.canva_edit_sessions%rowtype;
  c public.catalog_product_color_images%rowtype;
  current_width numeric;
  current_sku text;
begin
  if not exists (select 1 from public.system_admins where user_id = p_user_id and active) then
    raise exception 'CANVA_FORBIDDEN';
  end if;
  select * into s from public.canva_edit_sessions where id = p_session_id and user_id = p_user_id for update;
  if not found or s.expires_at <= now() or s.staged_path is null then raise exception 'CANVA_SESSION_INVALID'; end if;
  if s.saved_at is not null then return s.staged_path; end if;
  select frame_total_width_mm, sku_optotica into current_width, current_sku from public.catalog_products where id = s.product_id for update;
  select * into c from public.catalog_product_color_images where id = s.color_id and product_id = s.product_id for update;
  if not found or c.original_image_path is distinct from s.original_path
    or c.processed_image_path is distinct from s.previous_path
    or c.processed_at is distinct from s.previous_processed_at
    or current_width is distinct from s.frame_width_mm
    or (s.sku_snapshot is not null and current_sku is distinct from s.sku_snapshot)
    or (s.variant_snapshot is not null and c.color_variant_number is distinct from s.variant_snapshot) then
    raise exception 'CANVA_CONFLICT';
  end if;
  update public.catalog_product_color_images set processed_image_path = s.staged_path,
    processed_at = now(), updated_at = now() where id = s.color_id;
  update public.canva_edit_sessions set saved_at = now() where id = s.id;
  return s.staged_path;
end;
$$;
revoke all on function public.save_canva_tryon(uuid, uuid) from public, anon, authenticated;
grant execute on function public.save_canva_tryon(uuid, uuid) to service_role;
