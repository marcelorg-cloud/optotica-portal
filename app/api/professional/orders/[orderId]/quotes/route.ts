import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

const LENS_TYPES = ['Visão simples', 'Multifocal', 'Solar com grau', 'Antirreflexo'];
const LENS_INDEXES = ['1.50', '1.56', '1.60', '1.67', '1.74'];
const LENS_MATERIALS = ['Resina', 'Policarbonato', 'Trivex', 'Outro'];
const LENS_TREATMENTS = ['Antirreflexo', 'Verniz', 'Filtro azul', 'Fotossensível'];

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const lensType = typeof body?.lensType === 'string' && LENS_TYPES.includes(body.lensType) ? body.lensType : '';
  const lensIndex = typeof body?.lensIndex === 'string' && LENS_INDEXES.includes(body.lensIndex) ? body.lensIndex : '';
  const lensMaterial = typeof body?.lensMaterial === 'string' && LENS_MATERIALS.includes(body.lensMaterial) ? body.lensMaterial : '';
  const lensTreatment = typeof body?.lensTreatment === 'string' && LENS_TREATMENTS.includes(body.lensTreatment) ? body.lensTreatment : '';
  const laboratory = typeof body?.laboratory === 'string' ? body.laboratory.trim().slice(0, 120) : '';
  const notes = typeof body?.notes === 'string' ? body.notes.trim().slice(0, 500) : '';
  const price = Number(body?.price);

  if (!lensType || !lensIndex || !lensMaterial || !lensTreatment || !laboratory) {
    return NextResponse.json({ message: 'Preencha os dados da lente e o laboratório.' }, { status: 400 });
  }
  if (!Number.isFinite(price) || price < 0 || price > 1_000_000) {
    return NextResponse.json({ message: 'Informe um valor de orçamento válido.' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data: order } = await admin
    .from('orders')
    .select('id, organization_id, client_id, selected_quote_id')
    .eq('id', orderId)
    .eq('professional_id', user.id)
    .maybeSingle();
  if (!order) return NextResponse.json({ message: 'Pedido não encontrado.' }, { status: 404 });

  const { count: existingQuotes } = await admin
    .from('quotes')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', orderId);
  const isFirst = !existingQuotes;

  const { data: quote, error: quoteError } = await admin.from('quotes').insert({
    organization_id: order.organization_id,
    client_id: order.client_id,
    order_id: order.id,
    status: 'draft',
    total: price
  }).select('id').single();
  if (quoteError || !quote) {
    console.error('quote_create_failed', { code: quoteError?.code });
    return NextResponse.json({ message: 'Não foi possível salvar o orçamento.' }, { status: 500 });
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
    return NextResponse.json({ message: 'Não foi possível salvar o item do orçamento.' }, { status: 500 });
  }

  if (isFirst) {
    await admin.from('orders').update({ selected_quote_id: quote.id, total: price }).eq('id', orderId);
  }

  return NextResponse.json({ message: 'Orçamento adicionado.', quoteId: quote.id, isFirst });
}
