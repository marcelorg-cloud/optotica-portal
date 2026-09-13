import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';

const STATUSES = ['em_triagem', 'publicado', 'arquivado'] as const;

export async function GET(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { data: product } = await auth.admin
    .from('catalog_products')
    .select('id, supplier_id, supplier_item_id, model_name, sku_optotica, lens_width_mm, lens_height_mm, measurement_source, status, created_at, catalog_suppliers(name, store_id)')
    .eq('id', productId)
    .maybeSingle();
  if (!product) return NextResponse.json({ message: 'Produto não encontrado.' }, { status: 404 });

  const { data: images } = await auth.admin
    .from('catalog_product_color_images')
    .select('id, color_name, supplier_sku, original_image_path, processed_image_path, status, missing_required_fields, rejection_reason, validated_at, created_at, source_image_url')
    .eq('product_id', productId)
    .order('color_name', { ascending: true });

  // Galeria geral de fotos do anúncio (por produto, não por cor) — usada
  // pelo seletor de miniaturas em "Trocar foto" (ver migração
  // 202609130006). Ordenada pela posição original no anúncio.
  const { data: gallery } = await auth.admin
    .from('catalog_product_gallery_images')
    .select('image_url')
    .eq('product_id', productId)
    .order('position', { ascending: true });

  const withUrls = await Promise.all((images || []).map(async (image) => {
    const [original, processed] = await Promise.all([
      image.original_image_path ? auth.admin.storage.from('catalog-product-photos').createSignedUrl(image.original_image_path, 3600) : Promise.resolve({ data: null }),
      image.processed_image_path ? auth.admin.storage.from('catalog-product-photos').createSignedUrl(image.processed_image_path, 3600) : Promise.resolve({ data: null })
    ]);
    return {
      id: image.id,
      colorName: image.color_name,
      supplierSku: image.supplier_sku,
      status: image.status,
      missingRequiredFields: image.missing_required_fields,
      rejectionReason: image.rejection_reason,
      validatedAt: image.validated_at,
      originalImageUrl: original.data?.signedUrl || null,
      processedImageUrl: processed.data?.signedUrl || null,
      hasSourceImageUrl: Boolean(image.source_image_url)
    };
  }));

  const supplier = (product as unknown as { catalog_suppliers: { name: string; store_id: string } | null }).catalog_suppliers;

  return NextResponse.json({
    product: {
      id: product.id,
      modelName: product.model_name,
      skuOptotica: product.sku_optotica,
      supplierItemId: product.supplier_item_id,
      lensWidthMm: product.lens_width_mm,
      lensHeightMm: product.lens_height_mm,
      measurementSource: product.measurement_source,
      status: product.status,
      supplierName: supplier?.name || null,
      supplierStoreId: supplier?.store_id || null,
      createdAt: product.created_at,
      galleryImages: (gallery || []).map((g) => g.image_url)
    },
    colorImages: withUrls
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now };

  if (typeof body?.modelName === 'string') {
    const modelName = body.modelName.trim().slice(0, 140);
    if (modelName.length < 2) return NextResponse.json({ message: 'Nome do modelo inválido.' }, { status: 400 });
    patch.model_name = modelName;
  }
  if (typeof body?.skuOptotica === 'string') {
    const sku = body.skuOptotica.trim().slice(0, 40);
    if (!sku) return NextResponse.json({ message: 'SKU inválido.' }, { status: 400 });
    patch.sku_optotica = sku;
  }
  if (body?.lensWidthMm !== undefined || body?.lensHeightMm !== undefined) {
    // Corrigir manualmente a medida vinda da API (decisão registrada: a
    // amostra física é o crivo real) — vira 'manual' a partir daqui.
    const width = Number(body.lensWidthMm);
    const height = Number(body.lensHeightMm);
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      return NextResponse.json({ message: 'Informe largura e altura da lente em mm.' }, { status: 400 });
    }
    patch.lens_width_mm = width;
    patch.lens_height_mm = height;
    patch.measurement_source = 'manual';
  }
  if (typeof body?.status === 'string') {
    if (!STATUSES.includes(body.status as typeof STATUSES[number])) {
      return NextResponse.json({ message: 'Status inválido.' }, { status: 400 });
    }
    if (body.status === 'publicado') {
      patch.published_at = now;
      patch.published_by = auth.userId;
    }
    patch.status = body.status;
  }

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ message: 'Nada para atualizar.' }, { status: 400 });
  }

  const { error } = await auth.admin.from('catalog_products').update(patch).eq('id', productId);
  if (error) {
    const duplicate = error.code === '23505';
    return NextResponse.json({ message: duplicate ? 'Já existe um produto com este SKU.' : 'Não foi possível salvar as alterações.' }, { status: duplicate ? 409 : 500 });
  }

  return NextResponse.json({ message: 'Produto atualizado.' });
}
