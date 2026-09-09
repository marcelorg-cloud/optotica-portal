import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const quoteId = typeof body?.quoteId === 'string' ? body.quoteId : '';
  if (!quoteId) return NextResponse.json({ message: 'Orçamento inválido.' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { data: order } = await admin.from('orders').select('id').eq('id', orderId).eq('professional_id', user.id).maybeSingle();
  if (!order) return NextResponse.json({ message: 'Pedido não encontrado.' }, { status: 404 });

  const { data: quote } = await admin.from('quotes').select('id, total').eq('id', quoteId).eq('order_id', orderId).maybeSingle();
  if (!quote) return NextResponse.json({ message: 'Orçamento não encontrado neste pedido.' }, { status: 404 });

  // Depois que a Comanda final (etapa 4) é confirmada, a seleção de orçamento fica bloqueada.
  const { data: fulfillment } = await admin.from('order_fulfillment').select('comanda_confirmed_at').eq('order_id', orderId).maybeSingle();
  if (fulfillment?.comanda_confirmed_at) {
    return NextResponse.json({ message: 'A Comanda final já foi confirmada — não é possível trocar o orçamento.' }, { status: 409 });
  }

  const { error } = await admin.from('orders').update({ selected_quote_id: quote.id, total: quote.total }).eq('id', orderId);
  if (error) {
    console.error('select_quote_failed', { code: error.code });
    return NextResponse.json({ message: 'Não foi possível selecionar o orçamento.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Orçamento selecionado.' });
}
