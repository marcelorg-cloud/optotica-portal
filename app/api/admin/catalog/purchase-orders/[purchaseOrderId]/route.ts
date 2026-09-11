import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';

const STATUSES = ['aguardando_compra', 'comprado', 'a_caminho', 'entregue', 'cancelado'] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ purchaseOrderId: string }> }
) {
  const { purchaseOrderId } = await params;
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const status = STATUSES.includes(body?.status) ? body.status : null;
  if (!status) return NextResponse.json({ message: 'Status inválido.' }, { status: 400 });

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, updated_at: now };

  // 'comprado' é o único status em que o master registra o que comprou de
  // verdade (número do pedido no AliExpress, valor pago) — os demais são só
  // acompanhamento de rastreio.
  if (status === 'comprado') {
    const aliexpressOrderNumber = typeof body?.aliexpressOrderNumber === 'string' ? body.aliexpressOrderNumber.trim().slice(0, 80) : '';
    const amountPaid = Number(body?.amountPaid);
    if (!aliexpressOrderNumber || !Number.isFinite(amountPaid) || amountPaid <= 0) {
      return NextResponse.json({ message: 'Informe o número do pedido no AliExpress e o valor pago.' }, { status: 400 });
    }
    patch.aliexpress_order_number = aliexpressOrderNumber;
    patch.amount_paid = amountPaid;
    patch.purchased_at = now;
    patch.purchased_by = auth.userId;
  }
  if (status === 'entregue') patch.delivered_at = now;

  const { error } = await auth.admin.from('catalog_purchase_orders').update(patch).eq('id', purchaseOrderId);
  if (error) return NextResponse.json({ message: 'Não foi possível atualizar o pedido.' }, { status: 500 });

  return NextResponse.json({ message: 'Pedido atualizado.' });
}
