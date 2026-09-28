begin;

-- One monotonic revision represents every input that defines the front geometry.
-- Canva pages, edit sessions and saved try-on PNGs record which revision they used.
alter table public.catalog_products
  add column if not exists canva_reference_revision bigint not null default 1
    check (canva_reference_revision > 0);

alter table public.catalog_canva_designs
  add column if not exists reference_revision bigint check (reference_revision > 0);

alter table public.canva_edit_sessions
  add column if not exists reference_revision bigint check (reference_revision > 0);

alter table public.catalog_product_color_images
  add column if not exists processed_reference_revision bigint check (processed_reference_revision > 0);

create or replace function public.bump_canva_reference_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old_values jsonb;
  new_values jsonb;
begin
  -- to_jsonb keeps this migration compatible with installations where older
  -- optional measurement columns were introduced outside the migration set.
  old_values := jsonb_build_array(
    to_jsonb(old) -> 'position_image_path',
    to_jsonb(old) -> 'position_image_updated_at',
    to_jsonb(old) -> 'lens_width_mm',
    to_jsonb(old) -> 'lens_height_mm',
    to_jsonb(old) -> 'bridge_mm',
    to_jsonb(old) -> 'lens_diagonal_mm',
    to_jsonb(old) -> 'temple_length_mm',
    to_jsonb(old) -> 'rim_mm',
    to_jsonb(old) -> 'frame_total_width_mm',
    to_jsonb(old) -> 'standard_height_mm'
  );
  new_values := jsonb_build_array(
    to_jsonb(new) -> 'position_image_path',
    to_jsonb(new) -> 'position_image_updated_at',
    to_jsonb(new) -> 'lens_width_mm',
    to_jsonb(new) -> 'lens_height_mm',
    to_jsonb(new) -> 'bridge_mm',
    to_jsonb(new) -> 'lens_diagonal_mm',
    to_jsonb(new) -> 'temple_length_mm',
    to_jsonb(new) -> 'rim_mm',
    to_jsonb(new) -> 'frame_total_width_mm',
    to_jsonb(new) -> 'standard_height_mm'
  );
  if old_values is distinct from new_values then
    new.canva_reference_revision := old.canva_reference_revision + 1;
  else
    new.canva_reference_revision := old.canva_reference_revision;
  end if;
  return new;
end;
$$;

revoke all on function public.bump_canva_reference_revision() from public, anon, authenticated;

drop trigger if exists bump_canva_reference_revision on public.catalog_products;
create trigger bump_canva_reference_revision
before update on public.catalog_products
for each row execute function public.bump_canva_reference_revision();

-- Compare and consume the review in one transaction, including the exact set
-- of measurement references used to produce the Canva result.
create or replace function public.save_canva_tryon(p_session_id uuid, p_user_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  s public.canva_edit_sessions%rowtype;
  c public.catalog_product_color_images%rowtype;
  current_width numeric;
  current_sku text;
  current_revision bigint;
begin
  if not exists (select 1 from public.system_admins where user_id = p_user_id and active) then
    raise exception 'CANVA_FORBIDDEN';
  end if;
  select * into s from public.canva_edit_sessions where id = p_session_id and user_id = p_user_id for update;
  if not found or s.expires_at <= now() or s.staged_path is null then raise exception 'CANVA_SESSION_INVALID'; end if;
  if s.saved_at is not null then return s.staged_path; end if;
  select frame_total_width_mm, sku_optotica, canva_reference_revision
    into current_width, current_sku, current_revision
    from public.catalog_products where id = s.product_id for update;
  select * into c from public.catalog_product_color_images where id = s.color_id and product_id = s.product_id for update;
  if not found or c.original_image_path is distinct from s.original_path
    or c.processed_image_path is distinct from s.previous_path
    or c.processed_at is distinct from s.previous_processed_at
    or current_width is distinct from s.frame_width_mm
    or current_revision is distinct from s.reference_revision
    or (s.sku_snapshot is not null and current_sku is distinct from s.sku_snapshot)
    or (s.variant_snapshot is not null and c.color_variant_number is distinct from s.variant_snapshot) then
    raise exception 'CANVA_CONFLICT';
  end if;
  update public.catalog_product_color_images set processed_image_path = s.staged_path,
    processed_reference_revision = current_revision,
    processed_at = now(), updated_at = now() where id = s.color_id;
  update public.canva_edit_sessions set saved_at = now() where id = s.id;
  return s.staged_path;
end;
$$;

revoke all on function public.save_canva_tryon(uuid, uuid) from public, anon, authenticated;
grant execute on function public.save_canva_tryon(uuid, uuid) to service_role;

commit;
