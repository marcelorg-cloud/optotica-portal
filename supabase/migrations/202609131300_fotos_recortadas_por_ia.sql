-- Pedido do usuário (13/09/2026, depois de ver a seção 0.52 funcionando):
-- "vao ser dois prompts diferente pra IA: 1 para o catalogo de fotos e 2
-- para a foto de prova online. para o catalogo de fotos a IA tem que
-- identificar a cor do óculos em questao, recortar a parte só da cor
-- certa, gerar as sugestoes recortadas."
--
-- Antes (migração 202609131200): as fotos sugeridas (posições 2-4) eram só
-- a URL crua da foto geral do anúncio, escolhida por semelhança de cor
-- (sem nenhum recorte). Agora, a foto sugerida passa a ser uma imagem NOVA,
-- gerada pela IA (google/nano-banana, novo prompt em
-- lib/catalog/gallery-photo-crop.ts) — recortada, mostrando só a armação.
-- Como essa imagem é gerada (não é mais a URL externa original), ela mora
-- no Storage, igual à foto tratada — por isso o novo valor de `source`
-- ('aliexpress_recortada') usa `image_path`, não `image_url`.
--
-- `source_gallery_url` guarda a URL da foto geral ORIGINAL que deu origem
-- ao recorte — só para rastreabilidade e para não usar a mesma foto geral
-- em duas cores diferentes deste produto (antes isso era feito comparando
-- `image_url` direto; agora `image_url` fica vazio para 'aliexpress_recortada',
-- então precisa de uma coluna própria pra isso).

begin;

alter table public.catalog_product_color_display_images
  add column if not exists source_gallery_url text;

alter table public.catalog_product_color_display_images
  drop constraint if exists catalog_product_color_display_images_source_check,
  drop constraint if exists catalog_product_color_display_images_source_shape_check;

alter table public.catalog_product_color_display_images
  add constraint catalog_product_color_display_images_source_check
    check (source in ('processada', 'aliexpress', 'aliexpress_recortada')),
  add constraint catalog_product_color_display_images_source_shape_check check (
    (source = 'processada' and image_path is not null and image_url is null)
    or (source = 'aliexpress' and image_url is not null and image_path is null)
    or (source = 'aliexpress_recortada' and image_path is not null and image_url is null)
  );

commit;
