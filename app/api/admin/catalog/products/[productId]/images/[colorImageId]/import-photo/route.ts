import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';

const BUCKET = 'catalog-product-photos';
const MAX_BYTES = 15 * 1024 * 1024;
const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

// Importação automática da foto de amostra (pedido do usuário, 12/09/2026):
// em vez do master baixar a imagem do AliExpress na mão e subir de novo pela
// tela, esta rota baixa direto do `source_image_url` gravado na linha da cor
// (migração 202609120004 + script de dados 202609120005) e sobe no mesmo
// bucket/caminho já usado pelo upload manual — o resto do fluxo (Processar
// com IA, Validar/Rejeitar) continua idêntico depois disso.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string; colorImageId: string }> }
) {
  const { productId, colorImageId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { data: image } = await auth.admin
    .from('catalog_product_color_images')
    .select('id, status, source_image_url')
    .eq('id', colorImageId)
    .eq('product_id', productId)
    .maybeSingle();
  if (!image) return NextResponse.json({ message: 'Cor não encontrada.' }, { status: 404 });
  if (image.status !== 'incompleto') {
    return NextResponse.json({ message: 'Esta cor já tem uma foto — use "Reprocessar com IA" se precisar trocar.' }, { status: 409 });
  }
  if (!image.source_image_url) {
    return NextResponse.json({ message: 'Não há uma URL de amostra registrada para esta cor. Use "Adicionar foto" para enviar manualmente.' }, { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch(image.source_image_url, { signal: AbortSignal.timeout(20_000) });
  } catch {
    return NextResponse.json({ message: 'Não foi possível baixar a foto de amostra (o servidor do fornecedor não respondeu). Tente de novo em instantes ou use "Adicionar foto".' }, { status: 502 });
  }
  if (!response.ok) {
    return NextResponse.json({ message: `Não foi possível baixar a foto de amostra (status ${response.status}). Use "Adicionar foto" para enviar manualmente.` }, { status: 502 });
  }

  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim();
  const ext = EXT_BY_CONTENT_TYPE[contentType] || 'jpg'; // servidores de imagem do AliExpress às vezes omitem/variam o content-type — jpg é o formato real na quase totalidade dos casos observados
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) {
    return NextResponse.json({ message: 'A foto de amostra veio vazia ou grande demais. Use "Adicionar foto" para enviar manualmente.' }, { status: 502 });
  }

  const path = `${productId}/${Date.now()}.${ext}`;
  const { error: uploadError } = await auth.admin.storage.from(BUCKET).upload(path, buffer, { contentType: contentType || 'image/jpeg' });
  if (uploadError) {
    console.error('catalog_product_photo_import_upload_failed', { message: uploadError.message });
    return NextResponse.json({ message: 'A foto foi baixada, mas não foi possível salvar no Storage. Tente de novo.' }, { status: 500 });
  }

  const now = new Date().toISOString();
  const { error } = await auth.admin
    .from('catalog_product_color_images')
    .update({ status: 'pendente', missing_required_fields: [], original_image_path: path, updated_at: now })
    .eq('id', colorImageId);
  if (error) return NextResponse.json({ message: 'A foto foi salva no Storage, mas não foi possível atualizar o registro da cor.' }, { status: 500 });

  return NextResponse.json({ message: 'Foto importada — pronta para "Processar com IA".' });
}
