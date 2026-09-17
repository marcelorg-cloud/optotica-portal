import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';
import { cropGalleryPhoto } from '@/lib/catalog/gallery-photo-crop';
import { loadModelPhotoReferences } from '@/lib/catalog/model-photo-references';
import type { DisplayReference } from '@/lib/catalog/display-photo-standard';

const BUCKET = 'catalog-product-photos';

// Aumenta o tempo limite da função (padrão da Vercel costuma ser curto
// demais — 10s no plano Hobby) — mesma razão já registrada em versões
// anteriores deste arquivo: cada chamada de IA generativa pode demorar, e
// se a função da Vercel for encerrada no meio, o navegador recebe uma
// exceção de rede em vez de uma resposta HTTP normal.
export const maxDuration = 300;

// Reescrito de vez em 15/09/2026 (pedido do usuário — ver
// estado-consolidado.md seção 0.67): a recolorização por IA saiu do
// sistema inteiro (não pinta mais a armação pra bater com a cor — os
// arquivos frame-colorize.ts/frame-recolor.ts foram removidos, e esta rota
// não depende mais de `catalog_products.position_image_path` nem das
// medidas de lente). "Processar com IA" agora tem UM trabalho só: pegar as
// fotos já marcadas para esta cor em "Todas as fotos do anúncio" (SEM
// limite de 4 — antes era `slice(0, 4)`) MAIS a própria "Foto da cor", e
// pra cada uma, recortar isolando a armação, garantir fundo branco, limpar
// adesivo da lente e padronizar o tamanho (ver lib/catalog/
// gallery-photo-crop.ts) — nunca mais julga/pinta cor nenhuma.
//
// Divisão em duas fotos quando a mesma foto de origem mostra mais de um
// óculos: 15/09/2026, 3ª rodada (ver estado-consolidado.md seção 0.69) —
// isso passou a ser DETECTADO PELA PRÓPRIA IA (dentro de `cropGalleryPhoto`,
// em lib/catalog/gallery-photo-crop.ts), sem nenhuma marcação do master.
// Cada foto de origem pode virar 0, 1 ou 2 fotos de exibição, decidido
// sozinho.
//
// Identificação da cor certa por REFERÊNCIA VISUAL: 15/09/2026, 4ª rodada
// (ver estado-consolidado.md seção 0.70) — a "Foto da cor" desta cor agora é
// obrigatória pra processar (assinada UMA vez aqui, reaproveitada em TODAS
// as chamadas de IA desta rodada), porque é ela que a IA usa como
// referência visual pra saber qual armação/posição de cada foto candidata
// tem a cor certa (útil principalmente quando uma foto do anúncio mostra
// mais de uma cor junto, ou quando a cor é uma estampa difícil de descrever
// em texto).
//
// Diferente da versão anterior (que apagava e recriava TODAS as fotos de
// exibição a cada clique): agora só ACRESCENTA fotos novas, nunca mexe nas
// que já existem — nem nas já validadas (viraram parte do catálogo da cor,
// não fazem mais sentido sumir só porque "Processar com IA" foi clicado de
// novo) nem nas ainda pendentes de validação de uma rodada anterior. Uma
// foto de origem que JÁ gerou um resultado (marcada ou a própria "Foto da
// cor") não é reprocessada de novo — evita ficar empilhando duplicata a
// cada clique.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string; colorImageId: string }> }
) {
  const { productId, colorImageId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { data: color } = await auth.admin
    .from('catalog_product_color_images')
    .select('id, original_image_path')
    .eq('id', colorImageId)
    .eq('product_id', productId)
    .maybeSingle();
  if (!color) return NextResponse.json({ message: 'Cor não encontrada.' }, { status: 404 });

  // "Foto da cor" passou a ser OBRIGATÓRIA pra processar (15/09/2026, 4ª
  // rodada — ver comentário acima): sem ela a IA não tem nenhuma referência
  // visual pra identificar a cor certa. Assinada UMA vez aqui, reaproveitada
  // como referência em toda chamada de IA desta rodada (inclusive quando a
  // própria "Foto da cor" também entra como candidata a ser recortada —
  // nesse caso ela é comparada com ela mesma, o que é só um caso trivial).
  if (!color.original_image_path) {
    return NextResponse.json({
      message: 'Esta cor ainda não tem "Foto da cor" — ela é obrigatória agora, usada como referência pra IA identificar a cor certa. Adicione a foto da cor antes de processar.'
    }, { status: 400 });
  }
  const { data: referenceSigned, error: referenceSignError } = await auth.admin.storage
    .from(BUCKET)
    .createSignedUrl(color.original_image_path, 900);
  if (referenceSignError || !referenceSigned?.signedUrl) {
    console.error('catalog_process_reference_sign_failed', { message: referenceSignError?.message });
    return NextResponse.json({ message: 'Não foi possível preparar a "Foto da cor" como referência — tente de novo.' }, { status: 500 });
  }
  const referenceUrl = referenceSigned.signedUrl;

  // Fotos já marcadas para esta cor em "Todas as fotos do anúncio" — sem
  // limite (antes cortava em 4).
  const { data: taggedGalleryImages } = await auth.admin
    .from('catalog_product_gallery_images')
    .select('id, image_url, position, catalog_product_gallery_image_colors!inner(color_image_id)')
    .eq('product_id', productId)
    .eq('catalog_product_gallery_image_colors.color_image_id', colorImageId)
    .order('position', { ascending: true });

  // Fotos de exibição já existentes desta cor — usado pra (a) não
  // reprocessar a mesma origem de novo e (b) continuar a numeração de
  // posição de onde parou (nunca mais apaga tudo e recomeça do 1).
  const { data: existingDisplayImages } = await auth.admin
    .from('catalog_product_color_display_images')
    .select('position, source_gallery_image_id, from_own_color_photo')
    .eq('color_image_id', colorImageId);

  const alreadyProcessedGalleryIds = new Set(
    (existingDisplayImages || []).map((r) => r.source_gallery_image_id).filter((id): id is string => Boolean(id))
  );
  const ownPhotoAlreadyProcessed = (existingDisplayImages || []).some((r) => r.from_own_color_photo);
  let nextPosition = (existingDisplayImages || []).reduce((max, r) => Math.max(max, r.position), 0) + 1;

  type Candidate = { kind: 'galeria' | 'foto_da_cor'; galleryImageId: string | null; signedUrl: string };
  const candidates: Candidate[] = [];

  for (const photo of (taggedGalleryImages || []) as { id: string; image_url: string }[]) {
    if (alreadyProcessedGalleryIds.has(photo.id)) continue;
    candidates.push({ kind: 'galeria', galleryImageId: photo.id, signedUrl: photo.image_url });
  }

  if (!ownPhotoAlreadyProcessed) {
    // Reaproveita a mesma URL assinada já preparada acima como referência —
    // a própria "Foto da cor" processada contra ela mesma sempre bate (caso
    // trivial), então sempre vira exatamente 1 resultado.
    candidates.push({ kind: 'foto_da_cor', galleryImageId: null, signedUrl: referenceUrl });
  }

  if (!candidates.length) {
    return NextResponse.json({
      message: 'Nada para processar — marque fotos para esta cor em "Todas as fotos do anúncio", ou todas as fotos (inclusive a própria "Foto da cor") já foram processadas antes.'
    }, { status: 400 });
  }

  // Orçamento de tempo — todo o processamento agora é só recorte (sem o
  // passo de recolorização, que antes consumia a maior parte do tempo
  // disponível), então quase os 60s de `maxDuration` ficam livres pra isso.
  // Deixa uma margem pro upload/gravação no banco no final.
  const STEP_BUDGET_MS = 210000;
  const startedAt = Date.now();
  let references: DisplayReference[];
  try { references = await loadModelPhotoReferences(auth.admin, productId); }
  catch (err) {
    // 17/09/2026 — este catch não registrava nada (bug real encontrado em
    // produção: usuário via só a mensagem genérica abaixo, sem nenhum rastro
    // do motivo no log). Agora ao menos fica registrado — a maioria das
    // causas antigas (uma referência com problema) não chega mais aqui desde
    // a mudança em lib/catalog/model-photo-references.ts; o que ainda cai
    // neste catch é só a falha de consulta ao banco.
    console.error('catalog_process_model_references_failed', { productId, colorImageId, message: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ message: 'Não foi possível preparar as referências do modelo. Tente novamente.' }, { status: 502 });
  }
  let ranOutOfTime = false;

  const rowsToInsert: {
    color_image_id: string;
    position: number;
    source: 'galeria_recortada' | 'foto_da_cor_recortada';
    image_path: string;
    source_gallery_image_id: string | null;
    from_own_color_photo: boolean;
  }[] = [];
  let failedCount = 0;
  // Fotos onde a IA não encontrou a cor certa (ver `detectMatchingFrameCount`
  // em gallery-photo-crop.ts) — contadas só pra informar no resultado final;
  // NÃO ficam marcadas como "já processadas" no banco (isso só acontece pra
  // fotos que geraram pelo menos 1 resultado de verdade, via
  // `source_gallery_image_id`), então clicar "Processar com IA" de novo vai
  // tentar essas mesmas fotos outra vez. Limitação conhecida — aceitável por
  // enquanto porque é rara (as fotos já foram marcadas manualmente como
  // sendo desta cor antes de chegar aqui).
  let noMatchCount = 0;

  for (const candidate of candidates) {
    if (Date.now() - startedAt > STEP_BUDGET_MS) { ranOutOfTime = true; break; }
    try {
      const buffers = await cropGalleryPhoto(candidate.signedUrl, referenceUrl, references);
      if (!buffers.length) noMatchCount += 1;
      for (const buffer of buffers) {
        const position = nextPosition;
        nextPosition += 1;
        // .jpg (15/09/2026, 3ª rodada — ver seção 0.69): formato final
        // passou de PNG pra JPEG (mais leve, com teto de 200KB garantido em
        // gallery-photo-crop.ts).
        const path = `${productId}/display/${colorImageId}-${crypto.randomUUID()}.jpg`;
        const { error: uploadError } = await auth.admin.storage.from(BUCKET).upload(path, buffer, { contentType: 'image/jpeg', upsert: false });
        if (uploadError) {
          console.error('catalog_display_image_upload_failed', { message: uploadError.message });
          failedCount += 1;
          continue;
        }
        rowsToInsert.push({
          color_image_id: colorImageId,
          position,
          source: candidate.kind === 'foto_da_cor' ? 'foto_da_cor_recortada' : 'galeria_recortada',
          image_path: path,
          source_gallery_image_id: candidate.galleryImageId,
          from_own_color_photo: candidate.kind === 'foto_da_cor'
        });
      }
    } catch (err) {
      console.error('catalog_crop_failed', { message: err instanceof Error ? err.message : String(err) });
      failedCount += 1;
    }
  }

  let createdIds: string[] = [];
  if (rowsToInsert.length) {
    const { data: inserted, error: insertError } = await auth.admin
      .from('catalog_product_color_display_images')
      .insert(rowsToInsert)
      .select('id');
    if (insertError) {
      console.error('catalog_display_images_insert_failed', { message: insertError.message });
      return NextResponse.json({ message: 'Algumas fotos foram processadas, mas não foi possível salvá-las — tente de novo.' }, { status: 500 });
    }
    createdIds = (inserted || []).map((r) => r.id as string);
  }

  const parts: string[] = [];
  if (rowsToInsert.length) parts.push(`${rowsToInsert.length} foto(s) processada(s) — confira e valide cada uma.`);
  if (noMatchCount) parts.push(`${noMatchCount} foto(s) não pareciam ter a cor certa (comparado com a "Foto da cor") — nenhum resultado gerado pra elas.`);
  if (failedCount) parts.push(`${failedCount} foto(s) não puderam ser processadas — tente de novo.`);
  if (ranOutOfTime) parts.push('O tempo acabou antes de terminar todas — clique em "Processar com IA" de novo para continuar com as que faltam.');
  if (!parts.length) parts.push('Nenhuma foto nova para processar.');

  return NextResponse.json({ message: parts.join(' '), createdIds });
}
