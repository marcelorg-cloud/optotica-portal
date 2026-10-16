-- Espelho de produtos do AliExpress para fornecedores previamente liberados pelo Master.
-- SOMENTE candidatos em triagem; não altera catálogo publicado nem fotos originais.
create table if not exists public.catalog_supplier_mirror_items (
 id uuid primary key default gen_random_uuid(),
 supplier_id uuid not null references public.catalog_suppliers(id) on delete restrict,
 supplier_item_id text not null check (supplier_item_id ~ '^[0-9]{5,30}$'),
 title text not null check (char_length(title) between 3 and 240),
 supplier_sku text,
 source_image_url text,
 listing_price text,
 listing_currency text,
 import_source text not null check(import_source in ('manual_store_json','store_search_api')),
 store_verified boolean not null default false,
 status text not null default 'pendente' check(status in ('pendente','importado','ignorado')),
 matched_product_id uuid references public.catalog_products(id) on delete set null,
 first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 seen_count integer not null default 1 check(seen_count >= 1),
 constraint catalog_supplier_mirror_unique_item unique (supplier_id,supplier_item_id),
 constraint catalog_supplier_mirror_image_url check(source_image_url is null or (length(source_image_url)<=700 and source_image_url ~ '^https://')),
 constraint catalog_supplier_mirror_price_len check(listing_price is null or length(listing_price)<=50),
 constraint catalog_supplier_mirror_sku_len check(supplier_sku is null or length(supplier_sku)<=120),
 constraint catalog_supplier_mirror_currency_len check(listing_currency is null or length(listing_currency)<=8)
);
create index if not exists idx_catalog_supplier_mirror_by_store on public.catalog_supplier_mirror_items (supplier_id,status,last_seen_at desc);
create index if not exists idx_catalog_supplier_mirror_by_product on public.catalog_supplier_mirror_items(matched_product_id) where matched_product_id is not null;
alter table public.catalog_supplier_mirror_items enable row level security;
revoke all on public.catalog_supplier_mirror_items from anon,authenticated;
-- Authenticated Master may SELECT only. Writes are through server-side catalog API
-- with requireMaster() and server-held credentials, never arbitrary browser SQL.
grant select on public.catalog_supplier_mirror_items to authenticated;
create policy catalog_supplier_mirror_master_select on public.catalog_supplier_mirror_items
 for select to authenticated
 using (exists(select 1 from public.system_admins s
  where s.user_id=(select auth.uid()) and s.active));
comment on table public.catalog_supplier_mirror_items is
 'Lista interna/privada de candidatos reais de lojas AliExpress previamente liberadas; preço e foto são referências de origem, nunca cotação nem publicação automática.';
