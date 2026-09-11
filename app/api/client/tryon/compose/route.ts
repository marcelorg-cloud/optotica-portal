import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { computeOverlayGeometry, type Point } from '@/lib/tryon/geometry';

const TRYON_BUCKET = 'try-on-photos';
const CATALOG_BUCKET = 'catalog-product-photos';

type ColorRow = {
  processed_image_path: string | null;
  status: string;
  catalog_products: { id: string; lens_width_mm: number | null; status: string } | null;
};

function isPoint(value: unknown): value is Point {
  return !!value && typeof value === 'object' && typeof (value as Point).x === 'number' && typeof (value as Point).y === 'number';
}

// "Usar esta foto como minha imagem principal" (seção 0.29 do estado
// consolidado): a detecção das pupilas só pode rodar no navegador
// (lib/dnp-vision.ts é explicitamente browser-only), então o navegador manda
// aqui o pixel das duas pupilas + o tamanho do canvas em que mediu — o
// servidor busca a foto original (potencialmente maior resolução) e escala
// tudo proporcionalmente antes de compor com `sharp`. DNP (mm) e largura da
// armação (mm) vêm só do banco, nunca do corpo da requisição — a única coisa
// que o cliente fornece é onde estão as pupilas NA PRÓPRIA foto dele.
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login para continuar.' }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const { data: account } = await admin.from('client_user_accounts').select('client_id').eq('user_id', user.id).maybeSingle();
  if (!account) return NextResponse.json({ message: 'Cadastro de cliente não encontrado.' }, { status: 403 });

  const { data: client } = await admin
    .from('clients')
    .select('id, organization_id, dnp_od, dnp_oe, status')
    .eq('id', account.client_id)
    .maybeSingle();
  if (!client || client.status !== 'active') return NextResponse.json({ message: 'Cadastro de cliente inativo.' }, { status: 403 });
  if (client.dnp_od == null || client.dnp_oe == null) {
    return NextResponse.json({ message: 'Sua DNP ainda não foi medida pelo profissional — a prova online precisa dela.' }, { status: 409 });
  }

  const body = await request.json().catch(() => null);
  const productId = typeof body?.productId === 'string' ? body.productId : '';
  const colorName = typeof body?.colorName === 'string' ? body.colorName : '';
  const photoWidth = Number(body?.photoWidth);
  const photoHeight = Number(body?.photoHeight);
  if (!productId || !colorName || !isPoint(body?.pupilA) || !isPoint(body?.pupilB) || !Number.isFinite(photoWidth) || !Number.isFinite(photoHeight) || photoWidth <= 0 || photoHeight <= 0) {
    return NextResponse.json({ message: 'Dados de prova inválidos.' }, { status: 400 });
  }
  const pupilA = body.pupilA as Point;
  const pupilB = body.pupilB as Point;

  const { data: color } = await admin
    .from('catalog_product_color_images')
    .select('processed_image_path, status, catalog_products!inner(id, lens_width_mm, status)')
    .eq('product_id', productId)
    .eq('color_name', colorName)
    .maybeSingle();
  const row = color as unknown as ColorRow | null;
  const product = row?.catalog_products;
  if (!row || row.status !== 'validada' || !row.processed_image_path || !product || product.status !== 'publicado' || !product.lens_width_mm) {
    return NextResponse.json({ message: 'Esta armação não está disponível para prova.' }, { status: 404 });
  }

  const photoFolder = `${client.organization_id}/${client.id}`;
  const { data: photoFiles } = await admin.storage.from(TRYON_BUCKET).list(photoFolder);
  const photoFile = photoFiles?.find((f) => !f.name.startsWith('display/'));
  if (!photoFile) return NextResponse.json({ message: 'Envie sua foto de prova online antes de continuar.' }, { status: 409 });

  const [{ data: baseBlob, error: baseError }, { data: frameBlob, error: frameError }] = await Promise.all([
    admin.storage.from(TRYON_BUCKET).download(`${photoFolder}/${photoFile.name}`),
    admin.storage.from(CATALOG_BUCKET).download(row.processed_image_path)
  ]);
  if (baseError || !baseBlob || frameError || !frameBlob) {
    return NextResponse.json({ message: 'Não foi possível carregar as imagens para a prova.' }, { status: 500 });
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
      dnpTotalMm: Number(client.dnp_od) + Number(client.dnp_oe),
      frameWidthMm: Number(product.lens_width_mm),
      frameAspectRatio
    });
    if (!geometry) return NextResponse.json({ message: 'Não foi possível calcular o encaixe da armação.' }, { status: 422 });

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
      return NextResponse.json({ message: 'Não foi possível salvar a imagem.' }, { status: 500 });
    }

    const { error: dbError } = await admin.from('catalog_patient_display_images').upsert(
      { client_id: client.id, product_id: productId, color_name: colorName, image_path: displayPath, generated_at: new Date().toISOString() },
      { onConflict: 'client_id,product_id,color_name' }
    );
    if (dbError) console.error('catalog_patient_display_image_upsert_failed', { message: dbError.message });

    const { data: signed } = await admin.storage.from(TRYON_BUCKET).createSignedUrl(displayPath, 3600);
    return NextResponse.json({ message: 'Salva como sua imagem principal para este modelo.', imageUrl: signed?.signedUrl || null });
  } catch (err) {
    console.error('tryon_compose_failed', { message: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ message: 'Não foi possível compor a imagem.' }, { status: 500 });
  }
}
