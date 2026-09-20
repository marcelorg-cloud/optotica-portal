import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

// Reescrita (15/09/2026, redesenho da Etapa 3 "Escolha da armação" pro
// layout GOSTEI/TALVEZ/OCULTAR): esta rota deixou de gravar a escolha a
// partir da tabela antiga `frames` (frameId + nome da cor em texto) — agora
// ela é a "confirmação final" de uma cor do CATÁLOGO NOVO, identificada só
// pelo id de `catalog_product_color_images`. As reações GOSTEI/TALVEZ/
// OCULTAR (não-finais) são gravadas por uma rota separada,
// .../frame-reactions/route.ts.
//
// order_frames continua com o mesmo formato de sempre (frame_name, sku,
// color) — quem já lê essa tabela (resumo do pedido, Comanda) não precisa
// mudar nada. frame_id fica null pra escolhas vindas do catálogo novo;
// catalog_product_id/catalog_color_image_id (colunas novas, migração
// 202609151600) é como esta tela sabe destacar qual cor está confirmada.
export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const catalogColorImageId = typeof body?.catalogColorImageId === 'string' ? body.catalogColorImageId : '';
  if (!catalogColorImageId) return NextResponse.json({ message: 'Escolha uma cor para confirmar.' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { data: order } = await admin.from('orders').select('id, organization_id').eq('id', orderId).eq('professional_id', user.id).maybeSingle();
  if (!order) return NextResponse.json({ message: 'Pedido não encontrado.' }, { status: 404 });

  // Depois que a Comanda final (etapa 4) é confirmada, a escolha de armação fica bloqueada.
  const { data: fulfillment } = await admin.from('order_fulfillment').select('comanda_confirmed_at').eq('order_id', orderId).maybeSingle();
  if (fulfillment?.comanda_confirmed_at) {
    return NextResponse.json({ message: 'A Comanda final já foi confirmada — a armação não pode mais ser alterada.' }, { status: 409 });
  }

  type ColorRow = {
    id: string; color_name: string; supplier_sku: string | null;
    catalog_products: { id: string; model_name: string; status: string } | null;
  };
  const { data: colorData } = await admin
    .from('catalog_product_color_images')
    .select('id, color_name, supplier_sku, catalog_products!inner(id, model_name, status)')
    .eq('id', catalogColorImageId).eq('is_active', true)
    .maybeSingle();
  const color = colorData as unknown as ColorRow | null;
  const product = color?.catalog_products || null;
  if (!color || !product) return NextResponse.json({ message: 'Cor não encontrada no catálogo.' }, { status: 404 });
  if (product.status !== 'publicado') return NextResponse.json({ message: 'Este modelo não está mais publicado no catálogo.' }, { status: 400 });

  const { error } = await admin.from('order_frames').upsert({
    order_id: order.id,
    organization_id: order.organization_id,
    frame_id: null,
    frame_name: product.model_name,
    sku: color.supplier_sku,
    color: color.color_name,
    source: 'catalogo',
    catalog_product_id: product.id,
    catalog_color_image_id: color.id
  }, { onConflict: 'order_id' });
  if (error) {
    console.error('order_frame_save_failed', { code: error.code });
    return NextResponse.json({ message: 'Não foi possível registrar a armação.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Armação confirmada.', frameName: product.model_name, color: color.color_name });
}
