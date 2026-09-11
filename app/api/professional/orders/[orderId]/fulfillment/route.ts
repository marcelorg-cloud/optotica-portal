import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

const FRAME_PRODUCTION_STATUSES = ['aguardando_pedido', 'pedido_realizado', 'confirmado_fornecedor', 'indisponivel'];
const LENS_PRODUCTION_STATUSES = ['aguardando_envio', 'enviado_laboratorio', 'confirmado_laboratorio', 'em_producao', 'pronta'];
const ASSEMBLY_STATUSES = ['aguardando', 'em_montagem', 'em_conferencia', 'concluida'];
const PAYMENT_METHODS = ['dinheiro', 'pix', 'link', 'maquina'];
const DELIVERY_DESTINATIONS = ['loja', 'optometrista', 'cliente_final'];
const LOGISTICS_MILESTONES: Record<string, string> = {
  frame_shipped: 'frame_shipped_at',
  frame_received: 'frame_received_at',
  lens_confirmed: 'lens_confirmed_at',
  lens_ready: 'lens_ready_at'
};

function numberOrNull(value: unknown, min: number, max: number) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return n;
}

function textOrNull(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const section = typeof body?.section === 'string' ? body.section : '';
  const data = (body?.data && typeof body.data === 'object') ? body.data as Record<string, unknown> : {};

  const admin = createAdminSupabaseClient();
  const { data: order } = await admin.from('orders').select('id, organization_id').eq('id', orderId).eq('professional_id', user.id).maybeSingle();
  if (!order) return NextResponse.json({ message: 'Pedido não encontrado.' }, { status: 404 });

  const patch: Record<string, unknown> = { order_id: order.id, organization_id: order.organization_id };

  if (section === 'comanda') {
    // Uma vez confirmada, a Comanda final (etapa 4) fica bloqueada — junto com
    // as etapas 1 a 3 (Paciente/DNP, OS/Orçamento e Armação) — para não sobrescrever
    // dados que já seguiram para pagamento/produção.
    const { data: existingFulfillment } = await admin.from('order_fulfillment').select('comanda_confirmed_at').eq('order_id', orderId).maybeSingle();
    if (existingFulfillment?.comanda_confirmed_at) {
      return NextResponse.json({ message: 'A Comanda final já foi confirmada e não pode mais ser alterada.' }, { status: 409 });
    }
    const heightOd = numberOrNull(data.measureHeightOd, 0, 60);
    const heightOe = numberOrNull(data.measureHeightOe, 0, 60);
    const bridge = numberOrNull(data.measureBridge, 0, 60);
    const diagonal = numberOrNull(data.measureDiagonal, 0, 80);
    if ([heightOd, heightOe, bridge, diagonal].some((v) => v === undefined)) {
      return NextResponse.json({ message: 'Medidas inválidas.' }, { status: 400 });
    }
    patch.measure_height_od = heightOd;
    patch.measure_height_oe = heightOe;
    patch.measure_bridge = bridge;
    patch.measure_diagonal = diagonal;
    patch.final_lab_notes = textOrNull(data.finalLabNotes, 500);
    if (data.confirm) patch.comanda_confirmed_at = new Date().toISOString();
  } else if (section === 'pagamento') {
    const method = typeof data.paymentMethod === 'string' && PAYMENT_METHODS.includes(data.paymentMethod) ? data.paymentMethod : '';
    const value = numberOrNull(data.paymentValue, 0, 1_000_000);
    const downValue = numberOrNull(data.paymentDownValue, 0, 1_000_000);
    const pickupValue = numberOrNull(data.paymentPickupValue, 0, 1_000_000);
    if (!method || value === undefined) return NextResponse.json({ message: 'Informe valor e forma de pagamento válidos.' }, { status: 400 });
    if (downValue === undefined || pickupValue === undefined) {
      return NextResponse.json({ message: 'Valor de entrada ou de retirada inválido.' }, { status: 400 });
    }
    patch.payment_method = method;
    patch.payment_value = value;
    patch.payment_down_value = downValue;
    patch.payment_pickup_value = pickupValue;
    if (data.confirm) patch.payment_confirmed_at = new Date().toISOString();
  } else if (section === 'producao') {
    const frameStatus = typeof data.frameProductionStatus === 'string' && FRAME_PRODUCTION_STATUSES.includes(data.frameProductionStatus) ? data.frameProductionStatus : '';
    const lensStatus = typeof data.lensProductionStatus === 'string' && LENS_PRODUCTION_STATUSES.includes(data.lensProductionStatus) ? data.lensProductionStatus : '';
    if (!frameStatus || !lensStatus) return NextResponse.json({ message: 'Status de produção inválido.' }, { status: 400 });
    patch.frame_production_status = frameStatus;
    patch.frame_supplier_reference = textOrNull(data.frameSupplierReference, 120);
    patch.lens_production_status = lensStatus;
    patch.lens_lab_reference = textOrNull(data.lensLabReference, 120);
    // laboratoryId (migração 202609110019): qual laboratório parceiro já
    // cadastrado (professional_laboratories) está produzindo a lente deste
    // atendimento — vazio/null = ainda não definido. Sempre validado contra
    // os laboratórios da MESMA organização, nunca aceito de outra (evita um
    // profissional vincular um laboratório de outra ótica pelo id).
    if (data.laboratoryId === null || data.laboratoryId === '' || data.laboratoryId === undefined) {
      patch.laboratory_id = null;
    } else if (typeof data.laboratoryId === 'string') {
      const { data: lab } = await admin
        .from('professional_laboratories')
        .select('id')
        .eq('id', data.laboratoryId)
        .eq('organization_id', order.organization_id)
        .maybeSingle();
      if (!lab) return NextResponse.json({ message: 'Laboratório inválido para esta ótica.' }, { status: 400 });
      patch.laboratory_id = lab.id;
    } else {
      return NextResponse.json({ message: 'Laboratório inválido.' }, { status: 400 });
    }
  } else if (section === 'logistica') {
    const milestone = typeof data.milestone === 'string' ? LOGISTICS_MILESTONES[data.milestone] : '';
    if (!milestone) return NextResponse.json({ message: 'Marco de logística inválido.' }, { status: 400 });
    patch[milestone] = new Date().toISOString();
  } else if (section === 'montagem') {
    const status = typeof data.assemblyStatus === 'string' && ASSEMBLY_STATUSES.includes(data.assemblyStatus) ? data.assemblyStatus : '';
    if (!status) return NextResponse.json({ message: 'Status de montagem inválido.' }, { status: 400 });
    patch.frame_received_check = Boolean(data.frameReceivedCheck);
    patch.lens_received_check = Boolean(data.lensReceivedCheck);
    patch.assembly_status = status;
    patch.assembly_notes = textOrNull(data.assemblyNotes, 500);
  } else if (section === 'entrega') {
    const destination = typeof data.deliveryDestination === 'string' && DELIVERY_DESTINATIONS.includes(data.deliveryDestination) ? data.deliveryDestination : '';
    if (!destination) return NextResponse.json({ message: 'Escolha o destino da entrega.' }, { status: 400 });
    patch.delivery_destination = destination;
    patch.delivery_date = typeof data.deliveryDate === 'string' && data.deliveryDate ? data.deliveryDate : null;
    patch.delivery_received_by = textOrNull(data.deliveryReceivedBy, 120);
    patch.delivery_notes = textOrNull(data.deliveryNotes, 500);
    if (data.confirm) patch.delivered_at = new Date().toISOString();
  } else {
    return NextResponse.json({ message: 'Etapa inválida.' }, { status: 400 });
  }

  patch.updated_at = new Date().toISOString();

  const { error } = await admin.from('order_fulfillment').upsert(patch, { onConflict: 'order_id' });
  if (error) {
    console.error('order_fulfillment_save_failed', { code: error.code, section });
    return NextResponse.json({ message: 'Não foi possível salvar esta etapa.' }, { status: 500 });
  }

  if (section === 'entrega' && data.confirm) {
    // 'completed' não é um valor aceito por orders_status_check (só 'delivered' é) — com o
    // valor errado, essa atualização falhava silenciosamente (o erro não era checado) e o
    // pedido nunca saía de 'in_progress' mesmo depois de entregue, bloqueando pra sempre um
    // novo atendimento desse paciente (a tela sempre reabria esse pedido como "em andamento").
    const { error: deliveryStatusError } = await admin.from('orders').update({ status: 'delivered' }).eq('id', orderId);
    if (deliveryStatusError) {
      console.error('order_delivered_status_update_failed', { code: deliveryStatusError.code });
    }
  }

  return NextResponse.json({ message: 'Etapa salva.' });
}
