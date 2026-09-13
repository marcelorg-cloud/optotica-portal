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
    // Uma chamada de cada vez ao Replicate, não em paralelo (achado em
    // produção, 13/09/2026): a conta só libera 1 requisição em voo por vez
    // ("burst de 1") enquanto o crédito estiver abaixo de US$5 — duas
    // chamadas simultâneas (posição + referência de cor) sempre disputavam
    // essa única vaga, e mesmo as tentativas automáticas do SDK (ele já
    // reexecuta sozinho em 429, respeitando o Retry-After) esgotavam antes de
    // as duas conseguirem passar. Rodando uma de cada vez, cada requisição
    // usa a vaga sozinha — mais lento (dobra o tempo de espera), mas não
    // briga com a outra chamada da mesma requisição.
    const positionCutout = await removeBackground(positionSigned.signedUrl);
    const colorReferenceCutout = await removeBackground(colorRefSigned.signedUrl);
    processedBuffer = await buildProcessedFrameImage(positionCutout, colorReferenceCutout);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('catalog_process_failed', { message: detail });
    const configMissing = detail.includes('REPLICATE_API_TOKEN');
    const rateLimited = detail.includes('429') || detail.toLowerCase().includes('throttled');
    // A mensagem de erro real vai pro master (tela protegida por
    // requireMaster(), nunca chega no app do paciente) — achado em produção
    // (13/09/2026): a mensagem genérica ("tente trocar a foto...") não dava
    // pista nenhuma de qual das duas chamadas (posição/cor) ou qual etapa
    // (Replicate, download do resultado, recolor/recorte) falhou, e não há
    // acesso direto aos logs da Vercel nesta sessão — expor o detalhe aqui
    // evita indas e vindas só pra descobrir a causa.
    let message: string;
    if (configMissing) {
      message = 'Configure REPLICATE_API_TOKEN na Vercel antes de processar imagens.';
    } else if (rateLimited) {
      // O texto da mensagem agora inclui `detail` (achado em produção,
      // 13/09/2026): antes essa mensagem era sempre o mesmo texto fixo, então
      // não dava pra saber se um segundo 429 era a MESMA causa (conta ainda
      // com crédito reduzido) ou uma causa DIFERENTE (ex.: token de uma conta
      // errada, ou um 429 comum de limite por minuto sem relação com
      // crédito) — o usuário reportou o mesmo aviso mesmo depois de comprar
      // US$10 de crédito e esperar 10 minutos (bem mais que os 5 minutos que
      // o próprio Replicate diz levar pra propagar).
      message = `O Replicate limitou as requisições (${detail}). Espere um minuto e tente de novo — se continuar mesmo com crédito na conta, considere comprar mais em replicate.com/account/billing.`;
    } else {
      message = `Falha ao processar a imagem: ${detail}. Tente novamente — se persistir, tente trocar a foto de posição do produto ou a foto desta cor.`;
    }
    return NextResponse.json({ message }, { status: 502 });
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
