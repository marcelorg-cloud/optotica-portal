import type { SupabaseClient } from '@supabase/supabase-js';
import { classifyDisplayView } from './gallery-photo-crop';
import type { DisplayReference } from './display-photo-standard';

const viewCache = new Map<string, { view: DisplayReference['view'] | null; expires: number }>();

export async function loadModelPhotoReferences(admin: SupabaseClient, productId: string, excludeId?: string): Promise<DisplayReference[]> {
  const { data, error } = await admin.from('catalog_product_color_display_images')
    .select('id,image_path,validated_at,catalog_product_color_images!inner(product_id)')
    .eq('catalog_product_color_images.product_id', productId)
    .not('validated_at', 'is', null).order('validated_at', { ascending: true }).limit(12);
  if (error) {
    console.error('catalog_model_references_query_failed', { productId, code: error.code, message: error.message });
    throw new Error('Não foi possível consultar as referências deste modelo.');
  }
  const references: DisplayReference[] = [];
  // Stable oldest-approved references, scoped to one product. Only the first
  // photo of each confidently classified view is used; detail is not a template.
  //
  // 17/09/2026 — bug real em produção: um erro ao classificar (IA,
  // `classifyDisplayView`, chamada externa ao Replicate) OU ao assinar/baixar
  // UMA ÚNICA foto de referência derrubava a função inteira (erro subia sem
  // nenhum log até a rota, que só devolvia "Não foi possível preparar as
  // referências do modelo" sem nenhum rastro do motivo real). Agora cada
  // referência é tratada isoladamente: uma falha pontual (rede, limite da
  // conta do Replicate, arquivo de imagem removido do Storage etc.) só pula
  // aquela referência — loga o motivo e segue tentando as próximas — em vez
  // de travar o processamento inteiro por causa de uma foto só.
  for (const row of data || []) {
    if (row.id === excludeId || !row.image_path) continue;
    try {
      const { data: signed, error: signError } = await admin.storage.from('catalog-product-photos').createSignedUrl(row.image_path, 900);
      if (signError || !signed?.signedUrl) {
        console.error('catalog_model_reference_sign_failed', { productId, rowId: row.id, message: signError?.message });
        continue;
      }
      const response = await fetch(signed.signedUrl, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) {
        console.error('catalog_model_reference_fetch_failed', { productId, rowId: row.id, status: response.status });
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const cacheKey = `${row.id}:${row.image_path}:${row.validated_at}`;
      const cached = viewCache.get(cacheKey);
      const view = cached && cached.expires > Date.now() ? cached.view : await classifyDisplayView(buffer);
      if (viewCache.size >= 200) viewCache.delete(viewCache.keys().next().value!);
      viewCache.set(cacheKey, { view, expires: Date.now() + 600000 });
      if (view && view !== 'detail' && !references.some((reference) => reference.view === view)) references.push({ url: signed.signedUrl, buffer, view });
      if (references.length === 3) break;
    } catch (err) {
      console.error('catalog_model_reference_classify_failed', { productId, rowId: row.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return references;
}
