import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';

// Catálogo de Produtos (seção 0.28 — telas do painel de catálogo, em cima
// da migração 202609110020 e do pacote de API da seção 0.27): o pacote
// original trouxe só o PATCH de aprovação de imagem por cor — esta rota
// preenche a lacuna de listar/criar produto, que faltava para a tela
// "Catálogo de Produtos" e o formulário de novo produto existirem.
//
// Criação manual (sem a Fila de Importação do AliExpress, que fica para uma
// fase seguinte — ver documento do projeto): o master cadastra o modelo à
// mão, com measurement_source='manual' (a Fila de Importação, quando
// existir, é que preencheria 'api' a partir do anúncio).

const clean = (value: unknown, max = 200) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';

export async function GET() {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { data: products, error } = await auth.admin
    .from('catalog_products')
    .select('id, supplier_id, supplier_item_id, model_name, sku_optotica, lens_width_mm, lens_height_mm, measurement_source, status, created_at, catalog_suppliers(name)')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ message: 'Não foi possível carregar o catálogo.' }, { status: 500 });

  const productIds = (products || []).map((p) => p.id);
  const { data: images } = productIds.length
    ? await auth.admin
        .from('catalog_product_color_images')
        .select('product_id, status')
        .in('product_id', productIds)
    : { data: [] as { product_id: string; status: string }[] };

  const countsByProduct = new Map<string, Record<string, number>>();
  for (const image of images || []) {
    const counts = countsByProduct.get(image.product_id) || {};
    counts[image.status] = (counts[image.status] || 0) + 1;
    countsByProduct.set(image.product_id, counts);
  }

  const result = (products || []).map((p) => ({
    id: p.id,
    modelName: p.model_name,
    skuOptotica: p.sku_optotica,
    lensWidthMm: p.lens_width_mm,
    lensHeightMm: p.lens_height_mm,
    measurementSource: p.measurement_source,
    status: p.status,
    supplierName: (p as unknown as { catalog_suppliers: { name: string } | null }).catalog_suppliers?.name || null,
    createdAt: p.created_at,
    colorCounts: countsByProduct.get(p.id) || {}
  }));

  return NextResponse.json({ products: result });
}

export async function POST(request: Request) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const supplierId = typeof body?.supplierId === 'string' ? body.supplierId : '';
  const supplierItemId = clean(body?.supplierItemId, 80);
  const modelName = clean(body?.modelName, 140);
  const skuOptotica = clean(body?.skuOptotica, 40);
  const lensWidthMm = Number(body?.lensWidthMm);
  const lensHeightMm = Number(body?.lensHeightMm);

  if (!supplierId || !supplierItemId || modelName.length < 2 || !skuOptotica) {
    return NextResponse.json({ message: 'Informe fornecedor, Product ID do fornecedor, nome do modelo e SKU (Optótica).' }, { status: 400 });
  }

  const { data: supplier } = await auth.admin
    .from('catalog_suppliers')
    .select('id, status')
    .eq('id', supplierId)
    .maybeSingle();
  if (!supplier || supplier.status !== 'liberado') {
    return NextResponse.json({ message: 'Fornecedor inválido ou não liberado.' }, { status: 400 });
  }

  const { data, error } = await auth.admin
    .from('catalog_products')
    .insert({
      supplier_id: supplierId,
      supplier_item_id: supplierItemId,
      model_name: modelName,
      sku_optotica: skuOptotica,
      lens_width_mm: Number.isFinite(lensWidthMm) && lensWidthMm > 0 ? lensWidthMm : null,
      lens_height_mm: Number.isFinite(lensHeightMm) && lensHeightMm > 0 ? lensHeightMm : null,
      measurement_source: 'manual',
      status: 'em_triagem'
    })
    .select('id')
    .single();
  if (error) {
    const duplicate = error.code === '23505';
    return NextResponse.json(
      { message: duplicate ? 'Já existe um produto com este SKU ou com este Product ID para este fornecedor.' : 'Não foi possível criar o produto.' },
      { status: duplicate ? 409 : 500 }
    );
  }

  return NextResponse.json({ message: 'Produto criado — adicione as cores na tela do produto.', id: data.id });
}
