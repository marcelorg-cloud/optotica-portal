import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';

// Remover uma foto da galeria geral do anúncio (14/09/2026) — pedido do
// usuário depois de descobrir que o JSON "Item Detail" de um anúncio da
// AliExpress pode trazer, dentro de `item.description.images`, fotos que
// NÃO são do produto: banners genéricos da loja (frete, selo de avaliação,
// "5 star feedback" etc.) e até fotos de OUTROS modelos/sub-marcas que a
// mesma loja vende, embutidos como propaganda cruzada dentro da própria
// descrição do anúncio. Isso não é um bug de mistura entre produtos do
// nosso catálogo (toda gravação/leitura de `catalog_product_gallery_images`
// já é sempre filtrada por `product_id` — ver `.../gallery/route.ts` e
// `.../route.ts`); é o próprio JSON de origem que já vem "sujo". Decisão do
// usuário: continuar salvando tudo automaticamente ao importar (sem tela de
// revisão antes), mas dar um jeito de apagar depois o que não serve — esta
// rota é esse jeito.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ productId: string; galleryImageId: string }> }
) {
  const { productId, galleryImageId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  // Confirma que a foto é mesmo deste produto antes de apagar — nunca apaga
  // por só receber o id, sempre com o product_id também na condição.
  const { data: photo } = await auth.admin
    .from('catalog_product_gallery_images')
    .select('id')
    .eq('id', galleryImageId)
    .eq('product_id', productId)
    .maybeSingle();
  if (!photo) return NextResponse.json({ message: 'Foto não encontrada nesta galeria.' }, { status: 404 });

  // ON DELETE CASCADE já remove as marcações de cor desta foto
  // (catalog_product_gallery_image_colors, migração 202609131400); qualquer
  // foto de exibição já recortada a partir dela (catalog_product_color_display_images.
  // source_gallery_image_id) só perde a rastreabilidade da origem (ON DELETE
  // SET NULL), continua existindo normalmente.
  const { error } = await auth.admin
    .from('catalog_product_gallery_images')
    .delete()
    .eq('id', galleryImageId)
    .eq('product_id', productId);
  if (error) {
    console.error('catalog_product_gallery_images_delete_failed', { message: error.message });
    return NextResponse.json({ message: 'Não foi possível remover esta foto.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Foto removida da galeria.' });
}
