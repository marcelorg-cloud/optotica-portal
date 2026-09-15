import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';

const BUCKET = 'catalog-product-photos';
const MAX_BYTES = 15 * 1024 * 1024;
const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

// Foto de posição do PRODUTO (13/09/2026, 2ª rodada — pedido do usuário):
// antes (migração 202609130008) cada COR tinha sua própria foto de
// posição/pose, mais uma foto de "referência de cor" separada. O usuário
// notou que o ângulo/pose é o MESMO pra todas as cores do mesmo modelo — só
// a cor muda — então a foto de posição passou a ser UMA por produto (esta
// rota, grava em catalog_products.position_image_path — migração
// 202609130009), e a "referência de cor" separada foi removida: a foto que
// cada cor já tinha (original_image_path, ver .../images/[colorImageId]/
// import-photo) volta a servir sozinha pra mostrar a cor real.
//
// Duas formas de definir, no mesmo padrão já usado pra foto de cor:
// 1) `imageUrl`: escolhida nas miniaturas da galeria geral do anúncio — só
//    aceita URL já catalogada em catalog_product_gallery_images (evita
//    SSRF — nunca baixa uma URL arbitrária vinda do cliente).
// 2) `path`: upload manual já confirmado no Storage (cliente sobe direto via
//    upload-url assinada, como já acontece pras fotos por cor).
export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { data: product } = await auth.admin
    .from('catalog_products')
    .select('id')
    .eq('id', productId)
    .maybeSingle();
  if (!product) return NextResponse.json({ message: 'Produto não encontrado.' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const requestedUrl = typeof body?.imageUrl === 'string' ? body.imageUrl : null;
  const uploadedPath = typeof body?.path === 'string' ? body.path : null;
  // `clear: true` (15/09/2026, botão "Desfazer última ação"): só usada pelo
  // "desfazer" quando o produto NÃO tinha foto de posição antes da última
  // ação (não dá pra "desfazer para null" mandando `path`/`imageUrl`, já
  // que os dois exigem um valor). Nunca exposta como botão normal na tela —
  // remover a foto de posição de propósito continua sendo só via SQL.
  const clear = body?.clear === true;

  if (clear) {
    const now = new Date().toISOString();
    const { error: clearError } = await auth.admin
      .from('catalog_products')
      .update({ position_image_path: null, position_image_updated_at: now, updated_at: now })
      .eq('id', productId);
    if (clearError) return NextResponse.json({ message: 'Não foi possível desfazer.' }, { status: 500 });
    return NextResponse.json({ message: 'Foto de posição removida.' });
  }

  let path: string;

  if (uploadedPath) {
    if (!uploadedPath.startsWith(`${productId}/`)) {
      return NextResponse.json({ message: 'Envio inválido.' }, { status: 400 });
    }
    const { error: signError } = await auth.admin.storage.from(BUCKET).createSignedUrl(uploadedPath, 60);
    if (signError) return NextResponse.json({ message: 'Não encontramos a foto enviada. Tente enviar de novo.' }, { status: 400 });
    path = uploadedPath;
  } else if (requestedUrl) {
    const { data: galleryMatch } = await auth.admin
      .from('catalog_product_gallery_images')
      .select('id')
      .eq('product_id', productId)
      .eq('image_url', requestedUrl)
      .maybeSingle();
    if (!galleryMatch) return NextResponse.json({ message: 'Essa foto não está na galeria deste produto.' }, { status: 400 });

    let response: Response;
    try {
      response = await fetch(requestedUrl, { signal: AbortSignal.timeout(20_000) });
    } catch {
      return NextResponse.json({ message: 'Não foi possível baixar a foto (o servidor do fornecedor não respondeu). Tente de novo em instantes ou use o envio manual.' }, { status: 502 });
    }
    if (!response.ok) {
      return NextResponse.json({ message: `Não foi possível baixar a foto (status ${response.status}). Use o envio manual.` }, { status: 502 });
    }
    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim();
    const ext = EXT_BY_CONTENT_TYPE[contentType] || 'jpg';
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) {
      return NextResponse.json({ message: 'A foto veio vazia ou grande demais. Use o envio manual.' }, { status: 502 });
    }
    path = `${productId}/posicao/${Date.now()}.${ext}`;
    const { error: uploadError } = await auth.admin.storage.from(BUCKET).upload(path, buffer, { contentType: contentType || 'image/jpeg' });
    if (uploadError) {
      console.error('catalog_product_position_photo_import_upload_failed', { message: uploadError.message });
      return NextResponse.json({ message: 'A foto foi baixada, mas não foi possível salvar no Storage. Tente de novo.' }, { status: 500 });
    }
  } else {
    return NextResponse.json({ message: 'Envie um arquivo ou escolha uma foto da galeria.' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error: updateError } = await auth.admin
    .from('catalog_products')
    .update({ position_image_path: path, position_image_updated_at: now, updated_at: now })
    .eq('id', productId);
  if (updateError) return NextResponse.json({ message: 'Não foi possível salvar a foto de posição.' }, { status: 500 });

  // Reset de todas as cores REMOVIDO (15/09/2026 — ver estado-consolidado.md
  // seção 0.67): existia porque "Processar com IA" usava esta foto de
  // posição como referência de forma para a recolorização — trocar a
  // posição invalidava o resultado já pintado de cada cor. A recolorização
  // saiu de vez do sistema; esta foto de posição não alimenta mais nenhum
  // processamento (fica na tela só porque o usuário pediu pra manter,
  // mesmo sem uso funcional por enquanto) — então trocá-la não tem mais
  // nenhum efeito colateral sobre as cores.
  return NextResponse.json({ message: 'Foto de posição salva.' });
}
