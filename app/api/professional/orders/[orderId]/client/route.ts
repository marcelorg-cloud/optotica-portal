import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

function numberOrNull(value: unknown, min: number, max: number) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return n;
}

// Só a DNP é editável por aqui (etapa 1 do atendimento). Nome e WhatsApp do
// paciente não entram nesta rota: são a identidade do paciente no sistema
// (conta de acesso à área do paciente e roteamento de mensagens do WhatsApp),
// então continuam só leitura nesta tela — mudá-los aqui poderia gerar
// conflito com outro paciente ou desalinhar o contato usado para login.
export async function PATCH(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const dnpOd = numberOrNull(body?.dnpOd, 10, 45);
  const dnpOe = numberOrNull(body?.dnpOe, 10, 45);
  if (dnpOd === undefined || dnpOe === undefined) {
    return NextResponse.json({ message: 'DNP inválida.' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data: order } = await admin.from('orders').select('id, client_id').eq('id', orderId).eq('professional_id', user.id).maybeSingle();
  if (!order) return NextResponse.json({ message: 'Pedido não encontrado.' }, { status: 404 });

  // Depois que a Comanda final (etapa 4) é confirmada, a DNP (etapa 1) fica
  // bloqueada junto com receita/orçamento/armação.
  const { data: fulfillment } = await admin.from('order_fulfillment').select('comanda_confirmed_at').eq('order_id', orderId).maybeSingle();
  if (fulfillment?.comanda_confirmed_at) {
    return NextResponse.json({ message: 'A Comanda final já foi confirmada — a DNP não pode mais ser alterada.' }, { status: 409 });
  }

  const { error } = await admin.from('clients').update({ dnp_od: dnpOd, dnp_oe: dnpOe }).eq('id', order.client_id);
  if (error) {
    console.error('client_dnp_update_failed', { code: error.code });
    return NextResponse.json({ message: 'Não foi possível salvar a DNP.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'DNP atualizada.' });
}
