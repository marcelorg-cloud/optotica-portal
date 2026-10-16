import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';
import { parseMirrorBatch } from '@/lib/catalog/mirror-batch';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const noCache = { 'Cache-Control': 'private, no-store' };
const respond = (data: Record<string, unknown>, status = 200) =>
  NextResponse.json(data, { status, headers: noCache });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
type C = { supplierId?: unknown; action?: unknown; raw?: unknown; page?: unknown; includeOther?: unknown; supplierItemId?: unknown; productId?: unknown };

function isConfigured() {
  return !!(process.env.ALIEXPRESS_STORE_SEARCH_URL && process.env.ALIEXPRESS_RAPIDAPI_KEY);
}

async function supplierById(admin: Awaited<ReturnType<typeof requireMaster>> & { ok: true }, id: unknown) {
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  const { data, error } = await admin.admin.from('catalog_suppliers')
    .select('id,store_id,status,name').eq('id',id).maybeSingle();
  if (error || !data || data.status !== 'liberado') return null;
  return data;
}

async function fetchStorePage(storeId: string, page: number) {
  const template = process.env.ALIEXPRESS_STORE_SEARCH_URL;
  const key = process.env.ALIEXPRESS_RAPIDAPI_KEY;
  if (!template || !key) throw new Error('API de busca AliExpress não configurada. Utilize o JSON da loja ou configure a integração.');
  const url = new URL(template.replaceAll('{storeId}', encodeURIComponent(storeId)).replaceAll('{page}', String(page)));
  if (url.protocol !== 'https:' || url.hostname !== 'aliexpress-datahub.p.rapidapi.com'
    || !template.includes('{storeId}') || !template.includes('{page}')) {
    throw new Error('Endpoint de busca de loja não corresponde à integração AliExpress DataHub.');
  }
  const response = await fetch(url, {
    method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': url.hostname }
  });
  if (!response.ok) throw new Error('Busca AliExpress indisponível (' + response.status + '). Nenhum lote foi salvo.');
  const raw = await response.text();
  if (raw.length > 1_000_000) throw new Error('Página AliExpress excede 1 MB.');
  return raw;
}

async function ingest(
  admin: Awaited<ReturnType<typeof requireMaster>> & { ok: true },
  supplier: { id: string; store_id: string },
  raw: string, source: 'manual_store_json' | 'store_search_api', includeOther: boolean
) {
  const parsed = parseMirrorBatch(raw, supplier.store_id, { allListings: includeOther });
  const entries = parsed.candidates.slice(0,100);
  if (!entries.length) return { saved: 0, alreadyKnown: 0, inCatalog: 0, sourceCount: parsed.sourceCount,
    filteredCount: parsed.filteredCount, storeVerified: parsed.storeVerified || source === 'store_search_api',
    exhausted: parsed.candidates.length > 100 };
  const ids = entries.map(x => x.itemId);
  const [{ data: catalog, error: catalogError }, { data: staged, error: mirrorError }] = await Promise.all([
    admin.admin.from('catalog_products').select('supplier_item_id').eq('supplier_id',supplier.id).in('supplier_item_id',ids),
    admin.admin.from('catalog_supplier_mirror_items').select('supplier_item_id').eq('supplier_id',supplier.id).in('supplier_item_id',ids)
  ]);
  if (catalogError || mirrorError) throw new Error('Não foi possível verificar duplicatas. Nenhum lote foi inserido.');
  const existingCatalog = new Set((catalog || []).map(x => x.supplier_item_id));
  const alreadyStaged = new Set((staged || []).map(x => x.supplier_item_id));
  const novel = entries.filter(x => !existingCatalog.has(x.itemId) && !alreadyStaged.has(x.itemId));
  const batch = novel.map(x => ({
    supplier_id: supplier.id, supplier_item_id: x.itemId, title: x.title,
    supplier_sku: x.supplierSku, source_image_url: x.imageUrl,
    listing_price: x.price, listing_currency: x.currency, import_source: source,
    store_verified: parsed.storeVerified || source === 'store_search_api'
  }));
  let saved = 0;
  if (batch.length) {
    // Unique supplier-item constraint is the final concurrency fence.
    // DO NOTHING on conflict; existing selections/publications are never overwritten.
    const { data, error } = await admin.admin.from('catalog_supplier_mirror_items')
      .upsert(batch, { onConflict: 'supplier_id,supplier_item_id', ignoreDuplicates: true })
      .select('id');
    if (error) throw new Error('Não foi possível salvar o lote do espelho; confira o cadastro antes de repetir.');
    saved = data?.length || 0;
  }
  return { saved, alreadyKnown: alreadyStaged.size, inCatalog: existingCatalog.size,
    sourceCount: parsed.sourceCount, filteredCount: parsed.filteredCount,
    storeVerified: parsed.storeVerified || source === 'store_search_api',
    exhausted: parsed.candidates.length > 100 };
}

export async function GET(request: Request) {
  const auth = await requireMaster();
  if (!auth.ok) return respond({ message: auth.message }, auth.status);
  const id = new URL(request.url).searchParams.get('supplierId');
  const supplier = await supplierById(auth,id);
  if (!supplier) return respond({ message: 'Fornecedor não liberado.' }, 404);
  const { data, error, count } = await auth.admin
    .from('catalog_supplier_mirror_items')
    .select('id,supplier_item_id,title,supplier_sku,source_image_url,listing_price,listing_currency,status,store_verified,import_source,last_seen_at',
      { count: 'exact' })
    .eq('supplier_id', supplier.id).order('last_seen_at',{ascending:false}).limit(500);
  if (error) return respond({ message: 'Fila do espelho indisponível.' }, 503);
  return respond({
    supplierId: supplier.id, supplier: supplier.name, total: count || 0, pageSize: 500,
    apiConfigured: isConfigured(), publishAutomatically: false,
    items: (data || []).map((x) => ({
      id: x.id, itemId: x.supplier_item_id, title: x.title, supplierSku: x.supplier_sku,
      imageUrl: x.source_image_url, price: x.listing_price, currency: x.listing_currency,
      status: x.status, storeVerified: x.store_verified, source: x.import_source
    }))
  });
}

export async function POST(request: Request) {
  const auth = await requireMaster();
  if (!auth.ok) return respond({ message: auth.message }, auth.status);
  const body = await request.json().catch(() => null) as C | null;
  if (!body || typeof body !== 'object') return respond({ message: 'Solicitação inválida.' },400);
  const supplier = await supplierById(auth, body.supplierId);
  if (!supplier) return respond({ message: 'Fornecedor não liberado.' },404);

  if (body.action === 'mark_imported') {
    const itemId = String(body.supplierItemId || ''),productId = String(body.productId || '');
    if (!/^\d{5,30}$/.test(itemId)||!UUID.test(productId)) return respond({ message:'Produto inválido.' },400);
    const { data: match } = await auth.admin.from('catalog_products').select('id')
      .eq('id',productId).eq('supplier_id',supplier.id).eq('supplier_item_id',itemId).maybeSingle();
    if (!match) return respond({ message:'Produto não corresponde ao fornecedor e item.' },409);
    const { error } = await auth.admin.from('catalog_supplier_mirror_items')
      .update({status:'importado',matched_product_id:productId,updated_at:new Date().toISOString()})
      .eq('supplier_id',supplier.id).eq('supplier_item_id',itemId);
    if (error) return respond({ message:'Registro do espelho não confirmado.' },503);
    return respond({ imported:true });
  }

  if (body.action !== 'ingest_json' && body.action !== 'sync_page')
    return respond({ message:'Operação não disponível.' },400);
  if (body.action === 'sync_page' && !isConfigured())
    return respond({ configured:false,message:'A integração AliExpress DataHub não tem credenciais no projeto Vercel. Cole o JSON da loja por enquanto.' },503);
  if (body.action === 'sync_page' && (!Number.isInteger(body.page) || Number(body.page)<1 || Number(body.page)>500))
    return respond({ message:'Página deve estar entre 1 e 500.' },400);
  if (body.action === 'ingest_json' && (typeof body.raw !== 'string' || body.raw.length>1_000_000))
    return respond({ message:'Cole uma página JSON de até 1 MB.' },400);
  try {
    const source = body.action === 'sync_page' ? 'store_search_api' : 'manual_store_json';
    const raw = source === 'store_search_api' ? await fetchStorePage(supplier.store_id,Number(body.page)) : body.raw as string;
    const result = await ingest(auth,supplier,raw,source,body.includeOther === true);
    return respond({ ...result, noAutomaticPublication:true, source,
      message: result.saved+' anúncio(s) novo(s) guardado(s) no espelho para triagem. Nenhum produto foi publicado.' });
  } catch (error) {
    return respond({ message:error instanceof Error ? error.message.slice(0,180) : 'Não foi possível processar a listagem.' },422);
  }
}
