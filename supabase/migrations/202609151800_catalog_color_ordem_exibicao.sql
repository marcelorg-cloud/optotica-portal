-- Ordem de exibição das cores no front (15/09/2026, pedido do usuário a
-- partir de um print: "no final da página de cadastro do produto, deve
-- aparecer uma lista de todas as cores ativas... arrastando uma cor para
-- esquerda ou direita, define a ordem que as cores vão ter no front").
--
-- `display_order` é nullable de propósito: cores sem valor (nunca
-- reordenadas manualmente) ficam no fim, ordenadas por `color_variant_number`
-- como hoje (NULLS LAST) — só quem usa o card novo "Ordem de exibição das
-- cores" (salva um inteiro sequencial por cor ATIVA do produto) muda isso.
-- Cores novas nascem com `display_order` null (aparecem no fim, até alguém
-- reordenar de novo).
alter table public.catalog_product_color_images
  add column if not exists display_order integer;

create index if not exists catalog_product_color_images_display_order_idx
  on public.catalog_product_color_images (product_id, display_order);

-- Backfill: preenche a ordem inicial das cores que já existem hoje seguindo
-- exatamente o critério já usado na tela (color_variant_number, depois
-- created_at) — pra ninguém ver a ordem das cores mudar sozinha na hora que
-- esta migração for aplicada.
with ranked as (
  select id, row_number() over (
    partition by product_id
    order by color_variant_number nulls last, created_at
  ) as rn
  from public.catalog_product_color_images
)
update public.catalog_product_color_images c
set display_order = ranked.rn
from ranked
where ranked.id = c.id
  and c.display_order is null;
