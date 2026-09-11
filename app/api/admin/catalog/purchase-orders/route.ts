import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { requireMaster } from '@/lib/catalog/require-master';

// Fila de Compras (Especificação — Painel de Catálogo, seção 7): o master
// compra manualmente no site do fornecedor, usando nome + CPF do PACIENTE
// como comprador. O endereço de entrega é resolvido aqui, na criação do
// pedido — não é lido de novo depois, porque um pedido já comprado não deve
// mudar de endereço se o laboratório do atendimento for trocado mais tarde
// (ver migração 202609110020, comentário da tabela catalog_purchase_orders).
//
// Resolução de endereço (Plano de integração v2, seção 8):
//   1. Se o pedido tiver um atendimento de origem (orderId) com
//      order_fulfillment.laboratory_id preenchido -> endereço desse
//      laboratório (professional_laboratories).
//   2. Caso contrário -> endereço do master (catalog_master_address).

async function resolveDeliveryAddress(admin: ReturnType<typeof createAdminSupabaseClient>, orderId: string | null) {
  if (orderId) {
    const { data: fulfillment } = await admin
      .from('order_fulfillment')
      .select('laboratory_id')
      .eq('order_id', orderId)
      .maybeSingle();
    if (fulfillment?.laboratory_id) {
      const { data: lab } = await admin
        .from('professional_laboratories')
        .select('id, name, address_line, address_number, district, city, state, postal_code, phone_e164')
        .eq('id', fulfillment.laboratory_id)
        .maybeSingle();
      if (lab) return { source: 'laboratory' as const, laboratoryId: lab.id, address: lab };
    }
  }
  const { data: masterAddress } = await admin.from('catalog_master_address').select('*').eq('id', true).maybeSingle();
  return { source: 'master' as const, laboratoryId: null, address: masterAddress };
}

export async function GET(request: Request) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');

  // Tela "Fila de Compras" (seção 0.28) precisa de nomes, não só IDs — join
  // com clients/catalog_products/catalog_suppliers/professional_laboratories.
  let query = auth.admin
    .from('catalog_purchase_orders')
    .select(
      'id, client_id, order_id, product_id, color_name, supplier_id, laboratory_id, status, aliexpress_order_number, amount_paid, purchased_at, delivered_at, created_at,' +
      ' clients(full_name, cpf), catalog_products(model_name, sku_optotica), catalog_suppliers(name), professional_laboratories(name, city, state)'
    )
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ message: 'Não foi possível carregar a fila de compras.' }, { status: 500 });

  type Row = {
    id: string; client_id: string; order_id: string | null; product_id: string; color_name: string;
    supplier_id: string; laboratory_id: string | null; status: string; aliexpress_order_number: string | null;
    amount_paid: number | null; purchased_at: string | null; delivered_at: string | null; created_at: string;
    clients: { full_name: string; cpf: string | null } | null;
    catalog_products: { model_name: string; sku_optotica: string } | null;
    catalog_suppliers: { name: string } | null;
    professional_laboratories: { name: string; city: string; state: string } | null;
  };

  const purchaseOrders = ((data || []) as unknown as Row[]).map((row) => ({
    id: row.id,
    clientId: row.client_id,
    orderId: row.order_id,
    productId: row.product_id,
    colorName: row.color_name,
    supplierId: row.supplier_id,
    laboratoryId: row.laboratory_id,
    status: row.status,
    aliexpressOrderNumber: row.aliexpress_order_number,
    amountPaid: row.amount_paid,
    purchasedAt: row.purchased_at,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
    clientName: row.clients?.full_name || null,
    clientCpf: row.clients?.cpf || null,
    productName: row.catalog_products?.model_name || null,
    productSku: row.catalog_products?.sku_optotica || null,
    supplierName: row.catalog_suppliers?.name || null,
    laboratoryName: row.professional_laboratories?.name || null,
    laboratoryCity: row.professional_laboratories?.city || null,
    laboratoryState: row.professional_laboratories?.state || null
  }));

  return NextResponse.json({ purchaseOrders });
}

export async function POST(request: Request) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const clientId = typeof body?.clientId === 'string' ? body.clientId : '';
  const productId = typeof body?.productId === 'string' ? body.productId : '';
  const colorName = typeof body?.colorName === 'string' ? body.colorName.trim() : '';
  const supplierId = typeof body?.supplierId === 'string' ? body.supplierId : '';
  const orderId = typeof body?.orderId === 'string' ? body.orderId : null;

  if (!clientId || !productId || !colorName || !supplierId) {
    return NextResponse.json({ message: 'Informe paciente, produto, cor e fornecedor.' }, { status: 400 });
  }

  // A imagem daquela cor precisa estar validada — não dá para comprar uma
  // armação cuja cor ainda está incompleta ou pendente de aprovação.
  const { data: colorImage } = await auth.admin
    .from('catalog_product_color_images')
    .select('status')
    .eq('product_id', productId)
    .eq('color_name', colorName)
    .maybeSingle();
  if (!colorImage || colorImage.status !== 'validada') {
    return NextResponse.json({ message: 'Esta cor ainda não está validada no catálogo — valide-a antes de comprar.' }, { status: 409 });
  }

  const delivery = await resolveDeliveryAddress(auth.admin, orderId);
  if (!delivery.address) {
    return NextResponse.json({ message: 'Nenhum endereço de entrega disponível (nem laboratório vinculado, nem endereço do master cadastrado).' }, { status: 409 });
  }

  const { data, error } = await auth.admin
    .from('catalog_purchase_orders')
    .insert({
      client_id: clientId,
      order_id: orderId,
      product_id: productId,
      color_name: colorName,
      supplier_id: supplierId,
      laboratory_id: delivery.laboratoryId,
      status: 'aguardando_compra'
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ message: 'Não foi possível registrar o pedido de compra.' }, { status: 500 });

  return NextResponse.json({
    message: 'Pedido criado. Compre manualmente no site do fornecedor usando nome e CPF do paciente como comprador.',
    id: data.id,
    deliveryAddress: { source: delivery.source, ...delivery.address }
  });
}
