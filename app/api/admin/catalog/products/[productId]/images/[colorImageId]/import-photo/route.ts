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
// bucket/caminho já usado pelo upload manual.
//
// A partir de 13/09/2026 esta rota grava em UM de dois lugares, escolhido
// por `target` no corpo ('position', padrão, ou 'color_reference' — ver
// migração 202609130008): "posição" é a foto de pose/ângulo que a prova
// online usa (era a única coisa que existia até aqui); "referência de cor"
// é só pra mostrar a cor real, pode ser de qualquer ângulo. "Processar com
// IA" usa as duas juntas (ver .../process/route.ts).
//
// Duas origens possíveis pra URL a baixar, iguais pros dois `target`:
// 1) Sem `imageUrl` no corpo: usa `source_image_url` da própria cor (a
//    amostra do AliExpress). Pra `target: 'position'` só funciona em
//    'incompleto' (comportamento original, sem foto nenhuma ainda). Pra
//    `target: 'color_reference'` funciona sempre — a amostra do AliExpress
//    já mostra a cor certa (só não necessariamente o ângulo certo), então
//    faz sentido reaproveitá-la como referência de cor a qualquer momento.
// 2) Com `imageUrl` no corpo: usada pelo seletor de miniaturas da galeria
//    geral do anúncio na tela, pros dois `target`. A URL só é aceita se já
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
  const target = body?.target === 'color_reference' ? 'color_reference' : 'position';

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
  } else if (target === 'position') {
    if (image.status !== 'incompleto') {
      return NextResponse.json({ message: 'Esta cor já tem uma foto — escolha uma foto da galeria ou envie a sua para trocar.' }, { status: 409 });
    }
    if (!image.source_image_url) {
      return NextResponse.json({ message: 'Não há uma URL de amostra registrada para esta cor. Use "Adicionar foto" para enviar manualmente.' }, { status: 400 });
    }
    sourceUrl = image.source_image_url;
  } else {
    // target === 'color_reference': a amostra do AliExpress já mostra a cor
    // certa (pode não ser o ângulo certo, mas aqui isso não importa) — pode
    // ser (re)usada como referência de cor a qualquer momento.
    if (!image.source_image_url) {
      return NextResponse.json({ message: 'Não há uma URL de amostra registrada para esta cor. Envie uma foto de referência de cor manualmente ou escolha uma da galeria.' }, { status: 400 });
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

  const path = target === 'position' ? `${productId}/${Date.now()}.${ext}` : `${productId}/cor/${Date.now()}.${ext}`;
  const { error: uploadError } = await auth.admin.storage.from(BUCKET).upload(path, buffer, { contentType: contentType || 'image/jpeg' });
  if (uploadError) {
    console.error('catalog_product_photo_import_upload_failed', { message: uploadError.message });
    return NextResponse.json({ message: 'A foto foi baixada, mas não foi possível salvar no Storage. Tente de novo.' }, { status: 500 });
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now };
  if (target === 'position') {
    patch.original_image_path = path;
    patch.status = 'pendente';
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
  } else {
    patch.color_reference_image_path = path;
    // A referência de cor é um dos dois insumos do "Processar com IA" — se
    // mudou, qualquer processamento/validação anterior não vale mais.
    patch.processed_image_path = null;
    patch.processed_at = null;
    patch.validated_by = null;
    patch.validated_at = null;
    patch.rejection_reason = null;
    if (image.status === 'validada' || image.status === 'rejeitada') {
      patch.status = 'pendente';
    }
  }

  const { error } = await auth.admin
    .from('catalog_product_color_images')
    .update(patch)
    .eq('id', colorImageId);
  if (error) return NextResponse.json({ message: 'A foto foi salva no Storage, mas não foi possível atualizar o registro da cor.' }, { status: 500 });

  return NextResponse.json({ message: target === 'position' ? 'Foto de posição importada — pronta para "Processar com IA".' : 'Referência de cor importada — pronta para "Processar com IA".' });
}
