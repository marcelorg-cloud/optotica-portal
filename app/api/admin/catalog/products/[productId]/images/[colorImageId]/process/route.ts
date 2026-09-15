import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';
import { cropGalleryPhoto } from '@/lib/catalog/gallery-photo-crop';

const BUCKET = 'catalog-product-photos';

// Aumenta o tempo limite da função (padrão da Vercel costuma ser curto
// demais — 10s no plano Hobby) — mesma razão já registrada em versões
// anteriores deste arquivo: cada chamada de IA generativa pode demorar, e
// se a função da Vercel for encerrada no meio, o navegador recebe uma
// exceção de rede em vez de uma resposta HTTP normal.
export const maxDuration = 60;

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
// Cada foto de origem pode virar 1 ou 2 fotos de exibição, decidido sozinho.
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

  if (color.original_image_path && !ownPhotoAlreadyProcessed) {
    const { data: ownSigned, error: ownSignError } = await auth.admin.storage
      .from(BUCKET)
      .createSignedUrl(color.original_image_path, 300);
    if (ownSignError || !ownSigned?.signedUrl) {
      console.error('catalog_process_own_photo_sign_failed', { message: ownSignError?.message });
    } else {
      candidates.push({ kind: 'foto_da_cor', galleryImageId: null, signedUrl: ownSigned.signedUrl });
    }
  }

  if (!candidates.length) {
    return NextResponse.json({
      message: 'Nada para processar — marque fotos para esta cor em "Todas as fotos do anúncio" (ou envie a "Foto da cor"), ou todas as fotos já foram processadas antes.'
    }, { status: 400 });
  }

  // Orçamento de tempo — todo o processamento agora é só recorte (sem o
  // passo de recolorização, que antes consumia a maior parte do tempo
  // disponível), então quase os 60s de `maxDuration` ficam livres pra isso.
  // Deixa uma margem pro upload/gravação no banco no final.
  const STEP_BUDGET_MS = 50000;
  const startedAt = Date.now();
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

  for (const candidate of candidates) {
    if (Date.now() - startedAt > STEP_BUDGET_MS) { ranOutOfTime = true; break; }
    try {
      const buffers = await cropGalleryPhoto(candidate.signedUrl);
      for (const buffer of buffers) {
        const position = nextPosition;
        nextPosition += 1;
        // .jpg (15/09/2026, 3ª rodada — ver seção 0.69): formato final
        // passou de PNG pra JPEG (mais leve, com teto de 200KB garantido em
        // gallery-photo-crop.ts).
        const path = `${productId}/display/${colorImageId}-${position}.jpg`;
        const { error: uploadError } = await auth.admin.storage.from(BUCKET).upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
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
  if (failedCount) parts.push(`${failedCount} foto(s) não puderam ser processadas — tente de novo.`);
  if (ranOutOfTime) parts.push('O tempo acabou antes de terminar todas — clique em "Processar com IA" de novo para continuar com as que faltam.');
  if (!parts.length) parts.push('Nenhuma foto nova para processar.');

  return NextResponse.json({ message: parts.join(' '), createdIds });
}
