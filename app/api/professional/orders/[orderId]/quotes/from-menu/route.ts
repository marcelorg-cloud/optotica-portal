import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

// Cria um orçamento (quotes + quote_items) a partir de um nível já
// configurado no cardápio de lentes da ótica (lens_menu_tiers), em vez do
// profissional digitar tipo/índice/material/tratamento/laboratório/valor
// manualmente a cada vez — mesma mecânica da rota
// /api/professional/orders/[orderId]/quotes (POST), só que a composição e o
// preço vêm do nível do cardápio.
const VALID_LENS_TYPES = new Set(['single_vision', 'multifocal']);

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const lensType = typeof body?.lensType === 'string' ? body.lensType : '';
  const tierNumber = Number(body?.tierNumber);
  if (!VALID_LENS_TYPES.has(lensType)) {
    return NextResponse.json({ message: 'Categoria de lente inválida.' }, { status: 400 });
  }
  if (!Number.isInteger(tierNumber) || tierNumber < 1 || tierNumber > 4) {
    return NextResponse.json({ message: 'Nível do cardápio inválido.' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data: order } = await admin
    .from('orders')
    .select('id, organization_id, client_id, selected_quote_id')
    .eq('id', orderId)
    .eq('professional_id', user.id)
    .maybeSingle();
  if (!order) return NextResponse.json({ message: 'Pedido não encontrado.' }, { status: 404 });

  const { data: fulfillment } = await admin.from('order_fulfillment').select('comanda_confirmed_at').eq('order_id', orderId).maybeSingle();
  if (fulfillment?.comanda_confirmed_at) {
    return NextResponse.json({ message: 'A Comanda final já foi confirmada — não é possível adicionar novos orçamentos.' }, { status: 409 });
  }

  const { data: tier } = await admin
    .from('lens_menu_tiers')
    .select('tier_name, benefit_phrase, manufacturer, product_line, lens_index, ar_treatment, price, active')
    .eq('organization_id', order.organization_id)
    .eq('lens_type', lensType)
    .eq('tier_number', tierNumber)
    .maybeSingle();
  if (!tier || !tier.active) {
    return NextResponse.json({ message: 'Este nível do cardápio não está configurado ou está desativado.' }, { status: 404 });
  }

  const categoryLabel = lensType === 'multifocal' ? 'Multifocal' : 'Visão simples';
  const parts = [categoryLabel, tier.tier_name, tier.product_line, tier.lens_index, tier.ar_treatment].filter(Boolean);
  const description = parts.length ? parts.join(' · ') : `Cardápio — nível ${tierNumber}`;
  const laboratory = tier.manufacturer || 'A definir';

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
    total: tier.price
  }).select('id').single();
  if (quoteError || !quote) {
    console.error('quote_from_menu_create_failed', { code: quoteError?.code });
    return NextResponse.json({ message: 'Não foi possível salvar o orçamento.' }, { status: 500 });
  }

  const { error: itemError } = await admin.from('quote_items').insert({
    quote_id: quote.id,
    item_type: 'lens',
    description,
    quantity: 1,
    unit_price: tier.price,
    metadata: {
      source: 'lens_menu_tier',
      lensType,
      tierNumber,
      manufacturer: tier.manufacturer,
      productLine: tier.product_line,
      lensIndex: tier.lens_index,
      arTreatment: tier.ar_treatment,
      laboratory,
      notes: tier.benefit_phrase || ''
    }
  });
  if (itemError) {
    console.error('quote_item_from_menu_create_failed', { code: itemError.code });
    return NextResponse.json({ message: 'Não foi possível salvar o item do orçamento.' }, { status: 500 });
  }

  if (isFirst) {
    await admin.from('orders').update({ selected_quote_id: quote.id, total: tier.price }).eq('id', orderId);
  }

  return NextResponse.json({ message: 'Orçamento adicionado a partir do cardápio.', quoteId: quote.id, isFirst });
}
