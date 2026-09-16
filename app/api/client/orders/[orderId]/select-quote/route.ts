import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { isOrderFinalized } from '@/lib/order-status';

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login para continuar.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const quoteId = typeof body?.quoteId === 'string' ? body.quoteId : '';
  if (!quoteId) return NextResponse.json({ message: 'Orçamento inválido.' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { data: account } = await admin.from('client_user_accounts').select('client_id').eq('user_id', user.id).maybeSingle();
  if (!account) return NextResponse.json({ message: 'Cadastro de cliente não encontrado.' }, { status: 403 });

  const { data: client } = await admin.from('clients').select('id').eq('id', account.client_id).eq('status', 'active').maybeSingle();
  if (!client) return NextResponse.json({ message: 'Cadastro de cliente inativo.' }, { status: 403 });

  const { data: order } = await admin.from('orders').select('id, status').eq('id', orderId).eq('client_id', client.id).maybeSingle();
  if (!order) return NextResponse.json({ message: 'Pedido não encontrado.' }, { status: 404 });
  // 16/09/2026 — 'completed' nunca é um valor real de orders.status, então
  // esta trava nunca funcionava de verdade. Usa isOrderFinalized (só
  // 'delivered'/'cancelled' travam — ver lib/order-status.ts) em vez de
  // "!== 'in_progress'", já que a constraint do banco aceita outros valores
  // intermediários que não devem ser tratados como finalizados.
  if (isOrderFinalized(order.status)) return NextResponse.json({ message: 'Este pedido já foi concluído.' }, { status: 400 });

  const { data: fulfillment, error: fulfillmentError } = await admin.from('order_fulfillment')
    .select('comanda_confirmed_at').eq('order_id', orderId).maybeSingle();
  if (fulfillmentError) return NextResponse.json({ message: 'Não foi possível verificar a confirmação do pedido.' }, { status: 500 });
  if (fulfillment?.comanda_confirmed_at) return NextResponse.json({ message: 'Pedido confirmado. Fale com seu profissional para solicitar alterações.' }, { status: 409 });

  const { data: quote } = await admin.from('quotes').select('id, total').eq('id', quoteId).eq('order_id', orderId).maybeSingle();
  if (!quote) return NextResponse.json({ message: 'Orçamento não encontrado neste pedido.' }, { status: 404 });

  const { error } = await admin.from('orders').update({ selected_quote_id: quote.id, total: quote.total }).eq('id', orderId);
  if (error) {
    console.error('client_select_quote_failed', { code: error.code });
    return NextResponse.json({ message: 'Não foi possível selecionar o orçamento.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Orçamento selecionado.' });
}
