-- Pedido do usuário (13/09/2026): "ao clicar em 'processar com ia' deve
-- acrescentar até mais 3 fotos da mesma cor do produto na mesma cor" — até
-- 4 fotos de EXIBIÇÃO por cor no catálogo (posição 1 = a foto tratada/
-- processada de sempre; posições 2-4 = fotos gerais do anúncio no
-- AliExpress que a IA identifica como sendo desta cor específica).
--
-- Por que uma tabela nova em vez de mais colunas em
-- catalog_product_color_images: cada foto de exibição tem uma origem
-- diferente (a processada mora no Storage — `image_path` — e as do
-- AliExpress são URLs externas — `image_url`, mesmo padrão de
-- catalog_product_gallery_images), então uma linha por foto (com posição)
-- é mais simples de adicionar/remover/reordenar do que colunas fixas.
--
-- NÃO confundir com catalog_product_color_images.original_image_path (a
-- foto REAL crua, usada só como referência de cor pela IA e pelo master —
-- decisão já registrada em conversa anterior: "não vamos exibir a foto
-- original"). As fotos aqui são sempre as que aparecerão pro paciente.
--
-- Seguindo o mesmo cuidado já registrado em
-- 202609130006_catalog_product_gallery_images.sql ("aplicar uma foto errada
-- de cor sem o master ver antes seria pior do que manter a foto atual"): a
-- posição da foto que a IA escolhe aqui é só uma SUGESTÃO — o master vê e
-- pode remover uma foto errada na tela do produto antes de qualquer coisa
-- usar isso pro lado do paciente (ainda não existe nenhuma tela do paciente
-- consumindo esta tabela — ver nota na entrega).

begin;

create table if not exists public.catalog_product_color_display_images (
  id uuid primary key default gen_random_uuid(),
  color_image_id uuid not null references public.catalog_product_color_images(id) on delete cascade,
  position smallint not null,
  source text not null,
  image_path text,
  image_url text,
  created_at timestamptz not null default now(),
  constraint catalog_product_color_display_images_position_check check (position between 1 and 4),
  constraint catalog_product_color_display_images_source_check check (source in ('processada', 'aliexpress')),
  constraint catalog_product_color_display_images_source_shape_check check (
    (source = 'processada' and image_path is not null and image_url is null)
    or (source = 'aliexpress' and image_url is not null and image_path is null)
  ),
  constraint catalog_product_color_display_images_unique unique (color_image_id, position)
);

create index if not exists catalog_product_color_display_images_color_idx
  on public.catalog_product_color_display_images (color_image_id);

alter table public.catalog_product_color_display_images enable row level security;

drop policy if exists catalog_product_color_display_images_master_read on public.catalog_product_color_display_images;
create policy catalog_product_color_display_images_master_read on public.catalog_product_color_display_images
  for select to authenticated using (public.is_master_admin());

commit;
