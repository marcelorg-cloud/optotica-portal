import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';
import { removeBackground } from '@/lib/catalog/background-removal';

const BUCKET = 'catalog-product-photos';

// Passo de "IA" da Fila de Aprovação IA (comentário já previsto em
// .../images/[colorImageId]/route.ts: "processamento de IA — remoção de
// fundo/hastes" — esta rota é esse processamento, que faltava). Disparado
// manualmente pelo master (botão "Processar com IA" na tela de detalhe do
// produto) em vez de automático no upload, pra não gastar chamada de API em
// foto que ainda pode ser trocada.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string; colorImageId: string }> }
) {
  const { productId, colorImageId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { data: color } = await auth.admin
    .from('catalog_product_color_images')
    .select('id, original_image_path, status')
    .eq('id', colorImageId)
    .eq('product_id', productId)
    .maybeSingle();
  if (!color) return NextResponse.json({ message: 'Cor não encontrada.' }, { status: 404 });
  if (!color.original_image_path) {
    return NextResponse.json({ message: 'Envie a foto original desta cor antes de processar.' }, { status: 400 });
  }
  if (color.status === 'incompleto') {
    return NextResponse.json({ message: 'Complete os campos obrigatórios antes de processar.' }, { status: 409 });
  }

  const { data: signed, error: signError } = await auth.admin.storage
    .from(BUCKET)
    .createSignedUrl(color.original_image_path, 300);
  if (signError || !signed?.signedUrl) {
    console.error('catalog_process_sign_failed', { message: signError?.message });
    return NextResponse.json({ message: 'Não foi possível ler a foto original.' }, { status: 500 });
  }

  let processedBuffer: Buffer;
  try {
    processedBuffer = await removeBackground(signed.signedUrl);
  } catch (err) {
    console.error('catalog_background_removal_failed', { message: err instanceof Error ? err.message : String(err) });
    const configMissing = err instanceof Error && err.message.includes('REPLICATE_API_TOKEN');
    return NextResponse.json(
      { message: configMissing ? 'Configure REPLICATE_API_TOKEN na Vercel antes de processar imagens.' : 'Falha ao processar a imagem. Tente novamente.' },
      { status: 502 }
    );
  }

  const processedPath = `${productId}/processed/${colorImageId}.png`;
  const { error: uploadError } = await auth.admin.storage
    .from(BUCKET)
    .upload(processedPath, processedBuffer, { contentType: 'image/png', upsert: true });
  if (uploadError) {
    console.error('catalog_process_upload_failed', { message: uploadError.message });
    return NextResponse.json({ message: 'Não foi possível salvar a imagem processada.' }, { status: 500 });
  }

  const now = new Date().toISOString();
  const { error: updateError } = await auth.admin
    .from('catalog_product_color_images')
    .update({ processed_image_path: processedPath, processed_at: now, updated_at: now })
    .eq('id', colorImageId);
  if (updateError) {
    return NextResponse.json({ message: 'Imagem processada, mas não foi possível atualizar o registro.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Imagem processada — confira antes de validar.' });
}
