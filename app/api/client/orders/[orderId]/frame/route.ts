import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { isOrderFinalized } from '@/lib/order-status';

type CatalogColor = { id: string; color_name: string; supplier_sku: string | null; catalog_products: { id: string; model_name: string } | null };

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login para continuar.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const colorId = typeof body?.catalogColorImageId === 'string' ? body.catalogColorImageId : '';
  if (!colorId) return NextResponse.json({ message: 'Escolha uma armação e uma cor.' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { data: account } = await admin.from('client_user_accounts').select('client_id').eq('user_id', user.id).maybeSingle();
  if (!account) return NextResponse.json({ message: 'Cadastro de paciente não encontrado.' }, { status: 403 });

  const { data: client } = await admin.from('clients').select('id').eq('id', account.client_id).eq('status', 'active').maybeSingle();
  if (!client) return NextResponse.json({ message: 'Cadastro de paciente inativo.' }, { status: 403 });

  const { data: order } = await admin.from('orders').select('id, organization_id, status').eq('id', orderId).eq('client_id', client.id).maybeSingle();
  if (!order) return NextResponse.json({ message: 'Pedido não encontrado.' }, { status: 404 });
  // 16/09/2026 — 'completed' nunca é um valor real de orders.status, então
  // esta trava nunca funcionava de verdade. A constraint do banco aceita bem
  // mais valores do que só 'in_progress'/'delivered' (ver lib/order-status.ts)
  // — usamos isOrderFinalized (só 'delivered'/'cancelled' travam) em vez de
  // "!== 'in_progress'" para não travar por engano um status intermediário.
  if (isOrderFinalized(order.status)) return NextResponse.json({ message: 'Este pedido já foi concluído.' }, { status: 400 });

  const { data: fulfillment, error: fulfillmentError } = await admin.from('order_fulfillment')
    .select('comanda_confirmed_at').eq('order_id', orderId).maybeSingle();
  if (fulfillmentError) return NextResponse.json({ message: 'Não foi possível verificar a confirmação do pedido.' }, { status: 500 });
  if (fulfillment?.comanda_confirmed_at) return NextResponse.json({ message: 'Pedido confirmado. Fale com seu profissional para solicitar alterações.' }, { status: 409 });

  const { data: row, error: catalogError } = await admin.from('catalog_product_color_images')
    .select('id, color_name, supplier_sku, catalog_products!inner(id, model_name, status)')
    .eq('id', colorId).eq('is_active', true).eq('status', 'validada')
    .eq('catalog_products.status', 'publicado').maybeSingle();
  if (catalogError) return NextResponse.json({ message: 'Não foi possível consultar o catálogo.' }, { status: 500 });
  const color = row as unknown as CatalogColor | null;
  const product = color?.catalog_products;
  if (!color || !product) return NextResponse.json({ message: 'Esta cor não está disponível no catálogo.' }, { status: 404 });

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
    console.error('client_order_frame_save_failed', { code: error.code });
    return NextResponse.json({ message: 'Não foi possível registrar a armação.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Armação selecionada.', frameName: product.model_name, color: color.color_name });
}
