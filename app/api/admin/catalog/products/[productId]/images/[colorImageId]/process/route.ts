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
// Reescrita em 13/09/2026 e simplificada ainda no mesmo dia (2ª rodada,
// pedido do usuário) depois de ver a 1ª versão (posição + referência de cor,
// as duas por cor — migração 202609130008): o ângulo/pose é o MESMO pra
// todas as cores do mesmo modelo, só a cor muda. Então agora usa:
//  * a foto de posição do PRODUTO (`catalog_products.position_image_path`,
//    uma só, compartilhada por todas as cores — migração 202609130009);
//  * a foto da própria COR (`catalog_product_color_images.
//    original_image_path`, já existia antes de qualquer mudança de hoje —
//    volta a servir de referência de cor, como já estava sendo exibida).
// Remove o fundo das duas, troca a cor da foto de posição pela cor da foto
// da cor (preservando reflexos/sombras) e recorta pro formato quadrado com a
// armação de ponta a ponta (ver lib/catalog/frame-recolor.ts pro porquê e
// como). O nome do arquivo final termina com a medida da lente (largura x
// altura em mm) — só uma convenção de organização pro master, o app sempre
// lê a medida do banco (catalog_products), nunca do nome do arquivo.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string; colorImageId: string }> }
) {
  const { productId, colorImageId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { data: color } = await auth.admin
    .from('catalog_product_color_images')
    .select('id, original_image_path, status, catalog_products(position_image_path, lens_width_mm, lens_height_mm)')
    .eq('id', colorImageId)
    .eq('product_id', productId)
    .maybeSingle();
  if (!color) return NextResponse.json({ message: 'Cor não encontrada.' }, { status: 404 });
  if (!color.original_image_path) {
    return NextResponse.json({ message: 'Envie a foto desta cor antes de processar.' }, { status: 400 });
  }
  if (color.status === 'incompleto') {
    return NextResponse.json({ message: 'Complete os campos obrigatórios antes de processar.' }, { status: 409 });
  }

  const product = (color as unknown as { catalog_products: { position_image_path: string | null; lens_width_mm: number | null; lens_height_mm: number | null } | null }).catalog_products;
  if (!product?.position_image_path) {
    return NextResponse.json({ message: 'Defina a foto de posição do produto (seção no topo da página) antes de processar.' }, { status: 400 });
  }
  const widthMm = product?.lens_width_mm;
  const heightMm = product?.lens_height_mm;
  if (!widthMm || !heightMm) {
    return NextResponse.json({ message: 'Preencha a largura e a altura da lente (mm) do produto antes de processar — o nome do arquivo final usa essa medida.' }, { status: 400 });
  }

  const [{ data: positionSigned, error: positionSignError }, { data: colorRefSigned, error: colorRefSignError }] = await Promise.all([
    auth.admin.storage.from(BUCKET).createSignedUrl(product.position_image_path, 300),
    auth.admin.storage.from(BUCKET).createSignedUrl(color.original_image_path, 300)
  ]);
  if (positionSignError || !positionSigned?.signedUrl) {
    console.error('catalog_process_sign_failed', { message: positionSignError?.message });
    return NextResponse.json({ message: 'Não foi possível ler a foto de posição do produto.' }, { status: 500 });
  }
  if (colorRefSignError || !colorRefSigned?.signedUrl) {
    console.error('catalog_process_sign_failed', { message: colorRefSignError?.message });
    return NextResponse.json({ message: 'Não foi possível ler a foto desta cor.' }, { status: 500 });
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
      { message: configMissing ? 'Configure REPLICATE_API_TOKEN na Vercel antes de processar imagens.' : 'Falha ao processar a imagem. Tente novamente — se persistir, tente trocar a foto de posição do produto ou a foto desta cor.' },
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
