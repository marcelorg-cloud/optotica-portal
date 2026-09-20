import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

// Rota nova (15/09/2026, redesenho da Etapa 3 "Escolha da armação"): grava
// a reação GOSTEI/TALVEZ/OCULTAR do profissional para uma cor específica do
// catálogo, dentro deste pedido — não é a escolha final (essa é
// .../frame/route.ts, que grava em order_frames). Uma cor pode ter no
// máximo 1 reação por pedido (order_frame_reactions_unique); marcar a MESMA
// reação de novo REMOVE (alterna liga/desliga) — pedido implícito do
// wireframe, onde os 3 botões funcionam como toggle, não como rádio restrito.
export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const catalogColorImageId = typeof body?.catalogColorImageId === 'string' ? body.catalogColorImageId : '';
  const status = typeof body?.status === 'string' ? body.status : '';
  if (!catalogColorImageId || !['gostei', 'talvez', 'oculto'].includes(status)) {
    return NextResponse.json({ message: 'Reação inválida.' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data: order } = await admin.from('orders').select('id, organization_id').eq('id', orderId).eq('professional_id', user.id).maybeSingle();
  if (!order) return NextResponse.json({ message: 'Pedido não encontrado.' }, { status: 404 });

  const { data: fulfillment } = await admin.from('order_fulfillment').select('comanda_confirmed_at').eq('order_id', orderId).maybeSingle();
  if (fulfillment?.comanda_confirmed_at) {
    return NextResponse.json({ message: 'A Comanda final já foi confirmada — as reações não podem mais ser alteradas.' }, { status: 409 });
  }

  const { data: color } = await admin
    .from('catalog_product_color_images')
    .select('id, product_id, catalog_products!inner(status)')
    .eq('id', catalogColorImageId).eq('is_active', true).eq('catalog_products.status', 'publicado')
    .maybeSingle();
  if (!color) return NextResponse.json({ message: 'Cor não encontrada no catálogo.' }, { status: 404 });

  const { data: existing } = await admin
    .from('order_frame_reactions')
    .select('id, status')
    .eq('order_id', orderId)
    .eq('catalog_color_image_id', catalogColorImageId)
    .maybeSingle();

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
