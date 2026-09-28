-- An explicit empty selection is a decision too. Do not suggest a color
-- again after the master reviewed the gallery photo and saved no matches.
alter table public.catalog_product_gallery_images
  add column if not exists color_tags_reviewed_at timestamptz;
