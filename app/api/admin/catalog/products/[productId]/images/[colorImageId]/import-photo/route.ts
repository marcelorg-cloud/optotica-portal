import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';

const BUCKET = 'catalog-product-photos';
const MAX_BYTES = 15 * 1024 * 1024;
const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

// Importação automática de foto (pedido do usuário, 12/09/2026): em vez do
// master baixar a imagem do AliExpress na mão e subir de novo pela tela,
// esta rota baixa direto de uma URL do AliExpress e sobe no mesmo
// bucket/caminho já usado pelo upload manual. Grava em
// `catalog_product_color_images.original_image_path` — a foto real desta
// cor, usada tanto pra exibição quanto (13/09/2026, 2ª rodada) como
// referência de cor no "Processar com IA" (ver .../process/route.ts e
// migração 202609130009 — a foto de posição/pose passou a ser uma só por
// produto, não mais por cor).
//
// Duas origens possíveis pra URL a baixar:
// 1) Sem `imageUrl` no corpo: usa `source_image_url` da própria cor (a
//    amostra do AliExpress) — só funciona em 'incompleto' (a cor ainda não
//    tem foto nenhuma).
// 2) Com `imageUrl` no corpo: usada pelo seletor de miniaturas da galeria
//    geral do anúncio na tela ("Trocar foto"). A URL só é aceita se já
//    estiver catalogada em catalog_product_gallery_images pra este produto
//    — nunca uma URL arbitrária vinda do cliente, pra não expor o servidor
//    a baixar qualquer endereço (SSRF).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string; colorImageId: string }> }
) {
  const { productId, colorImageId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const requestedUrl = typeof body?.imageUrl === 'string' ? body.imageUrl : null;

  const { data: image } = await auth.admin
    .from('catalog_product_color_images')
    .select('id, status, source_image_url')
    .eq('id', colorImageId)
    .eq('product_id', productId)
    .maybeSingle();
  if (!image) return NextResponse.json({ message: 'Cor não encontrada.' }, { status: 404 });

  let sourceUrl: string;
  if (requestedUrl) {
    const { data: galleryMatch } = await auth.admin
      .from('catalog_product_gallery_images')
      .select('id')
      .eq('product_id', productId)
      .eq('image_url', requestedUrl)
      .maybeSingle();
    if (!galleryMatch) return NextResponse.json({ message: 'Essa foto não está na galeria deste produto.' }, { status: 400 });
    sourceUrl = requestedUrl;
  } else {
    if (image.status !== 'incompleto') {
      return NextResponse.json({ message: 'Esta cor já tem uma foto — escolha uma foto da galeria ou envie a sua para trocar.' }, { status: 409 });
    }
    if (!image.source_image_url) {
      return NextResponse.json({ message: 'Não há uma URL de amostra registrada para esta cor. Use "Adicionar foto" para enviar manualmente.' }, { status: 400 });
    }
    sourceUrl = image.source_image_url;
  }

  let response: Response;
  try {
    response = await fetch(sourceUrl, { signal: AbortSignal.timeout(20_000) });
  } catch {
    return NextResponse.json({ message: 'Não foi possível baixar a foto (o servidor do fornecedor não respondeu). Tente de novo em instantes ou use o envio manual.' }, { status: 502 });
  }
  if (!response.ok) {
    return NextResponse.json({ message: `Não foi possível baixar a foto (status ${response.status}). Use o envio manual.` }, { status: 502 });
  }

  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim();
  const ext = EXT_BY_CONTENT_TYPE[contentType] || 'jpg'; // servidores de imagem do AliExpress às vezes omitem/variam o content-type — jpg é o formato real na quase totalidade dos casos observados
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) {
    return NextResponse.json({ message: 'A foto veio vazia ou grande demais. Use o envio manual.' }, { status: 502 });
  }

  const path = `${productId}/${Date.now()}.${ext}`;
  const { error: uploadError } = await auth.admin.storage.from(BUCKET).upload(path, buffer, { contentType: contentType || 'image/jpeg' });
  if (uploadError) {
    console.error('catalog_product_photo_import_upload_failed', { message: uploadError.message });
    return NextResponse.json({ message: 'A foto foi baixada, mas não foi possível salvar no Storage. Tente de novo.' }, { status: 500 });
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now, original_image_path: path, status: 'pendente' };
  if (image.status === 'incompleto') {
    patch.missing_required_fields = [];
  } else {
    // Troca de foto numa cor que já tinha uma (via galeria) — reseta o que
    // dependia da foto anterior, mesma lógica do 'trocar_foto' manual em
    // .../images/[colorImageId] (route.ts).
    patch.processed_image_path = null;
    patch.processed_at = null;
    patch.validated_by = null;
    patch.validated_at = null;
    patch.rejection_reason = null;
  }

  const { error } = await auth.admin
    .from('catalog_product_color_images')
    .update(patch)
    .eq('id', colorImageId);
  if (error) return NextResponse.json({ message: 'A foto foi salva no Storage, mas não foi possível atualizar o registro da cor.' }, { status: 500 });

  return NextResponse.json({ message: 'Foto importada — pronta para "Processar com IA".' });
}
