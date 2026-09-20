import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

import { isOrderFinalized } from '@/lib/order-status';

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login para continuar.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const catalogColorImageId = typeof body?.catalogColorImageId === 'string' ? body.catalogColorImageId : '';
  const status = typeof body?.status === 'string' ? body.status : '';
  if (!catalogColorImageId || !['gostei', 'talvez', 'oculto'].includes(status)) {
    return NextResponse.json({ message: 'Reação inválida.' }, { status: 400 });
  }

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

  const { data: color } = await admin
    .from('catalog_product_color_images')
    .select('id, product_id, catalog_products!inner(status)')
    .eq('id', catalogColorImageId)
    .eq('is_active', true).eq('catalog_products.status', 'publicado')
    .maybeSingle();
  if (!color) return NextResponse.json({ message: 'Cor não encontrada no catálogo.' }, { status: 404 });

  const { data: existing, error: existingError } = await admin
    .from('order_frame_reactions')
    .select('id, status')
    .eq('order_id', orderId)
    .eq('catalog_color_image_id', catalogColorImageId)
    .maybeSingle();

  if (existingError) return NextResponse.json({ message: 'Não foi possível consultar a reação.' }, { status: 500 });

  if (existing && existing.status === status) {
    const { error: deleteError } = await admin.from('order_frame_reactions').delete().eq('id', existing.id);
    if (deleteError) {
      console.error('order_frame_reaction_delete_failed', { code: deleteError.code });
      return NextResponse.json({ message: 'Não foi possível desmarcar a reação.' }, { status: 500 });
    }
    return NextResponse.json({ message: 'Reação removida.', status: null });
  }

  const { error } = await admin.from('order_frame_reactions').upsert({
    order_id: orderId,
    organization_id: order.organization_id,
    catalog_product_id: color.product_id,
    catalog_color_image_id: color.id,
    status,
    reacted_by: user.id,
    reacted_at: new Date().toISOString()
  }, { onConflict: 'order_id,catalog_color_image_id' });
  if (error) {
    console.error('order_frame_reaction_save_failed', { code: error.code });
    return NextResponse.json({ message: 'Não foi possível registrar a reação.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Reação registrada.', status });
}
