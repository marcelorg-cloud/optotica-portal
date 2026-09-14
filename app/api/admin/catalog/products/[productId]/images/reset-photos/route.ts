import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';

const BUCKET = 'catalog-product-photos';
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_COLORS_PER_CALL = 60;
const MAX_GALLERY_URLS_PER_CALL = 60;
const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

// "Reset" de fotos a partir do JSON do AliExpress (pedido do usuário,
// 14/09/2026): "trocasse todas as fotos do produto, tipo um reset das
// imagens - os dados como descricao, medidas mantem sem alteracao, porém
// as imagens sao todas puxadas novamente da fonte, inclusive a foto da
// cor". Antes desta rota, "Importar/atualizar do AliExpress" só CRIAVA
// cores que ainda não existiam — colar o JSON de novo pra uma cor já
// cadastrada não fazia nada com a foto dela, mesmo se a foto real tivesse
// sumido/quebrado (caso relatado com print: uma cor com "Foto da cor"
// vazia). Esta rota é o oposto: pega cores JÁ CADASTRADAS (o master já
// calculou o pareamento na tela, comparando por SKU do fornecedor ou cor
// principal — mesma lógica usada pra marcar "já cadastrada aqui" no
// import normal) e baixa de novo a foto de referência de cada uma, direto
// da URL do AliExpress, substituindo a que estava salva.
//
// Nunca cria cor nova (isso continua sendo só o botão "Importar X cor(es)"
// já existente) e nunca mexe em `catalog_products` (descrição, medidas,
// nome do modelo etc. ficam exatamente como estavam — só imagens).
//
// Reaproveita o mesmo padrão de download+upload da rota
// .../images/[colorImageId]/import-photo (baixa a URL, sobe no mesmo
// bucket/caminho), mas sem a trava de "só funciona se status=incompleto" —
// aqui é um reset explícito, pedido pelo master, então funciona em
// qualquer status (pendente, validada ou rejeitada); os campos de
// processamento/validação são resetados do mesmo jeito que já acontece em
// "Trocar foto" manual, porque a foto realmente mudou e precisa passar
// pela validação de novo.
export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { data: product } = await auth.admin.from('catalog_products').select('id').eq('id', productId).maybeSingle();
  if (!product) return NextResponse.json({ message: 'Produto não encontrado.' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const rawColors: unknown = body?.colors;
  const colorRequests: { colorImageId: string; sourceImageUrl: string }[] = Array.isArray(rawColors)
    ? rawColors
        .filter((c): c is { colorImageId: unknown; sourceImageUrl: unknown } => Boolean(c) && typeof c === 'object')
        .map((c) => ({ colorImageId: String((c as { colorImageId: unknown }).colorImageId || ''), sourceImageUrl: String((c as { sourceImageUrl: unknown }).sourceImageUrl || '') }))
        .filter((c) => c.colorImageId && /^https?:\/\//.test(c.sourceImageUrl))
        .slice(0, MAX_COLORS_PER_CALL)
    : [];

  const rawGalleryUrls: unknown = body?.galleryImageUrls;
  const galleryImageUrls: string[] = Array.isArray(rawGalleryUrls)
    ? Array.from(new Set(rawGalleryUrls.filter((u): u is string => typeof u === 'string' && /^https:\/\//.test(u)).map((u: string) => u.slice(0, 2000))))
        .slice(0, MAX_GALLERY_URLS_PER_CALL)
    : [];

  if (!colorRequests.length && !galleryImageUrls.length) {
    return NextResponse.json({ message: 'Nada para resetar — nenhuma cor já cadastrada nem foto de galeria encontrada nesse JSON.' }, { status: 400 });
  }

  // Confere que todas as cores enviadas realmente pertencem a este produto
  // (mesma cautela da rota de marcação de cor por foto da galeria) — evita
  // um id de cor de outro produto (bug de estado na tela, ou chamada
  // direta à API) sobrescrever a foto de uma cor que não é deste cadastro.
  let colorsUpdated = 0;
  const colorsFailed: { colorImageId: string; reason: string }[] = [];
  if (colorRequests.length) {
    const { data: ownedColors } = await auth.admin
      .from('catalog_product_color_images')
      .select('id')
      .eq('product_id', productId)
      .in('id', colorRequests.map((c) => c.colorImageId));
    const ownedIds = new Set((ownedColors || []).map((c) => c.id));

    // Sequencial de propósito (não Promise.all): são só downloads/uploads
    // simples (sem IA/Replicate aqui), mas manter sequencial evita martelar
    // o CDN do fornecedor com várias requisições simultâneas e deixa o
    // resultado mais fácil de entender se algo falhar no meio.
    for (const { colorImageId, sourceImageUrl } of colorRequests) {
      if (!ownedIds.has(colorImageId)) {
        colorsFailed.push({ colorImageId, reason: 'Esta cor não pertence a este produto.' });
        continue;
      }

      let response: Response;
      try {
        response = await fetch(sourceImageUrl, { signal: AbortSignal.timeout(20_000) });
      } catch {
        colorsFailed.push({ colorImageId, reason: 'O servidor do fornecedor não respondeu.' });
        continue;
      }
      if (!response.ok) {
        colorsFailed.push({ colorImageId, reason: `Download falhou (status ${response.status}).` });
        continue;
      }

      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim();
      const ext = EXT_BY_CONTENT_TYPE[contentType] || 'jpg';
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) {
        colorsFailed.push({ colorImageId, reason: 'A foto veio vazia ou grande demais.' });
        continue;
      }

      const path = `${productId}/${Date.now()}-${colorImageId}.${ext}`;
      const { error: uploadError } = await auth.admin.storage.from(BUCKET).upload(path, buffer, { contentType: contentType || 'image/jpeg' });
      if (uploadError) {
        console.error('catalog_reset_photo_upload_failed', { message: uploadError.message });
        colorsFailed.push({ colorImageId, reason: 'Não foi possível salvar no Storage.' });
        continue;
      }

      const now = new Date().toISOString();
      const { error: updateError } = await auth.admin
        .from('catalog_product_color_images')
        .update({
          original_image_path: path,
          // A foto de referência mudou — os campos que dependiam da foto
          // anterior precisam passar pelo processamento/validação de novo,
          // mesma regra já usada em "Trocar foto" (ação `trocar_foto`) e no
          // import por URL da galeria (.../import-photo).
          status: 'pendente',
          processed_image_path: null,
          processed_at: null,
          validated_by: null,
          validated_at: null,
          rejection_reason: null,
          updated_at: now
        })
        .eq('id', colorImageId);
      if (updateError) {
        console.error('catalog_reset_photo_update_failed', { message: updateError.message });
        colorsFailed.push({ colorImageId, reason: 'Foto salva no Storage, mas não foi possível atualizar o registro da cor.' });
        continue;
      }
      colorsUpdated += 1;
    }
  }

  // Fotos gerais do anúncio (galeria) — mesmo upsert idempotente da rota
  // .../gallery (ignora as que já existem, nunca duplica nem remove
  // nenhuma que já estava lá). Incluído aqui pra o "reset" cobrir TODAS as
  // fotos do produto num clique só, não só as fotos de cor.
  let galleryAdded = 0;
  if (galleryImageUrls.length) {
    const rows = galleryImageUrls.map((image_url, index) => ({ product_id: productId, image_url, position: index }));
    const { error: galleryError } = await auth.admin
      .from('catalog_product_gallery_images')
      .upsert(rows, { onConflict: 'product_id,image_url', ignoreDuplicates: true });
    if (galleryError) {
      console.error('catalog_reset_gallery_upsert_failed', { message: galleryError.message });
    } else {
      galleryAdded = galleryImageUrls.length;
    }
  }

  const parts: string[] = [];
  if (colorRequests.length) {
    parts.push(`${colorsUpdated} foto(s) de cor atualizada(s)${colorsFailed.length ? ` (${colorsFailed.length} falharam)` : ''}.`);
  }
  if (galleryImageUrls.length) {
    parts.push(`${galleryAdded} foto(s) da galeria conferida(s)/adicionada(s).`);
  }

  return NextResponse.json({
    message: parts.join(' ') || 'Nada foi atualizado.',
    colorsUpdated,
    colorsFailed,
    galleryAdded
  });
}
