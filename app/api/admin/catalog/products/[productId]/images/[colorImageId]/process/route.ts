import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';
import { processCatalogDisplayPhoto } from '@/lib/catalog/gallery-background-removal';

const BUCKET = 'catalog-product-photos';

export const maxDuration = 300;

/**
 * "Processar com IA" do catálogo:
 * - usa somente as fotos já marcadas para a cor + a própria "Foto da cor";
 * - faz exatamente uma chamada ao BiRefNet por foto;
 * - o modelo devolve somente a máscara de fundo;
 * - os pixels RGB vêm da foto original;
 * - não usa nano-banana, moondream ou referências validadas neste fluxo;
 * - display-photo-standard.ts continua responsável por fundo branco, trim,
 *   escala, canvas 1040x320 e JPEG <= 200 KB.
 */
export async function POST(
  _request: Request,
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

  if (!color) {
    return NextResponse.json({ message: 'Cor não encontrada.' }, { status: 404 });
  }

  // A Foto da cor continua obrigatória porque também é uma foto de exibição
  // candidata desta cor. Ela não é mais usada como referência para a IA.
  if (!color.original_image_path) {
    return NextResponse.json({
      message: 'Esta cor ainda não tem "Foto da cor". Adicione a foto antes de processar.'
    }, { status: 400 });
  }

  const { data: ownColorSigned, error: ownColorSignError } = await auth.admin.storage
    .from(BUCKET)
    .createSignedUrl(color.original_image_path, 900);

  if (ownColorSignError || !ownColorSigned?.signedUrl) {
    console.error('catalog_process_own_color_sign_failed', {
      productId,
      colorImageId,
      message: ownColorSignError?.message
    });
    return NextResponse.json({
      message: 'Não foi possível preparar a "Foto da cor" — tente de novo.'
    }, { status: 500 });
  }

  const { data: taggedGalleryImages } = await auth.admin
    .from('catalog_product_gallery_images')
    .select('id, image_url, position, catalog_product_gallery_image_colors!inner(color_image_id)')
    .eq('product_id', productId)
    .eq('catalog_product_gallery_image_colors.color_image_id', colorImageId)
    .order('position', { ascending: true });

  const { data: existingDisplayImages } = await auth.admin
    .from('catalog_product_color_display_images')
    .select('position, source_gallery_image_id, from_own_color_photo')
    .eq('color_image_id', colorImageId);

  const alreadyProcessedGalleryIds = new Set(
    (existingDisplayImages || [])
      .map((row) => row.source_gallery_image_id)
      .filter((id): id is string => Boolean(id))
  );

  const ownPhotoAlreadyProcessed = (existingDisplayImages || [])
    .some((row) => row.from_own_color_photo);

  let nextPosition = (existingDisplayImages || [])
    .reduce((max, row) => Math.max(max, row.position), 0) + 1;

  type Candidate = {
    kind: 'galeria' | 'foto_da_cor';
    galleryImageId: string | null;
    signedUrl: string;
  };

  const candidates: Candidate[] = [];

  for (const photo of (taggedGalleryImages || []) as { id: string; image_url: string }[]) {
    if (alreadyProcessedGalleryIds.has(photo.id)) continue;
    candidates.push({
      kind: 'galeria',
      galleryImageId: photo.id,
      signedUrl: photo.image_url
    });
  }

  if (!ownPhotoAlreadyProcessed) {
    candidates.push({
      kind: 'foto_da_cor',
      galleryImageId: null,
      signedUrl: ownColorSigned.signedUrl
    });
  }

  if (!candidates.length) {
    return NextResponse.json({
      message: 'Nada para processar — marque fotos novas para esta cor em "Todas as fotos do anúncio", ou todas as origens já foram processadas antes.'
    }, { status: 400 });
  }

  const STEP_BUDGET_MS = 210000;
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

  const uploadedPaths: string[] = [];
  const timings: {
    kind: Candidate['kind'];
    galleryImageId: string | null;
    aiDurationMs: number;
    totalDurationMs: number;
    visibleBoxRatio: number;
  }[] = [];

  let failedCount = 0;

  for (const candidate of candidates) {
    if (Date.now() - startedAt > STEP_BUDGET_MS) {
      ranOutOfTime = true;
      break;
    }

    // Cada foto é totalmente isolada: erro no download, BiRefNet,
    // validação da máscara, Sharp ou upload não interrompe as demais.
    try {
      const processed = await processCatalogDisplayPhoto(candidate.signedUrl);

      const position = nextPosition;
      const path = `${productId}/display/${colorImageId}-${crypto.randomUUID()}.jpg`;

      const { error: uploadError } = await auth.admin.storage
        .from(BUCKET)
        .upload(path, processed.buffer, {
          contentType: 'image/jpeg',
          upsert: false
        });

      if (uploadError) {
        throw new Error(`Falha ao salvar a foto processada: ${uploadError.message}`);
      }

      uploadedPaths.push(path);
      nextPosition += 1;

      rowsToInsert.push({
        color_image_id: colorImageId,
        position,
        source: candidate.kind === 'foto_da_cor'
          ? 'foto_da_cor_recortada'
          : 'galeria_recortada',
        image_path: path,
        source_gallery_image_id: candidate.galleryImageId,
        from_own_color_photo: candidate.kind === 'foto_da_cor'
      });

      timings.push({
        kind: candidate.kind,
        galleryImageId: candidate.galleryImageId,
        aiDurationMs: processed.aiDurationMs,
        totalDurationMs: processed.totalDurationMs,
        visibleBoxRatio: processed.visibleBoxRatio
      });

      console.info('catalog_display_photo_processed', {
        productId,
        colorImageId,
        kind: candidate.kind,
        galleryImageId: candidate.galleryImageId,
        aiDurationMs: processed.aiDurationMs,
        totalDurationMs: processed.totalDurationMs,
        visibleBoxRatio: Number(processed.visibleBoxRatio.toFixed(3))
      });
    } catch (error) {
      failedCount += 1;
      console.error('catalog_display_photo_process_failed', {
        productId,
        colorImageId,
        kind: candidate.kind,
        galleryImageId: candidate.galleryImageId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  let createdIds: string[] = [];

  if (rowsToInsert.length) {
    const { data: inserted, error: insertError } = await auth.admin
      .from('catalog_product_color_display_images')
      .insert(rowsToInsert)
      .select('id');

    if (insertError) {
      console.error('catalog_display_images_insert_failed', {
        productId,
        colorImageId,
        message: insertError.message,
        uploadedPaths
      });

      // O banco é a fonte de verdade. Se o insert falhar depois dos uploads,
      // remove tudo que esta execução acabou de enviar para não deixar órfãos.
      if (uploadedPaths.length) {
        const { error: cleanupError } = await auth.admin.storage
          .from(BUCKET)
          .remove(uploadedPaths);

        if (cleanupError) {
          console.error('catalog_display_images_cleanup_failed', {
            productId,
            colorImageId,
            uploadedPaths,
            message: cleanupError.message
          });
        }
      }

      return NextResponse.json({
        message: 'As fotos foram processadas, mas não foi possível registrá-las. Os arquivos enviados nesta execução foram removidos; tente novamente.'
      }, { status: 500 });
    }

    createdIds = (inserted || []).map((row) => row.id as string);
  }

  const parts: string[] = [];
  if (rowsToInsert.length) {
    parts.push(`${rowsToInsert.length} foto(s) processada(s) — confira e valide cada uma.`);
  }
  if (failedCount) {
    parts.push(`${failedCount} foto(s) não puderam ser processadas — as demais continuaram normalmente.`);
  }
  if (ranOutOfTime) {
    parts.push('O tempo de segurança acabou antes de terminar todas — clique em "Processar com IA" novamente para continuar com as que faltam.');
  }
  if (!parts.length) {
    parts.push('Nenhuma foto nova para processar.');
  }

  return NextResponse.json({
    message: parts.join(' '),
    createdIds,
    timings
  });
}
