import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

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
  if (order.status === 'completed') return NextResponse.json({ message: 'Este pedido já foi concluído.' }, { status: 400 });

  const { data: quote } = await admin.from('quotes').select('id, total').eq('id', quoteId).eq('order_id', orderId).maybeSingle();
  if (!quote) return NextResponse.json({ message: 'Orçamento não encontrado neste pedido.' }, { status: 404 });

  const { error } = await admin.from('orders').update({ selected_quote_id: quote.id, total: quote.total }).eq('id', orderId);
  if (error) {
    console.error('client_select_quote_failed', { code: error.code });
    return NextResponse.json({ message: 'Não foi possível selecionar o orçamento.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Orçamento selecionado.' });
}
