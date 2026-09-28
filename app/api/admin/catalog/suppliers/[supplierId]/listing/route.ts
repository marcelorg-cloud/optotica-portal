import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';
import { parseSupplierList } from '@/lib/catalog/parse-supplier-list';

export async function GET(request: Request, { params }: { params: Promise<{ supplierId: string }> }) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });
  const { supplierId } = await params;
  const page = Number(new URL(request.url).searchParams.get('page') || 1);
  if (!Number.isInteger(page) || page < 1 || page > 500) return NextResponse.json({ message: 'Página inválida.' }, { status: 400 });
  const { data: supplier, error } = await auth.admin.from('catalog_suppliers').select('store_id, status').eq('id', supplierId).maybeSingle();
  if (error) return NextResponse.json({ message: 'Não foi possível consultar o fornecedor.' }, { status: 500 });
  if (!supplier || supplier.status !== 'liberado') return NextResponse.json({ message: 'Fornecedor não liberado.' }, { status: 404 });

  // A URL é configurada com o endpoint exato da assinatura existente: os
  // provedores variam em caminho e parâmetros. Nunca aceitar uma URL enviada
  // pelo navegador, nem revelar a chave da API ao cliente.
  const template = process.env.ALIEXPRESS_STORE_SEARCH_URL;
  const key = process.env.ALIEXPRESS_RAPIDAPI_KEY;
  if (!template || !key) return NextResponse.json({ configured: false, items: [] });
  let url: URL;
  try {
    url = new URL(template.replaceAll('{storeId}', encodeURIComponent(supplier.store_id)).replaceAll('{page}', String(page)));
    if (url.protocol !== 'https:' || url.hostname !== 'aliexpress-datahub.p.rapidapi.com' || !template.includes('{storeId}') || !template.includes('{page}')) throw new Error('Configuração inválida');
  } catch {
    return NextResponse.json({ message: 'A busca de produtos da loja não está configurada corretamente.' }, { status: 503 });
  }
  try {
    const response = await fetch(url, { headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': url.hostname }, cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (!response.ok) return NextResponse.json({ message: `A API de produtos da loja respondeu com erro (${response.status}).` }, { status: 502 });
    const raw = await response.text();
    if (raw.length > 2_000_000) return NextResponse.json({ message: 'Resposta da API grande demais.' }, { status: 502 });
    return NextResponse.json({ configured: true, items: parseSupplierList(raw, supplier.store_id) });
  } catch (error) {
    console.error('supplier_listing_failed', error);
    return NextResponse.json({ message: 'Não foi possível ler a lista da loja. Tente novamente ou cole o JSON da busca.' }, { status: 502 });
  }
}
