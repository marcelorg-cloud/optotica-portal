import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

// Carrinho (16/09/2026) — permite remover, a partir da nova tela "Carrinho",
// um orçamento que o profissional/paciente não quer mais considerar, sem
// precisar recriar os que sobraram do zero. `orders.selected_quote_id`
// referencia `quotes(id) on delete set null` (migração 202609090011) — ou
// seja, o próprio banco já zera esse campo sozinho se o orçamento removido
// era o selecionado; aqui só escolhemos automaticamente outro orçamento
// remanescente (se houver) pra não deixar o pedido sem nenhum orçamento
// selecionado à toa, e recalculamos `orders.total` junto.
export async function DELETE(_request: Request, { params }: { params: Promise<{ orderId: string; quoteId: string }> }) {
  const { orderId, quoteId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const { data: order } = await admin
    .from('orders')
    .select('id, selected_quote_id')
    .eq('id', orderId)
    .eq('professional_id', user.id)
    .maybeSingle();
  if (!order) return NextResponse.json({ message: 'Pedido não encontrado.' }, { status: 404 });

  // Depois que a Comanda final (etapa 4) é confirmada, orçamento/receita/armação
  // ficam bloqueados — mesma trava já usada em quotes/route.ts e select-quote/route.ts.
  const { data: fulfillment } = await admin.from('order_fulfillment').select('comanda_confirmed_at').eq('order_id', orderId).maybeSingle();
  if (fulfillment?.comanda_confirmed_at) {
    return NextResponse.json({ message: 'A Comanda final já foi confirmada — não é possível remover orçamentos.' }, { status: 409 });
  }

  const { data: quote } = await admin.from('quotes').select('id').eq('id', quoteId).eq('order_id', orderId).maybeSingle();
  if (!quote) return NextResponse.json({ message: 'Orçamento não encontrado neste pedido.' }, { status: 404 });

  const wasSelected = order.selected_quote_id === quoteId;

  const { error: itemsError } = await admin.from('quote_items').delete().eq('quote_id', quoteId);
  if (itemsError) {
    console.error('quote_items_delete_failed', { code: itemsError.code });
    return NextResponse.json({ message: 'Não foi possível remover os itens deste orçamento.' }, { status: 500 });
  }

  const { error: quoteError } = await admin.from('quotes').delete().eq('id', quoteId);
  if (quoteError) {
    console.error('quote_delete_failed', { code: quoteError.code });
    return NextResponse.json({ message: 'Não foi possível remover o orçamento.' }, { status: 500 });
  }

  if (wasSelected) {
    const { data: remaining } = await admin
      .from('quotes')
      .select('id, total')
      .eq('order_id', orderId)
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (remaining) {
      await admin.from('orders').update({ selected_quote_id: remaining.id, total: remaining.total }).eq('id', orderId);
    } else {
      await admin.from('orders').update({ total: 0 }).eq('id', orderId);
    }
  }

  return NextResponse.json({ message: 'Orçamento removido.' });
}
