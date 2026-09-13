import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';
import { removeBackground } from '@/lib/catalog/background-removal';
import { buildProcessedFrameImage } from '@/lib/catalog/frame-recolor';

const BUCKET = 'catalog-product-photos';

// Passo de "IA" da Fila de Aprovação IA. Disparado manualmente pelo master
// (botão "Processar com IA" na tela de detalhe do produto) em vez de
// automático no upload, pra não gastar chamada de API em foto que ainda
// pode ser trocada.
//
// Reescrita em 13/09/2026 (pedido do usuário): antes só removia o fundo da
// foto de posição. Agora usa DUAS fotos de entrada (ver migração
// 202609130008): "posição" (`original_image_path`, o ângulo/pose) e
// "referência de cor" (`color_reference_image_path`, só pra pegar a cor
// real) — remove o fundo das duas, troca a cor da foto de posição pela cor
// da referência (preservando reflexos/sombras) e recorta pro formato
// quadrado com a armação de ponta a ponta (ver lib/catalog/frame-recolor.ts
// pro porquê e como). O nome do arquivo final termina com a medida da
// lente (largura x altura em mm) — só uma convenção de organização pro
// master, o app sempre lê a medida do banco (catalog_products), nunca do
// nome do arquivo.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string; colorImageId: string }> }
) {
  const { productId, colorImageId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { data: color } = await auth.admin
    .from('catalog_product_color_images')
    .select('id, original_image_path, color_reference_image_path, status, catalog_products(lens_width_mm, lens_height_mm)')
    .eq('id', colorImageId)
    .eq('product_id', productId)
    .maybeSingle();
  if (!color) return NextResponse.json({ message: 'Cor não encontrada.' }, { status: 404 });
  if (!color.original_image_path) {
    return NextResponse.json({ message: 'Envie a foto de posição desta cor antes de processar.' }, { status: 400 });
  }
  if (!color.color_reference_image_path) {
    return NextResponse.json({ message: 'Envie a foto de referência de cor desta cor antes de processar.' }, { status: 400 });
  }
  if (color.status === 'incompleto') {
    return NextResponse.json({ message: 'Complete os campos obrigatórios antes de processar.' }, { status: 409 });
  }

  const product = (color as unknown as { catalog_products: { lens_width_mm: number | null; lens_height_mm: number | null } | null }).catalog_products;
  const widthMm = product?.lens_width_mm;
  const heightMm = product?.lens_height_mm;
  if (!widthMm || !heightMm) {
    return NextResponse.json({ message: 'Preencha a largura e a altura da lente (mm) do produto antes de processar — o nome do arquivo final usa essa medida.' }, { status: 400 });
  }

  const [{ data: positionSigned, error: positionSignError }, { data: colorRefSigned, error: colorRefSignError }] = await Promise.all([
    auth.admin.storage.from(BUCKET).createSignedUrl(color.original_image_path, 300),
    auth.admin.storage.from(BUCKET).createSignedUrl(color.color_reference_image_path, 300)
  ]);
  if (positionSignError || !positionSigned?.signedUrl) {
    console.error('catalog_process_sign_failed', { message: positionSignError?.message });
    return NextResponse.json({ message: 'Não foi possível ler a foto de posição.' }, { status: 500 });
  }
  if (colorRefSignError || !colorRefSigned?.signedUrl) {
    console.error('catalog_process_sign_failed', { message: colorRefSignError?.message });
    return NextResponse.json({ message: 'Não foi possível ler a foto de referência de cor.' }, { status: 500 });
  }

  let processedBuffer: Buffer;
  try {
    const [positionCutout, colorReferenceCutout] = await Promise.all([
      removeBackground(positionSigned.signedUrl),
      removeBackground(colorRefSigned.signedUrl)
    ]);
    processedBuffer = await buildProcessedFrameImage(positionCutout, colorReferenceCutout);
  } catch (err) {
    console.error('catalog_process_failed', { message: err instanceof Error ? err.message : String(err) });
    const configMissing = err instanceof Error && err.message.includes('REPLICATE_API_TOKEN');
    return NextResponse.json(
      { message: configMissing ? 'Configure REPLICATE_API_TOKEN na Vercel antes de processar imagens.' : 'Falha ao processar a imagem. Tente novamente — se persistir, tente trocar a foto de posição ou de referência de cor.' },
      { status: 502 }
    );
  }

  const measurementSuffix = `${widthMm}x${heightMm}`.replace(/\s+/g, '');
  const processedPath = `${productId}/processed/${colorImageId}-${measurementSuffix}.png`;
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
