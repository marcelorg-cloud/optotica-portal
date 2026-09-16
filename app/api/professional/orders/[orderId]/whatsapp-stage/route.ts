import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { sendWhatsAppButtons } from '@/lib/meta';
import {
  buildWhatsAppStagePreview,
  computeWhatsAppStage,
  WHATSAPP_STAGE_LABEL,
  type WhatsAppStageId
} from '@/lib/order-whatsapp-stage';

// Fluxo de mensagens de WhatsApp por estágio do atendimento (16/09/2026).
// Rota nova e isolada — não reaproveita nem altera nada do webhook de
// convite já existente (app/api/webhooks/whatsapp/route.ts). Só cobre o
// lado "profissional pede prévia / confirma envio" descrito na especificação
// do usuário; a resposta automática ao toque em botão do paciente vive no
// webhook (é lá que a mensagem chega).

type FreshStageData = {
  order: { id: string; organization_id: string; status: string; client_id: string; selected_quote_id: string | null };
  client: { id: string; full_name: string; whatsapp_e164: string | null; is_test_patient: boolean };
  stage: WhatsAppStageId | null;
  blockedReason: string | null;
};

async function loadFreshStage(admin: ReturnType<typeof createAdminSupabaseClient>, orderId: string, professionalUserId: string): Promise<FreshStageData | null> {
  const { data: order } = await admin
    .from('orders')
    .select('id, organization_id, status, client_id, selected_quote_id')
    .eq('id', orderId)
    .eq('professional_id', professionalUserId)
    .maybeSingle();
  if (!order) return null;

  const [{ data: client }, { data: prescription }, { data: orderFrame }, { data: fulfillment }] = await Promise.all([
    admin.from('clients').select('id, full_name, whatsapp_e164, is_test_patient').eq('id', order.client_id).maybeSingle(),
    admin.from('prescriptions').select('id').eq('order_id', orderId).maybeSingle(),
    admin.from('order_frames').select('order_id').eq('order_id', orderId).maybeSingle(),
    admin.from('order_fulfillment').select('comanda_confirmed_at, payment_confirmed_at').eq('order_id', orderId).maybeSingle()
  ]);
  if (!client) return null;

  // Pedido cancelado: nenhuma das quatro mensagens (todas voltadas a levar o
  // paciente a comprar/pagar/acompanhar) faz sentido — envio desabilitado.
  if (order.status === 'cancelled') {
    return { order, client, stage: null, blockedReason: 'Este pedido foi cancelado — o envio de mensagens de estágio está desabilitado.' };
  }

  const stage = computeWhatsAppStage({
    prescriptionDone: Boolean(prescription),
    quoteOrFrameChosen: Boolean(order.selected_quote_id) || Boolean(orderFrame),
    comandaDone: Boolean(fulfillment?.comanda_confirmed_at),
    paymentDone: Boolean(fulfillment?.payment_confirmed_at)
  });

  const blockedReason = stage === null ? 'Ainda não há prescrição salva para este atendimento — nenhuma mensagem se aplica.' : null;
  return { order, client, stage, blockedReason };
}

export async function GET(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const fresh = await loadFreshStage(admin, orderId, user.id);
  if (!fresh) return NextResponse.json({ message: 'Pedido não encontrado.' }, { status: 404 });

  if (!fresh.client.whatsapp_e164) {
    return NextResponse.json({
      stage: null,
      isTestPatient: fresh.client.is_test_patient,
      clientName: fresh.client.full_name,
      blockedReason: 'Este paciente não tem um número de WhatsApp vinculado.'
    });
  }

  if (!fresh.stage) {
    return NextResponse.json({
      stage: null,
      isTestPatient: fresh.client.is_test_patient,
      clientName: fresh.client.full_name,
      blockedReason: fresh.blockedReason
    });
  }

  const preview = buildWhatsAppStagePreview(fresh.stage, { clientName: fresh.client.full_name, isTestPatient: fresh.client.is_test_patient });
  return NextResponse.json({
    stage: fresh.stage,
    stageLabel: WHATSAPP_STAGE_LABEL[fresh.stage],
    body: preview.body,
    buttons: preview.buttons,
    isTestPatient: fresh.client.is_test_patient,
    clientName: fresh.client.full_name,
    blockedReason: null
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const requestedStage = typeof body?.stage === 'string' ? (body.stage as WhatsAppStageId) : '';
  if (!requestedStage) return NextResponse.json({ message: 'Informe o estágio da prévia que deseja confirmar.' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  // Consulta o pedido de novo, imediatamente antes de enviar — regra
  // explícita da especificação. Se o estágio mudou desde a prévia (por
  // exemplo, o pagamento acabou de ser confirmado por outra aba), a
  // mensagem de cobrança não sai: pedimos para o profissional atualizar a
  // prévia e decidir de novo.
  const fresh = await loadFreshStage(admin, orderId, user.id);
  if (!fresh) return NextResponse.json({ message: 'Pedido não encontrado.' }, { status: 404 });
  if (!fresh.client.whatsapp_e164) return NextResponse.json({ message: 'Este paciente não tem um número de WhatsApp vinculado.' }, { status: 409 });
  if (!fresh.stage) return NextResponse.json({ message: fresh.blockedReason || 'Nenhuma mensagem se aplica a este atendimento agora.' }, { status: 409 });
  if (fresh.stage !== requestedStage) {
    return NextResponse.json({
      message: 'O estágio do atendimento mudou desde a prévia. Atualize a prévia e confirme de novo.',
      stage: fresh.stage,
      stageLabel: WHATSAPP_STAGE_LABEL[fresh.stage]
    }, { status: 409 });
  }

  const preview = buildWhatsAppStagePreview(fresh.stage, { clientName: fresh.client.full_name, isTestPatient: fresh.client.is_test_patient });
  const toDigits = fresh.client.whatsapp_e164.replace(/\D/g, '');

  let sentMessageId: string;
  try {
    sentMessageId = await sendWhatsAppButtons(toDigits, preview.body, preview.buttons);
  } catch (error) {
    console.error('whatsapp_stage_send_failed', { code: (error as Error)?.message });
    return NextResponse.json({ message: 'Não foi possível enviar a mensagem pelo WhatsApp agora.' }, { status: 502 });
  }

  const { error: logError } = await admin.from('order_whatsapp_messages').insert({
    organization_id: fresh.order.organization_id,
    order_id: fresh.order.id,
    client_id: fresh.client.id,
    stage: fresh.stage,
    direction: 'outbound',
    whatsapp_message_id: sentMessageId,
    button_id: null,
    body: preview.body,
    sent_by: user.id
  });
  if (logError) console.error('whatsapp_stage_log_failed', { code: logError.code });

  return NextResponse.json({ message: 'Mensagem enviada.' });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Faça login como profissional.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (typeof body?.isTestPatient !== 'boolean') return NextResponse.json({ message: 'Valor inválido.' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { data: order } = await admin.from('orders').select('client_id').eq('id', orderId).eq('professional_id', user.id).maybeSingle();
  if (!order) return NextResponse.json({ message: 'Pedido não encontrado.' }, { status: 404 });

  const { error } = await admin.from('clients').update({ is_test_patient: body.isTestPatient }).eq('id', order.client_id);
  if (error) {
    console.error('whatsapp_set_test_patient_failed', { code: error.code });
    return NextResponse.json({ message: 'Não foi possível salvar.' }, { status: 500 });
  }
  return NextResponse.json({ message: 'Salvo.', isTestPatient: body.isTestPatient });
}
