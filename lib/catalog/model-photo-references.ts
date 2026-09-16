import type { SupabaseClient } from '@supabase/supabase-js';
import { classifyDisplayView } from './gallery-photo-crop';
import type { DisplayReference } from './display-photo-standard';

const viewCache = new Map<string, { view: DisplayReference['view'] | null; expires: number }>();

export async function loadModelPhotoReferences(admin: SupabaseClient, productId: string, excludeId?: string): Promise<DisplayReference[]> {
  const { data, error } = await admin.from('catalog_product_color_display_images')
    .select('id,image_path,validated_at,catalog_product_color_images!inner(product_id)')
    .eq('catalog_product_color_images.product_id', productId)
    .not('validated_at', 'is', null).order('validated_at', { ascending: true }).limit(12);
  if (error) throw new Error('Não foi possível consultar as referências deste modelo.');
  const references: DisplayReference[] = [];
  // Stable oldest-approved references, scoped to one product. Only the first
  // photo of each confidently classified view is used; detail is not a template.
  for (const row of data || []) {
    if (row.id === excludeId || !row.image_path) continue;
    const { data: signed, error: signError } = await admin.storage.from('catalog-product-photos').createSignedUrl(row.image_path, 900);
    if (signError || !signed?.signedUrl) throw new Error('Não foi possível preparar a referência de foto.');
    const response = await fetch(signed.signedUrl, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Não foi possível carregar a referência de foto.');
    const buffer = Buffer.from(await response.arrayBuffer());
    const cacheKey = `${row.id}:${row.image_path}:${row.validated_at}`;
    const cached = viewCache.get(cacheKey);
    const view = cached && cached.expires > Date.now() ? cached.view : await classifyDisplayView(buffer);
    if (viewCache.size >= 200) viewCache.delete(viewCache.keys().next().value!);
    viewCache.set(cacheKey, { view, expires: Date.now() + 600000 });
    if (view && view !== 'detail' && !references.some((reference) => reference.view === view)) references.push({ url: signed.signedUrl, buffer, view });
    if (references.length === 3) break;
  }
  return references;
}
