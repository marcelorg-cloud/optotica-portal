import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';

// Fila de Aprovação IA (tela em app/admin/catalogo/aprovacao): junta
// catalog_product_color_images de TODOS os produtos com status 'pendente'
// (aguardando validação do master) e, à parte, as revisadas recentemente
// (validada/rejeitada), para a tela mostrar as duas listas.

export async function GET() {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const [pendingRes, recentRes] = await Promise.all([
    auth.admin
      .from('catalog_product_color_images')
      .select('id, product_id, color_name, original_image_path, processed_image_path, created_at, catalog_products(model_name, sku_optotica, lens_width_mm)')
      .eq('status', 'pendente')
      .order('created_at', { ascending: true }),
    auth.admin
      .from('catalog_product_color_images')
      .select('id, product_id, color_name, status, rejection_reason, validated_at, catalog_products(model_name)')
      .in('status', ['validada', 'rejeitada'])
      .order('validated_at', { ascending: false })
      .limit(20)
  ]);

  if (pendingRes.error || recentRes.error) {
    return NextResponse.json({ message: 'Não foi possível carregar a fila de aprovação.' }, { status: 500 });
  }

  type PendingRow = {
    id: string; product_id: string; color_name: string; original_image_path: string | null; processed_image_path: string | null; created_at: string;
    catalog_products: { model_name: string; sku_optotica: string; lens_width_mm: number | null } | null;
  };
  type RecentRow = {
    id: string; product_id: string; color_name: string; status: string; rejection_reason: string | null; validated_at: string | null;
    catalog_products: { model_name: string } | null;
  };

  const pending = await Promise.all(((pendingRes.data || []) as unknown as PendingRow[]).map(async (row) => {
    const [original, processed] = await Promise.all([
      row.original_image_path ? auth.admin.storage.from('catalog-product-photos').createSignedUrl(row.original_image_path, 3600) : Promise.resolve({ data: null }),
      row.processed_image_path ? auth.admin.storage.from('catalog-product-photos').createSignedUrl(row.processed_image_path, 3600) : Promise.resolve({ data: null })
    ]);
    return {
      id: row.id,
      productId: row.product_id,
      colorName: row.color_name,
      productName: row.catalog_products?.model_name || '',
      productSku: row.catalog_products?.sku_optotica || '',
      lensWidthMm: row.catalog_products?.lens_width_mm ?? null,
      createdAt: row.created_at,
      originalImageUrl: original.data?.signedUrl || null,
      processedImageUrl: processed.data?.signedUrl || null
    };
  }));

  const recent = ((recentRes.data || []) as unknown as RecentRow[]).map((row) => ({
    id: row.id,
    productName: row.catalog_products?.model_name || '',
    colorName: row.color_name,
    status: row.status,
    rejectionReason: row.rejection_reason,
    validatedAt: row.validated_at
  }));

  return NextResponse.json({ pending, recent });
}
