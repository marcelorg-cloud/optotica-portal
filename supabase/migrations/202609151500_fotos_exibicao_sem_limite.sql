-- Pedido do usuário (15/09/2026, depois da recolorização por IA sair de vez
-- — ver estado-consolidado.md seção 0.67): "Processar com IA" deixa de
-- pintar a armação e passa a só limpar/recortar/padronizar TODAS as fotos
-- marcadas pra uma cor (mais a própria "Foto da cor") — sem limite de 4.
-- Uma foto de origem que mostre a armação em duas posições pode virar duas
-- fotos de saída (marcação manual "2 posições" no momento de processar).
--
-- Isso invalida dois pressupostos da migração 202609131200: (1) o teto de 4
-- fotos de exibição por cor; (2) toda foto de exibição vir de uma foto da
-- galeria geral do anúncio — agora também pode vir da própria "Foto da cor"
-- da cor (`catalog_product_color_images.original_image_path`).

begin;

alter table public.catalog_product_color_display_images
  drop constraint if exists catalog_product_color_display_images_position_check;

alter table public.catalog_product_color_display_images
  add constraint catalog_product_color_display_images_position_check
    check (position > 0);

alter table public.catalog_product_color_display_images
  drop constraint if exists catalog_product_color_display_images_source_check;

alter table public.catalog_product_color_display_images
  add constraint catalog_product_color_display_images_source_check
    check (source in ('galeria_recortada', 'foto_da_cor_recortada'));

-- Marca as fotos de exibição que vieram da própria "Foto da cor" (em vez de
-- uma foto geral do anúncio) — usada só para não reprocessar a mesma foto
-- de novo a cada clique em "Processar com IA" (ver process/route.ts).
alter table public.catalog_product_color_display_images
  add column if not exists from_own_color_photo boolean not null default false;

commit;
