begin;

-- Commit the product width and the manual try-on PNG as one optimistic write.
-- Storage is checked by the server before this short database transaction.
create or replace function public.save_manual_tryon_upload(
  p_product_id uuid,
  p_color_id uuid,
  p_processed_image_path text,
  p_frame_width_mm numeric,
  p_expected_original_path text,
  p_expected_reference_revision bigint
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_original_path text;
  current_status text;
  current_reference_revision bigint;
  current_template_updated_at timestamptz;
  saved_at timestamptz := now();
begin
  if p_product_id is null
    or p_color_id is null
    or p_processed_image_path is null
    or btrim(p_processed_image_path) = ''
    or char_length(p_processed_image_path) > 1024
    or p_processed_image_path not like p_product_id::text || '/%'
    or p_expected_original_path is null
    or btrim(p_expected_original_path) = ''
    or char_length(p_expected_original_path) > 1024
    or p_expected_original_path not like p_product_id::text || '/%'
    or p_frame_width_mm is null
    or p_frame_width_mm <= 0
    or p_frame_width_mm > 400
    or p_expected_reference_revision is null
    or p_expected_reference_revision < 1 then
    return false;
  end if;

  select p.canva_reference_revision
    into current_reference_revision
    from public.catalog_products p
    where p.id = p_product_id
    for update;
  if not found or current_reference_revision is distinct from p_expected_reference_revision then
    return false;
  end if;

  select c.original_image_path, c.status
    into current_original_path, current_status
    from public.catalog_product_color_images c
    where c.id = p_color_id and c.product_id = p_product_id
    for update;
  if not found
    or current_status = 'incompleto'
    or current_original_path is distinct from p_expected_original_path then
    return false;
  end if;

  update public.catalog_products
    set frame_total_width_mm = p_frame_width_mm,
        updated_at = saved_at
    where id = p_product_id;

  -- The BEFORE UPDATE trigger has now advanced the geometry revision when
  -- the width changed. Read that value back instead of predicting it.
  select p.canva_reference_revision
    into current_reference_revision
    from public.catalog_products p
    where p.id = p_product_id;

  select t.updated_at
    into current_template_updated_at
    from public.canva_tryon_template t
    where t.id = 'default'
    for share;

  update public.catalog_product_color_images
    set processed_image_path = p_processed_image_path,
        processed_at = saved_at,
        processed_reference_revision = current_reference_revision,
        processed_template_updated_at = current_template_updated_at,
        updated_at = saved_at
    where id = p_color_id and product_id = p_product_id;

  return true;
end;
$$;

revoke all on function public.save_manual_tryon_upload(uuid, uuid, text, numeric, text, bigint)
  from public, anon, authenticated;
grant execute on function public.save_manual_tryon_upload(uuid, uuid, text, numeric, text, bigint)
  to service_role;

commit;
