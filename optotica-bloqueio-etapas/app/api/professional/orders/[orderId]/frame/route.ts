import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

type FrameVariant = { color?: string; supplier_sku?: string; qty?: number; image?: string };

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const frameId = typeof body?.frameId === 'string' ? body.frameId : '';
  const color = typeof body?.color === 'string' ? body.color : '';
  if (!frameId || !color) return NextResponse.json({ message: 'Escolha uma armação e uma cor.' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { data: order } = await admin.from('orders').select('id, organization_id').eq('id', orderId).eq('professional_id', user.id).maybeSingle();
  if (!order) return NextResponse.json({ message: 'Pedido não encontrado.' }, { status: 404 });

  // Depois que a Comanda final (etapa 4) é confirmada, a escolha de armação fica bloqueada.
  const { data: fulfillment } = await admin.from('order_fulfillment').select('comanda_confirmed_at').eq('order_id', orderId).maybeSingle();
  if (fulfillment?.comanda_confirmed_at) {
    return NextResponse.json({ message: 'A Comanda final já foi confirmada — a armação não pode mais ser alterada.' }, { status: 409 });
  }

  const { data: frame } = await admin.from('frames').select('id, name, sku, source, metadata').eq('id', frameId).maybeSingle();
  if (!frame) return NextResponse.json({ message: 'Armação não encontrada.' }, { status: 404 });

  const variants: FrameVariant[] = Array.isArray((frame.metadata as { variants?: unknown })?.variants)
    ? (frame.metadata as { variants: FrameVariant[] }).variants
    : [];
  const variant = variants.find((v) => v.color === color);
  if (!variant) return NextResponse.json({ message: 'Cor indisponível para esta armação.' }, { status: 400 });
  if (!variant.qty || variant.qty <= 0) return NextResponse.json({ message: 'Esta cor está indisponível no momento.' }, { status: 400 });

  const { error } = await admin.from('order_frames').upsert({
    order_id: order.id,
    organization_id: order.organization_id,
    frame_id: frame.id,
    frame_name: frame.name,
    sku: variant.supplier_sku || frame.sku,
    color,
    source: frame.source
  }, { onConflict: 'order_id' });
  if (error) {
    console.error('order_frame_save_failed', { code: error.code });
    return NextResponse.json({ message: 'Não foi possível registrar a armação.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Armação selecionada.', frameName: frame.name, color });
}
