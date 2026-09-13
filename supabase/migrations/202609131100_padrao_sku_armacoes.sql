begin;

-- Padrão de identificação de armações (documento anexado pelo usuário,
-- 13/09/2026): SKU do modelo = FORMATO-MATERIAL-NÚMERO (número global de 3
-- dígitos, nunca reaproveitado — daqui o uso de sequence). `sku_optotica` e
-- `model_name` continuam sendo as MESMAS colunas de sempre — só passam a
-- ser gerados a partir destes 3 campos (lib/catalog/sku-standard.ts) em vez
-- de digitados livremente.
alter table public.catalog_products
  add column if not exists format_code text,
  add column if not exists material_code text,
  add column if not exists model_number integer;

create sequence if not exists public.catalog_products_model_number_seq;

create unique index if not exists catalog_products_model_number_unique
  on public.catalog_products (model_number) where model_number is not null;

-- Cor da variante: a ordem de cadastro (C1, C2, C3...) é o identificador
-- estável — nunca renumerada mesmo se uma cor sair de linha (por isso é
-- gravada, não recalculada por posição). A cor REAL fica em campo separado
-- e padronizado (`color_principal`, vocabulário fechado — ver
-- lib/catalog/sku-standard.ts), nunca embutida no nome/SKU da variante.
-- `supplier_color_name`: texto bruto como veio do fornecedor (ex.: "leopard
-- with clear") — só rastreabilidade interna, nunca exibido ao paciente.
alter table public.catalog_product_color_images
  add column if not exists color_variant_number integer,
  add column if not exists color_principal text,
  add column if not exists color_secondary text,
  add column if not exists supplier_color_name text;

-- PostgREST/supabase-js não expõe `nextval()` de sequence diretamente — esta
-- função dá à rota de criação de produto (POST /api/admin/catalog/products,
-- via `auth.admin.rpc(...)`) um jeito de pegar o próximo número global de
-- modelo (nunca reaproveitado, mesmo se um produto for apagado depois).
create or replace function public.next_catalog_model_number()
returns integer
language sql
security definer
set search_path = public
as $$
  select nextval('public.catalog_products_model_number_seq')::integer;
$$;

commit;
