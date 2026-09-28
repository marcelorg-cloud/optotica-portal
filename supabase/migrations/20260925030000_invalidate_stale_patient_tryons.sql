begin;

-- Patient try-on rows are a cache of the processed frame image and its scale.
-- Removing only the database pointer makes the stale result unreachable while
-- deliberately leaving the generated object in Storage for separate cleanup.
create index if not exists catalog_patient_display_images_product_color_idx
  on public.catalog_patient_display_images (product_id, color_name);

create or replace function public.invalidate_patient_display_images_for_color_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.processed_image_path is not distinct from new.processed_image_path then
    return new;
  end if;

  delete from public.catalog_patient_display_images
  where product_id = new.product_id
    and color_name = new.color_name;

  return new;
end;
$$;

revoke all on function public.invalidate_patient_display_images_for_color_change()
  from public, anon, authenticated;

drop trigger if exists invalidate_patient_display_images_on_processed_path
  on public.catalog_product_color_images;
create trigger invalidate_patient_display_images_on_processed_path
after update of processed_image_path on public.catalog_product_color_images
for each row
when (old.processed_image_path is distinct from new.processed_image_path)
execute function public.invalidate_patient_display_images_for_color_change();

create or replace function public.invalidate_patient_display_images_for_measurement_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.frame_total_width_mm is not distinct from new.frame_total_width_mm
    and old.lens_width_mm is not distinct from new.lens_width_mm then
    return new;
  end if;

  delete from public.catalog_patient_display_images
  where product_id = new.id;

  return new;
end;
$$;

revoke all on function public.invalidate_patient_display_images_for_measurement_change()
  from public, anon, authenticated;

drop trigger if exists invalidate_patient_display_images_on_measurements
  on public.catalog_products;
create trigger invalidate_patient_display_images_on_measurements
after update of frame_total_width_mm, lens_width_mm on public.catalog_products
for each row
when (
  old.frame_total_width_mm is distinct from new.frame_total_width_mm
  or old.lens_width_mm is distinct from new.lens_width_mm
)
execute function public.invalidate_patient_display_images_for_measurement_change();

commit;
