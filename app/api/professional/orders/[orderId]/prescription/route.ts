import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

import { parsePrescriptionEye as parseEye } from '@/lib/prescription-values';


export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const od = parseEye(body?.od);
  const oe = parseEye(body?.oe);
  const observations = typeof body?.observations === 'string' ? body.observations.trim() : '';
  if (observations.length > 1000) return NextResponse.json({ message: 'As observações devem ter até 1.000 caracteres.' }, { status: 400 });
  if (!od || !oe) return NextResponse.json({ message: 'Preencha a receita completa. O cilíndrico deve ser negativo ou zero e a adição deve ser positiva ou zero.' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { data: order } = await admin
    .from('orders')
    .select('id, organization_id, client_id')
    .eq('id', orderId)
    .eq('professional_id', user.id)
    .maybeSingle();
  if (!order) return NextResponse.json({ message: 'Pedido não encontrado.' }, { status: 404 });

  // Depois que a Comanda final (etapa 4) é confirmada, receita/orçamento/armação
  // ficam bloqueados — evita alterar dados que já foram consolidados e
  // repassados para pagamento/produção.
  const { data: fulfillment } = await admin.from('order_fulfillment').select('comanda_confirmed_at').eq('order_id', orderId).maybeSingle();
  if (fulfillment?.comanda_confirmed_at) {
    return NextResponse.json({ message: 'A Comanda final já foi confirmada — a receita não pode mais ser alterada.' }, { status: 409 });
  }

  const { error } = await admin.from('prescriptions').upsert({
    organization_id: order.organization_id,
    client_id: order.client_id,
    order_id: order.id,
    professional_id: user.id,
    prescription_data: { od, oe },
    clinical_notes: observations
  }, { onConflict: 'order_id' });
  if (error) {
    console.error('prescription_save_failed', { code: error.code });
    return NextResponse.json({ message: 'Não foi possível salvar a receita.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Receita salva.' });
}
