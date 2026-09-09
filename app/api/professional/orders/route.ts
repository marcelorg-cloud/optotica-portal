import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

type EyeRx = { esferico: number; cilindrico: number; eixo: number; adicao: number };

function parseEye(value: unknown): EyeRx | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const esferico = Number(v.esferico);
  const cilindrico = Number(v.cilindrico);
  const eixo = Number(v.eixo);
  const adicao = Number(v.adicao);
  if ([esferico, cilindrico, eixo, adicao].some((n) => Number.isNaN(n))) return null;
  if (esferico < -30 || esferico > 30) return null;
  if (cilindrico < -30 || cilindrico > 30) return null;
  if (eixo < 0 || eixo > 180) return null;
  if (adicao < 0 || adicao > 6) return null;
  return { esferico, cilindrico, eixo, adicao };
}

const LENS_TYPES = ['Visão simples', 'Multifocal', 'Solar com grau', 'Antirreflexo'];
const LENS_INDEXES = ['1.50', '1.56', '1.60', '1.67', '1.74'];
const LENS_MATERIALS = ['Resina', 'Policarbonato', 'Trivex', 'Outro'];
const LENS_TREATMENTS = ['Antirreflexo', 'Verniz', 'Filtro azul', 'Fotossensível'];

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const clientId = typeof body?.clientId === 'string' ? body.clientId : '';
  const od = parseEye(body?.od);
  const oe = parseEye(body?.oe);
  const lensType = typeof body?.lensType === 'string' && LENS_TYPES.includes(body.lensType) ? body.lensType : '';
  const lensIndex = typeof body?.lensIndex === 'string' && LENS_INDEXES.includes(body.lensIndex) ? body.lensIndex : '';
  const lensMaterial = typeof body?.lensMaterial === 'string' && LENS_MATERIALS.includes(body.lensMaterial) ? body.lensMaterial : '';
  const lensTreatment = typeof body?.lensTreatment === 'string' && LENS_TREATMENTS.includes(body.lensTreatment) ? body.lensTreatment : '';
  const laboratory = typeof body?.laboratory === 'string' ? body.laboratory.trim().slice(0, 120) : '';
  const notes = typeof body?.notes === 'string' ? body.notes.trim().slice(0, 500) : '';
  const price = Number(body?.price);

  if (!clientId || !od || !oe || !lensType || !lensIndex || !lensMaterial || !lensTreatment || !laboratory) {
    return NextResponse.json({ message: 'Preencha a receita completa e os dados da lente.' }, { status: 400 });
  }
  if (!Number.isFinite(price) || price < 0 || price > 1_000_000) {
    return NextResponse.json({ message: 'Informe um valor de orçamento válido.' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data: profile } = await admin
    .from('professional_profiles')
    .select('status')
    .eq('user_id', user.id)
    .eq('status', 'approved')
    .maybeSingle();
  if (!profile) return NextResponse.json({ message: 'Seu cadastro profissional ainda não está aprovado.' }, { status: 403 });

  const { data: assignment } = await admin
    .from('professional_client_assignments')
    .select('client_id, organization_id')
    .eq('professional_user_id', user.id)
    .eq('client_id', clientId)
    .eq('active', true)
    .maybeSingle();
  if (!assignment) return NextResponse.json({ message: 'Este paciente não está vinculado à sua conta.' }, { status: 403 });

  // next_order_number já existe em produção e confere is_org_member(org_id) usando
  // auth.uid() — por isso precisa ser chamada pela sessão do profissional (RLS), não
  // pela chave de admin (que não tem auth.uid()).
  const { data: orderNumber, error: sequenceError } = await supabase.rpc('next_order_number', { org_id: assignment.organization_id });
  if (sequenceError || orderNumber == null) {
    console.error('order_number_generation_failed', { code: sequenceError?.code });
    return NextResponse.json({ message: 'Não foi possível gerar o número do pedido.' }, { status: 500 });
  }

  const { data: order, error: orderError } = await admin.from('orders').insert({
    organization_id: assignment.organization_id,
    client_id: clientId,
    order_number: orderNumber,
    professional_id: user.id,
    status: 'in_progress',
    total: price
  }).select('id, order_number').single();
  if (orderError || !order) {
    console.error('order_create_failed', { code: orderError?.code });
    return NextResponse.json({ message: 'Não foi possível criar o pedido.' }, { status: 500 });
  }

  const { error: prescriptionError } = await admin.from('prescriptions').insert({
    organization_id: assignment.organization_id,
    client_id: clientId,
    order_id: order.id,
    professional_id: user.id,
    prescription_data: { od, oe }
  });
  if (prescriptionError) {
    console.error('prescription_create_failed', { code: prescriptionError.code });
    return NextResponse.json({ message: 'Pedido criado, mas houve um erro ao salvar a receita.' }, { status: 500 });
  }

  const { data: quote, error: quoteError } = await admin.from('quotes').insert({
    organization_id: assignment.organization_id,
    client_id: clientId,
    order_id: order.id,
    status: 'draft',
    total: price
  }).select('id').single();
  if (quoteError || !quote) {
    console.error('quote_create_failed', { code: quoteError?.code });
    return NextResponse.json({ message: 'Pedido criado, mas houve um erro ao salvar o orçamento.' }, { status: 500 });
  }

  const description = `${lensType} · índice ${lensIndex} · ${lensMaterial} · ${lensTreatment}`;
  const { error: itemError } = await admin.from('quote_items').insert({
    quote_id: quote.id,
    item_type: 'lens',
    description,
    quantity: 1,
    unit_price: price,
    metadata: { lensType, lensIndex, lensMaterial, lensTreatment, laboratory, notes }
  });
  if (itemError) {
    console.error('quote_item_create_failed', { code: itemError.code });
    return NextResponse.json({ message: 'Pedido criado, mas houve um erro ao salvar o item do orçamento.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Pedido criado com sucesso.', orderId: order.id, orderNumber: order.order_number });
}
