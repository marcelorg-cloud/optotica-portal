import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';
import { recolorFrameWithReference } from '@/lib/catalog/frame-colorize';

const BUCKET = 'catalog-product-photos';

// Passo de "IA" da Fila de Aprovação IA. Disparado manualmente pelo master
// (botão "Processar com IA" na tela de detalhe do produto) em vez de
// automático no upload, pra não gastar chamada de API em foto que ainda
// pode ser trocada.
//
// Reescrita 4 vezes em 13/09/2026 — histórico rápido pra quem chegar aqui
// depois (detalhes completos na seção 0.41/0.42 de estado-consolidado.md):
// 1ª rodada: posição + referência de cor separadas, as duas por cor.
// 2ª rodada (pedido do usuário): posição vira UMA por PRODUTO (mesma
//    pose/ângulo pra todas as cores — migração 202609130009); a foto da
//    própria cor volta a servir de referência de cor.
// 3ª rodada: bug real em produção mostrou a lente/haste não removidas e a
//    cor errada — trocou a remoção de fundo genérica por segmentação com
//    prompt (`schananas/grounded_sam`, lib/catalog/frame-mask.ts).
// 4ª rodada (esta versão, pedido do usuário): a segmentação da 3ª rodada
//    não saiu precisa o bastante na prática. Nova abordagem: a foto de
//    posição do PRODUTO (`catalog_products.position_image_path`) agora
//    PRECISA vir já recortada pelo master (fundo/lente transparentes, feita
//    fora do sistema) — deixa de ser recortada por IA. A foto da própria
//    COR (`catalog_product_color_images.original_image_path`) continua
//    crua, sem nenhum recorte — só serve de referência visual de cor pra
//    IA. A IA (`google/nano-banana`, ver lib/catalog/frame-colorize.ts) faz
//    UM trabalho só: olhar as duas fotos e recolorir a armação já recortada
//    pra bater com a cor/brilho/estampa da foto da cor — nunca decide mais
//    forma/transparência (essa vem sempre do recorte manual do master).
// O nome do arquivo final termina com a medida da lente (largura x altura
// em mm) — só uma convenção de organização pro master, o app sempre lê a
// medida do banco (catalog_products), nunca do nome do arquivo.
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
    return NextResponse.json({ message: 'Defina a foto de posição do produto, já recortada (fundo e lente transparentes — seção no topo da página), antes de processar.' }, { status: 400 });
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
    // 4ª rodada (13/09/2026, pedido do usuário) — ver lib/catalog/
    // frame-colorize.ts pro porquê completo: a foto de posição já vem
    // recortada pelo master, a foto da cor continua crua, e a IA
    // (google/nano-banana) só recolore — não recorta mais nada. Só uma
    // chamada ao Replicate por processamento (antes eram duas, uma pra cada
    // foto — isso também elimina o risco de colisão de "burst de 1" das
    // rodadas anteriores, já que não há mais duas chamadas concorrentes).
    processedBuffer = await recolorFrameWithReference(positionSigned.signedUrl, colorRefSigned.signedUrl);
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
      // O texto da mensagem inclui `detail` (achado em produção, 13/09/2026):
      // antes essa mensagem era sempre o mesmo texto fixo, então não dava pra
      // saber se um segundo 429 era a MESMA causa ou uma diferente. A
      // sugestão de "comprar mais crédito" foi removida (13/09/2026, 2ª
      // vez): usuário confirmou saldo de US$9,99 e auto-reload/pagamento
      // ativos, e mesmo assim o Replicate seguiu devolvendo essa mensagem
      // citando "less than $5.0 in credit" — nesse ponto já é uma
      // inconsistência do lado do Replicate entre o saldo real e o que o
      // limitador de requisições está enxergando, não algo que se resolve
      // comprando mais crédito.
      message = `O Replicate limitou as requisições (${detail}). Espere um minuto e tente de novo. Se persistir mesmo com saldo e pagamento confirmados na conta, pode ser uma inconsistência do lado do Replicate — nesse caso vale falar com o suporte deles (replicate.com), mostrando essa mensagem e o saldo da conta.`;
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
