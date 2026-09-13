import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';

// Marcação manual de cor por foto geral do anúncio (13/09/2026, mockup do
// usuário + migração 202609131400): na seção nova "Todas as fotos do
// anúncio" (topo da tela do produto), o master marca — com uma bolinha por
// cor em cada foto — quais cores aparecem naquela foto. Uma foto pode
// mostrar mais de uma cor (ex.: foto comparativa com várias armações lado a
// lado), por isso é sempre a lista COMPLETA de cores marcadas nesta foto
// (substitui tudo o que já estava marcado, não acrescenta) — o próprio
// mockup mostra bolinhas que ligam/desligam, então o cliente sempre manda o
// estado final, não uma mudança incremental.
//
// Esta marcação é só o INSUMO pro recorte por IA (ver process/route.ts, que
// lê esta tabela por color_image_id) — marcar uma cor aqui não recorta nada
// sozinho, o master ainda clica "Processar com IA" na cor pra gerar as
// fotos de exibição de fato.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ productId: string; galleryImageId: string }> }
) {
  const { productId, galleryImageId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { data: galleryImage } = await auth.admin
    .from('catalog_product_gallery_images')
    .select('id')
    .eq('id', galleryImageId)
    .eq('product_id', productId)
    .maybeSingle();
  if (!galleryImage) return NextResponse.json({ message: 'Foto da galeria não encontrada.' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const colorImageIds: string[] = Array.isArray(body?.colorImageIds)
    ? Array.from(new Set(body.colorImageIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)))
    : [];

  if (colorImageIds.length) {
    // Confere que todas as cores enviadas realmente pertencem a este
    // produto — evita marcar (por engano do cliente, ou erro de estado na
    // tela) uma foto deste produto com a cor de outro produto.
    const { data: validColors } = await auth.admin
      .from('catalog_product_color_images')
      .select('id')
      .eq('product_id', productId)
      .in('id', colorImageIds);
    const validIds = new Set((validColors || []).map((c) => c.id));
    if (validIds.size !== colorImageIds.length) {
      return NextResponse.json({ message: 'Uma ou mais cores enviadas não pertencem a este produto.' }, { status: 400 });
    }
  }

  const { error: deleteError } = await auth.admin
    .from('catalog_product_gallery_image_colors')
    .delete()
    .eq('gallery_image_id', galleryImageId);
  if (deleteError) {
    console.error('catalog_gallery_image_colors_clear_failed', { message: deleteError.message });
    return NextResponse.json({ message: 'Não foi possível salvar a marcação de cores.' }, { status: 500 });
  }

  if (colorImageIds.length) {
    const rows = colorImageIds.map((color_image_id) => ({ gallery_image_id: galleryImageId, color_image_id }));
    const { error: insertError } = await auth.admin.from('catalog_product_gallery_image_colors').insert(rows);
    if (insertError) {
      console.error('catalog_gallery_image_colors_insert_failed', { message: insertError.message });
      return NextResponse.json({ message: 'Não foi possível salvar a marcação de cores.' }, { status: 500 });
    }
  }

  return NextResponse.json({ message: 'Marcação de cores salva.', colorImageIds });
}
