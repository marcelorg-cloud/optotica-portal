import sharp from 'sharp';
import type { createAdminSupabaseClient } from '@/lib/supabase/server';
import { computeOverlayGeometry, type Point } from './geometry';

// 15/09/2026 — extraído de app/api/client/tryon/compose/route.ts pra ser
// reaproveitado também pela Etapa 3 do atendimento (o profissional gera a
// mesma composição "rosto do paciente + óculos" ao trocar de cor, ver
// components/order/frame-step.tsx e a rota nova
// app/api/professional/orders/[orderId]/client/tryon-compose/route.ts).
// Mesma função, mesma tabela de resultado (`catalog_patient_display_images`)
// e mesmo bucket — gerar pelo profissional ou pelo próprio paciente depois
// (ou vice-versa) reaproveita o mesmo arquivo, nunca duplica. Cada rota que
// chama esta função é responsável pela sua própria autenticação/autorização
// e por resolver `dnpTotalMm`/`frameWidthMm`/`processedImagePath` antes de
// chamar — esta função só sabe compor e salvar.

const TRYON_BUCKET = 'try-on-photos';
const CATALOG_BUCKET = 'catalog-product-photos';

export type ComposeTryonParams = {
  organizationId: string;
  clientId: string;
  dnpTotalMm: number;
  productId: string;
  colorName: string;
  /** Caminho da foto do óculos já processada (bucket 'catalog-product-photos'). */
  processedImagePath: string;
  frameWidthMm: number;
  pupilA: Point;
  pupilB: Point;
  nasalCenter?: Point;
  /** Tamanho do canvas em que o navegador mediu as pupilas — o servidor escala
   * proporcionalmente pra foto original (potencialmente maior resolução). */
  photoWidth: number;
  photoHeight: number;
};

export type ComposeTryonResult =
  | { ok: true; imageUrl: string | null }
  | { ok: false; status: number; message: string };

export async function composeTryonImage(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  params: ComposeTryonParams
): Promise<ComposeTryonResult> {
  const {
    organizationId, clientId, dnpTotalMm, productId, colorName,
    processedImagePath, frameWidthMm, pupilA, pupilB, nasalCenter, photoWidth
  } = params;

  // 15/09/2026 — bug real encontrado ao gerar várias cores em sequência
  // (Etapa 3): `.list()` só enxerga um nível da pasta, então depois da
  // PRIMEIRA composição criar a subpasta "display/" (onde os resultados
  // ficam), o próprio `.list()` passa a devolver também um item-pasta
  // chamado exatamente "display" (sem barra). O filtro antigo comparava
  // com 'display/' (COM barra) — "display" não começa com "display/", ou
  // seja, esse item-pasta passava no filtro e, por ordem alfabética
  // ("display" vem antes de "prova.jpg"), virava "a foto do cliente"
  // escolhida por engano, e o download falhava (pasta não é arquivo) com
  // "Não foi possível carregar as imagens para a prova." Sem essa barra
  // (mesmo padrão já usado em
  // app/api/professional/orders/[orderId]/client/face-photo/route.ts), o
  // item-pasta "display" é excluído corretamente também.
  const photoFolder = `${organizationId}/${clientId}`;
  const { data: photoFiles } = await admin.storage.from(TRYON_BUCKET).list(photoFolder);
  const photoFile = photoFiles?.find((f) => !f.name.startsWith('display'));
  if (!photoFile) return { ok: false, status: 409, message: 'Envie a foto de prova online do paciente antes de continuar.' };

  const [{ data: baseBlob, error: baseError }, { data: frameBlob, error: frameError }] = await Promise.all([
    admin.storage.from(TRYON_BUCKET).download(`${photoFolder}/${photoFile.name}`),
    admin.storage.from(CATALOG_BUCKET).download(processedImagePath)
  ]);
  if (baseError || !baseBlob || frameError || !frameBlob) {
    return { ok: false, status: 500, message: 'Não foi possível carregar as imagens para a prova.' };
  }

  try {
    const baseBuffer = Buffer.from(await baseBlob.arrayBuffer());
    const frameBuffer = Buffer.from(await frameBlob.arrayBuffer());

    const baseMeta = await sharp(baseBuffer).metadata();
    const actualWidth = baseMeta.width || photoWidth;
    const scale = actualWidth / photoWidth;

    const frameMeta = await sharp(frameBuffer).metadata();
    const frameAspectRatio = (frameMeta.height || 1) / (frameMeta.width || 1);

    const geometry = computeOverlayGeometry({
      pupilA: { x: pupilA.x * scale, y: pupilA.y * scale },
      pupilB: { x: pupilB.x * scale, y: pupilB.y * scale },
      nasalCenter: nasalCenter ? { x: nasalCenter.x * scale, y: nasalCenter.y * scale } : undefined,
      dnpTotalMm,
      frameWidthMm,
      frameAspectRatio
    });
    if (!geometry) return { ok: false, status: 422, message: 'Não foi possível calcular o encaixe da armação.' };

    const resizedFrame = await sharp(frameBuffer)
      .resize({ width: Math.max(1, Math.round(geometry.widthPx)) })
      .rotate(geometry.angleDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const resizedMeta = await sharp(resizedFrame).metadata();
    const resizedWidth = resizedMeta.width || geometry.widthPx;
    const resizedHeight = resizedMeta.height || geometry.heightPx;

    const left = Math.round(geometry.centerX - resizedWidth / 2);
    const top = Math.round(geometry.centerY - resizedHeight / 2);

    const composedBuffer = await sharp(baseBuffer)
      .composite([{ input: resizedFrame, left, top }])
      .png()
      .toBuffer();

    const safeColor = colorName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const displayPath = `${photoFolder}/display/${productId}-${safeColor}.png`;
    const { error: uploadError } = await admin.storage.from(TRYON_BUCKET).upload(displayPath, composedBuffer, { contentType: 'image/png', upsert: true });
    if (uploadError) {
      console.error('tryon_compose_upload_failed', { message: uploadError.message });
      return { ok: false, status: 500, message: 'Não foi possível salvar a imagem.' };
    }

    const { error: dbError } = await admin.from('catalog_patient_display_images').upsert(
      { client_id: clientId, product_id: productId, color_name: colorName, image_path: displayPath, generated_at: new Date().toISOString() },
      { onConflict: 'client_id,product_id,color_name' }
    );
    if (dbError) console.error('catalog_patient_display_image_upsert_failed', { message: dbError.message });

    const { data: signed } = await admin.storage.from(TRYON_BUCKET).createSignedUrl(displayPath, 3600);
    return { ok: true, imageUrl: signed?.signedUrl || null };
  } catch (err) {
    console.error('tryon_compose_failed', { message: err instanceof Error ? err.message : String(err) });
    return { ok: false, status: 500, message: 'Não foi possível compor a imagem.' };
  }
}
