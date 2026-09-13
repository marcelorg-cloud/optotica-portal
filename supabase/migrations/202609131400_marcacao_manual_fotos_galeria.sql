-- Pedido do usuário (13/09/2026, com mockup em anexo): em vez de a IA (ou
-- uma comparação automática de cor) tentar ADIVINHAR quais fotos gerais do
-- anúncio pertencem a cada cor (seções 0.52/0.53), o master agora marca
-- isso manualmente — uma seção nova "Todas as fotos do anúncio" no topo da
-- tela do produto, com uma marcação por cor em cada foto. "Processar com
-- IA" passa a só RECORTAR (isolar a armação, sem fundo/pessoa/outros
-- objetos) as fotos que o master já marcou para aquela cor — sem mais
-- nenhum julgamento de cor pela IA.
--
-- Isso SUBSTITUI a abordagem das seções 0.52/0.53 (confirmado com o
-- usuário antes desta migração) — por isso a limpeza abaixo: o significado
-- de "position" na tabela muda (deixa de ser "1 = foto tratada da prova
-- online, 2-4 = sugeridas por IA" e passa a ser só a ordem das fotos que o
-- master marcou/recortou para aquela cor, sempre 1..4), então qualquer
-- linha já gravada pela abordagem anterior não faz mais sentido aqui.

begin;

delete from public.catalog_product_color_display_images;

alter table public.catalog_product_color_display_images
  add column if not exists source_gallery_image_id uuid references public.catalog_product_gallery_images(id) on delete set null,
  add column if not exists validated_at timestamptz,
  add column if not exists validated_by uuid references auth.users(id) on delete set null;

alter table public.catalog_product_color_display_images
  drop constraint if exists catalog_product_color_display_images_source_check,
  drop constraint if exists catalog_product_color_display_images_source_shape_check;

alter table public.catalog_product_color_display_images
  add constraint catalog_product_color_display_images_source_check
    check (source = 'galeria_recortada'),
  add constraint catalog_product_color_display_images_source_shape_check
    check (image_path is not null and image_url is null);

-- Marcação manual: quais cores aparecem em cada foto geral do anúncio. Uma
-- foto pode mostrar mais de uma cor (ex.: foto comparativa com várias
-- armações lado a lado — como a "TODAS AS FOTOS DO ANÚNCIO" do mockup, onde
-- cada foto tem várias bolinhas de cor marcáveis) — por isso é uma tabela
-- de junção, não uma coluna só em catalog_product_gallery_images.
create table if not exists public.catalog_product_gallery_image_colors (
  id uuid primary key default gen_random_uuid(),
  gallery_image_id uuid not null references public.catalog_product_gallery_images(id) on delete cascade,
  color_image_id uuid not null references public.catalog_product_color_images(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint catalog_product_gallery_image_colors_unique unique (gallery_image_id, color_image_id)
);

create index if not exists catalog_product_gallery_image_colors_gallery_idx
  on public.catalog_product_gallery_image_colors (gallery_image_id);
create index if not exists catalog_product_gallery_image_colors_color_idx
  on public.catalog_product_gallery_image_colors (color_image_id);

alter table public.catalog_product_gallery_image_colors enable row level security;

drop policy if exists catalog_product_gallery_image_colors_master_read on public.catalog_product_gallery_image_colors;
create policy catalog_product_gallery_image_colors_master_read on public.catalog_product_gallery_image_colors
  for select to authenticated using (public.is_master_admin());

commit;
