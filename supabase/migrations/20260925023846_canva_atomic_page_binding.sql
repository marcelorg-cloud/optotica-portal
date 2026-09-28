begin;

-- Bind an imported Canva page only while the exact photo and measurement
-- revision used to create it are still current. Locking the source rows keeps
-- a concurrent product/photo update from slipping between validation and the
-- two link updates.
create or replace function public.bind_canva_page(
  p_product_id uuid,
  p_color_id uuid,
  p_design_id text,
  p_page_id text,
  p_page_number integer,
  p_source_path text,
  p_reference_revision bigint,
  p_template_updated_at timestamptz,
  p_expected_source_path text,
  p_expected_reference_revision bigint,
  p_expected_template_updated_at timestamptz,
  p_manual_reference_override boolean,
  p_page_stage text,
  p_import_job_id text,
  p_merge_job_id text,
  p_before_page_ids jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_source_path text;
  current_reference_revision bigint;
  linked_source_path text;
  linked_reference_revision bigint;
  linked_template_updated_at timestamptz;
  linked_design_id text;
  linked_page_id text;
  linked_page_stage text;
  linked_import_job_id text;
  linked_merge_job_id text;
  linked_before_page_ids jsonb;
  product_design_id text;
  pending_color_id uuid;
  current_template_updated_at timestamptz;
begin
  if p_design_id is null or btrim(p_design_id) = ''
    or p_page_id is null or btrim(p_page_id) = ''
    or p_page_number is null or p_page_number < 1 or p_page_number > 500
    or p_source_path is null or btrim(p_source_path) = ''
    or p_reference_revision is null or p_reference_revision < 1
    or p_template_updated_at is null
    or p_page_stage is null
    or p_page_stage not in ('idle', 'importing', 'imported', 'merging', 'ready', 'recovery')
    or p_manual_reference_override is null
    or (not p_manual_reference_override and (
      p_expected_source_path is distinct from p_source_path
      or p_expected_reference_revision is distinct from p_reference_revision
      or p_expected_template_updated_at is distinct from p_template_updated_at
    )) then
    return false;
  end if;

  if p_manual_reference_override and p_page_stage = 'merging' and p_merge_job_id is null
    and (p_before_page_ids is null or jsonb_typeof(p_before_page_ids) <> 'array'
      or jsonb_array_length(p_before_page_ids) = 0 or p_before_page_ids ? p_page_id) then
    return false;
  end if;

  select c.original_image_path, p.canva_reference_revision
    into current_source_path, current_reference_revision
    from public.catalog_products p
    join public.catalog_product_color_images c
      on c.product_id = p.id and c.id = p_color_id
    where p.id = p_product_id
    for update of p, c;
  if not found
    or current_source_path is distinct from p_source_path
    or current_reference_revision is distinct from p_reference_revision then
    return false;
  end if;

  select d.source_path, d.reference_revision, d.template_updated_at, d.design_id, d.page_id,
         d.page_stage, d.import_job_id, d.merge_job_id, d.before_page_ids
    into linked_source_path, linked_reference_revision, linked_template_updated_at, linked_design_id, linked_page_id,
         linked_page_stage, linked_import_job_id, linked_merge_job_id, linked_before_page_ids
    from public.catalog_canva_designs d
    where d.color_id = p_color_id and d.product_id = p_product_id
    for update;
  if not found
    or linked_source_path is distinct from p_expected_source_path
    or linked_reference_revision is distinct from p_expected_reference_revision
    or linked_template_updated_at is distinct from p_expected_template_updated_at
    or (linked_page_id is not null and linked_page_id is distinct from p_page_id)
    or (linked_design_id is not null and linked_design_id is distinct from p_design_id)
    or linked_page_stage is distinct from p_page_stage
    or linked_import_job_id is distinct from p_import_job_id
    or linked_merge_job_id is distinct from p_merge_job_id
    or linked_before_page_ids is distinct from p_before_page_ids then
    return false;
  end if;

  select d.design_id, d.pending_color_id
    into product_design_id, pending_color_id
    from public.canva_product_designs d
    where d.product_id = p_product_id
    for update;
  if not found
    or (product_design_id is not null and product_design_id is distinct from p_design_id)
    or (pending_color_id is not null and pending_color_id is distinct from p_color_id) then
    return false;
  end if;

  select t.updated_at
    into current_template_updated_at
    from public.canva_tryon_template t
    where t.id = 'default'
    for share;
  if not found or current_template_updated_at is distinct from p_template_updated_at then
    return false;
  end if;

  update public.catalog_canva_designs
    set source_path = p_source_path,
        reference_revision = p_reference_revision,
        template_updated_at = p_template_updated_at,
        design_id = p_design_id,
        page_id = p_page_id,
        page_number = p_page_number,
        page_stage = 'ready',
        creating = false
    where color_id = p_color_id;
  update public.canva_product_designs
    set design_id = p_design_id,
        pending_color_id = null
    where product_id = p_product_id;
  return true;
end;
$$;

revoke all on function public.bind_canva_page(uuid, uuid, text, text, integer, text, bigint, timestamptz, text, bigint, timestamptz, boolean, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.bind_canva_page(uuid, uuid, text, text, integer, text, bigint, timestamptz, text, bigint, timestamptz, boolean, text, text, text, jsonb)
  to service_role;

-- Release a stale canonical preparation before starting an independent redo.
-- A merge is accepted here only after the server has observed a terminal job;
-- the expected job ID and all affected rows are locked so another workflow
-- cannot be released accidentally.
create or replace function public.recover_stale_canva_pending(
  p_product_id uuid,
  p_color_id uuid,
  p_merge_job_id text,
  p_outcome text,
  p_design_id text,
  p_page_id text,
  p_page_number integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_source_path text;
  current_reference_revision bigint;
  current_template_updated_at timestamptz;
  linked_source_path text;
  linked_reference_revision bigint;
  linked_template_updated_at timestamptz;
  linked_merge_job_id text;
  linked_page_stage text;
  linked_before_page_ids jsonb;
  linked_page_id text;
  product_design_id text;
  pending_color_id uuid;
begin
  if p_outcome is null or p_outcome not in ('abandon', 'failed', 'success', 'ambiguous')
    or (p_page_id is null) <> (p_design_id is null)
    or (p_page_id is null) <> (p_page_number is null)
    or (p_page_number is not null and (p_page_number < 1 or p_page_number > 500))
    or (p_outcome = 'success' and p_page_id is null)
    or (p_outcome <> 'success' and p_page_id is not null) then
    return false;
  end if;

  select c.original_image_path, p.canva_reference_revision
    into current_source_path, current_reference_revision
    from public.catalog_products p
    join public.catalog_product_color_images c
      on c.product_id = p.id and c.id = p_color_id
    where p.id = p_product_id
    for update of p, c;
  if not found then return false; end if;

  select t.updated_at
    into current_template_updated_at
    from public.canva_tryon_template t
    where t.id = 'default'
    for share;

  select d.source_path, d.reference_revision, d.template_updated_at,
         d.merge_job_id, d.page_stage, d.before_page_ids, d.page_id
    into linked_source_path, linked_reference_revision, linked_template_updated_at,
         linked_merge_job_id, linked_page_stage, linked_before_page_ids, linked_page_id
    from public.catalog_canva_designs d
    where d.color_id = p_color_id and d.product_id = p_product_id
    for update;
  if not found or linked_page_id is not null
    or (current_source_path is not distinct from linked_source_path
      and current_reference_revision is not distinct from linked_reference_revision
      and current_template_updated_at is not distinct from linked_template_updated_at) then
    return false;
  end if;

  select d.design_id, d.pending_color_id
    into product_design_id, pending_color_id
    from public.canva_product_designs d
    where d.product_id = p_product_id
    for update;
  if not found or pending_color_id is distinct from p_color_id
    or linked_merge_job_id is distinct from p_merge_job_id then
    return false;
  end if;

  if linked_merge_job_id is null then
    if p_outcome <> 'abandon' or p_design_id is not null
      or linked_page_stage = 'merging' or linked_before_page_ids is not null then
      return false;
    end if;
  else
    if p_outcome = 'abandon' then return false; end if;
    if p_outcome = 'success' and product_design_id is distinct from p_design_id then
      return false;
    end if;
  end if;

  update public.catalog_canva_designs
    set design_id = case when p_page_id is not null then p_design_id else design_id end,
        page_id = case when p_page_id is not null then p_page_id else page_id end,
        page_number = case when p_page_id is not null then p_page_number else page_number end,
        page_stage = 'recovery',
        creating = false
    where color_id = p_color_id;
  update public.canva_product_designs
    set pending_color_id = null
    where product_id = p_product_id;
  return true;
end;
$$;

revoke all on function public.recover_stale_canva_pending(uuid, uuid, text, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.recover_stale_canva_pending(uuid, uuid, text, text, text, text, integer)
  to service_role;

commit;
