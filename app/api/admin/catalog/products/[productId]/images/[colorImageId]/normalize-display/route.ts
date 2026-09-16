import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';
import { loadModelPhotoReferences } from '@/lib/catalog/model-photo-references';
import { normalizeExistingDisplay } from '@/lib/catalog/gallery-photo-crop';

export const maxDuration = 300;
const BUCKET = 'catalog-product-photos';

export async function POST(request: Request, { params }: { params: Promise<{ productId: string; colorImageId: string }> }) {
  const { productId, colorImageId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });
  const body = await request.json().catch(() => null);
  const position = Number(body?.position);
  if (!Number.isInteger(position) || position < 1) return NextResponse.json({ message: 'Foto inválida.' }, { status: 400 });
  const { data: color } = await auth.admin.from('catalog_product_color_images').select('id').eq('id', colorImageId).eq('product_id', productId).maybeSingle();
  if (!color) return NextResponse.json({ message: 'Cor não encontrada neste modelo.' }, { status: 404 });
  const { data: original } = await auth.admin.from('catalog_product_color_display_images').select('id,image_path,source,source_gallery_image_id,from_own_color_photo').eq('color_image_id', colorImageId).eq('position', position).maybeSingle();
  if (!original?.image_path) return NextResponse.json({ message: 'Foto não encontrada.' }, { status: 404 });
  try {
    const references = await loadModelPhotoReferences(auth.admin, productId, original.id);
    const { data: signed } = await auth.admin.storage.from(BUCKET).createSignedUrl(original.image_path, 900);
    if (!signed?.signedUrl) throw new Error('Não foi possível carregar a foto original.');
    const buffer = await normalizeExistingDisplay(signed.signedUrl, references);
    const { data: last, error: lastError } = await auth.admin.from('catalog_product_color_display_images').select('position').eq('color_image_id', colorImageId).order('position', { ascending: false }).limit(1).maybeSingle();
    if (lastError) throw new Error('Não foi possível preparar a nova foto.');
    const newPosition = (last?.position || 0) + 1;
    const path = `${productId}/display/${colorImageId}-${crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await auth.admin.storage.from(BUCKET).upload(path, buffer, { contentType: 'image/jpeg', upsert: false });
    if (uploadError) throw new Error('Não foi possível salvar a nova imagem.');
    const { data: created, error } = await auth.admin.from('catalog_product_color_display_images').insert({
      color_image_id: colorImageId, position: newPosition, image_path: path,
      source: original.source, source_gallery_image_id: original.source_gallery_image_id,
      from_own_color_photo: original.from_own_color_photo, validated_at: null, validated_by: null
    }).select('id').single();
    if (error) {
      await auth.admin.storage.from(BUCKET).remove([path]);
      throw new Error('Não foi possível registrar a nova versão. A original foi preservada.');
    }
    return NextResponse.json({ message: 'Nova versão padronizada criada. Compare e valide antes de publicar; a original foi preservada.', createdId: created.id, position: newPosition, referenceCount: references.length });
  } catch (error) {
    console.error('normalize_catalog_display_failed', { message: error instanceof Error ? error.message : 'unknown' });
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Não foi possível padronizar a foto.' }, { status: 502 });
  }
}
