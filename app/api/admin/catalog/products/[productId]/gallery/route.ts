import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';

// Novo (13/09/2026) — "colar JSON do AliExpress" na criação do produto
// (Painel de Catálogo): grava em lote as fotos gerais do anúncio
// (`item.images` + `item.description.images` da API do AliExpress) na
// galeria já existente (`catalog_product_gallery_images`, migração
// 202609130006) — a mesma tabela que alimenta o seletor de miniaturas em
// "Trocar foto". Até aqui essa tabela só era populada à mão via SQL; esta é
// a primeira rota que grava nela.
//
// Deduplicação: a constraint única (product_id, image_url) já existe —
// `upsert(..., { ignoreDuplicates: true })` deixa colar o mesmo JSON de novo
// sem duplicar linhas nem dar erro.
//
// IMPORTANTE (classificação por IA das fotos): esta rota só GRAVA as URLs.
// A etapa de rodar cada foto numa IA de visão pra marcar "parece foto de
// frente" / "pessoa vestindo" / "embalagem" etc. (pedido do usuário,
// 13/09/2026) fica para uma próxima rodada — por enquanto as fotos entram
// sem nenhuma etiqueta, exatamente como já funcionava antes pra quem
// inseria via SQL manual.
const MAX_URLS_PER_CALL = 60;

export async function POST(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { data: product } = await auth.admin.from('catalog_products').select('id').eq('id', productId).maybeSingle();
  if (!product) return NextResponse.json({ message: 'Produto não encontrado.' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const imageUrls: string[] = Array.isArray(body?.imageUrls)
    ? Array.from(new Set(body.imageUrls.filter((u: unknown): u is string => typeof u === 'string' && /^https:\/\//.test(u)).map((u: string) => u.slice(0, 2000))))
    : [];

  if (!imageUrls.length) return NextResponse.json({ message: 'Nenhuma URL de imagem válida enviada.' }, { status: 400 });
  if (imageUrls.length > MAX_URLS_PER_CALL) {
    return NextResponse.json({ message: `No máximo ${MAX_URLS_PER_CALL} fotos por vez.` }, { status: 400 });
  }

  const rows = imageUrls.map((image_url, index) => ({ product_id: productId, image_url, position: index }));
  const { error } = await auth.admin
    .from('catalog_product_gallery_images')
    .upsert(rows, { onConflict: 'product_id,image_url', ignoreDuplicates: true });
  if (error) {
    console.error('catalog_product_gallery_images_bulk_insert_failed', { message: error.message });
    return NextResponse.json({ message: 'Não foi possível salvar as fotos da galeria.' }, { status: 500 });
  }

  return NextResponse.json({ message: `${imageUrls.length} foto(s) adicionada(s) à galeria.` });
}
