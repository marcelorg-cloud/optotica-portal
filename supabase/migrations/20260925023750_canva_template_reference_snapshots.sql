begin;

-- The shared full-page model is a reference too. Sessions and saved PNGs keep
-- the exact template version that was used, just like Canva page links already
-- do through catalog_canva_designs.template_updated_at.
alter table public.canva_edit_sessions
  add column if not exists template_updated_at timestamptz;

alter table public.catalog_product_color_images
  add column if not exists processed_template_updated_at timestamptz;

create or replace function public.save_canva_tryon(p_session_id uuid, p_user_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  s public.canva_edit_sessions%rowtype;
  c public.catalog_product_color_images%rowtype;
  current_width numeric;
  current_sku text;
  current_revision bigint;
  current_template_updated_at timestamptz;
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
  select updated_at into current_template_updated_at
    from public.canva_tryon_template where id = 'default' for share;
  select * into c from public.catalog_product_color_images where id = s.color_id and product_id = s.product_id for update;
  if not found or c.original_image_path is distinct from s.original_path
    or c.processed_image_path is distinct from s.previous_path
    or c.processed_at is distinct from s.previous_processed_at
    or current_width is distinct from s.frame_width_mm
    or current_revision is distinct from s.reference_revision
    or current_template_updated_at is null
    or current_template_updated_at is distinct from s.template_updated_at
    or (s.sku_snapshot is not null and current_sku is distinct from s.sku_snapshot)
    or (s.variant_snapshot is not null and c.color_variant_number is distinct from s.variant_snapshot) then
    raise exception 'CANVA_CONFLICT';
  end if;
  update public.catalog_product_color_images set processed_image_path = s.staged_path,
    processed_reference_revision = current_revision,
    processed_template_updated_at = current_template_updated_at,
    processed_at = now(), updated_at = now() where id = s.color_id;
  update public.canva_edit_sessions set saved_at = now() where id = s.id;
  return s.staged_path;
end;
$$;

revoke all on function public.save_canva_tryon(uuid, uuid) from public, anon, authenticated;
grant execute on function public.save_canva_tryon(uuid, uuid) to service_role;

commit;
