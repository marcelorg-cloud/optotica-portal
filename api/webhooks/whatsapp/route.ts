import crypto from 'node:crypto';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { firstIncomingButtonReply, firstIncomingMessage, sendWhatsAppText, sendWhatsAppTextAndGetId, validMetaSignature } from '@/lib/meta';
import { publicEnv, serverEnv } from '@/lib/env';
import { toCanonicalWhatsAppE164 } from '@/lib/phone';
import {
  buildWhatsAppButtonFollowUp,
  WHATSAPP_BUTTON_SECTION,
  whatsappButtonNeedsAccessLink,
  type WhatsAppButtonId,
  type WhatsAppStageId
} from '@/lib/order-whatsapp-stage';

type AdminClient = SupabaseClient;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && token === serverEnv.metaVerifyToken() && challenge) return new NextResponse(challenge, { status: 200 });
  return new NextResponse('Forbidden', { status: 403 });
}

async function findAuthUserByPhone(admin: AdminClient, phone: string): Promise<User | null> {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return null;
    const user = data.users.find((candidate) => candidate.phone === phone);
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
  return null;
}

async function ensurePatientUser(admin: AdminClient, clientId: string, phone: string, fullName: string) {
  const { data: account } = await admin.from('client_user_accounts').select('user_id').eq('client_id', clientId).limit(1).maybeSingle();
  if (account?.user_id) {
    const { data } = await admin.auth.admin.getUserById(account.user_id);
    if (data.user) {
      await admin.from('patient_whatsapp_identities').upsert({ whatsapp_e164: phone, user_id: data.user.id, updated_at: new Date().toISOString() }, { onConflict: 'whatsapp_e164' });
      return data.user;
    }
  }

  const { data: identity } = await admin.from('patient_whatsapp_identities').select('user_id').eq('whatsapp_e164', phone).maybeSingle();
  let user: User | null = null;
  if (identity?.user_id) {
    const { data } = await admin.auth.admin.getUserById(identity.user_id);
    user = data.user;
  }
  user ||= await findAuthUserByPhone(admin, phone);
  if (!user) {
    const syntheticEmail = `${phone.replace(/\D/g, '')}@whatsapp.optotica.invalid`;
    const { data, error } = await admin.auth.admin.createUser({
      email: syntheticEmail,
      phone,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { full_name: fullName, requested_role: 'patient', verified_via: 'whatsapp_inbound' }
    });
    if (error) {
      user = await findAuthUserByPhone(admin, phone);
      if (!user) throw error;
    } else {
      user = data.user;
    }
  }

  const { error: accountError } = await admin.from('client_user_accounts').upsert(
    { client_id: clientId, user_id: user.id },
    { onConflict: 'client_id,user_id' }
  );
  if (accountError) throw accountError;
  const { error: identityError } = await admin.from('patient_whatsapp_identities').upsert(
    { whatsapp_e164: phone, user_id: user.id, updated_at: new Date().toISOString() },
    { onConflict: 'whatsapp_e164' }
  );
  if (identityError) throw identityError;
  return user;
}

// A partir daqui: só o fluxo NOVO de mensagens de WhatsApp por estágio do
// atendimento (16/09/2026, ver lib/order-whatsapp-stage.ts e
// app/api/professional/orders/[orderId]/whatsapp-stage/route.ts). Nada
// disto é chamado pelo fluxo de convite "OPTOTICA <código>" acima, que
// continua exatamente como estava.

/**
 * Gera um link de acesso mágico de uso único para a área do paciente.
 * `redirectPath` já vem pronto do chamador (ver POST abaixo) — é ele quem
 * decide, botão a botão, para onde o link deve levar; esta função só sabe
 * gerar o link em si e gravá-lo via o mesmo mecanismo de
 * `generateLink` + `/auth/confirm` usado pelo fluxo de convite acima (só o
 * destino final muda, via a coluna `whatsapp_access_requests.redirect_path`,
 * que o fluxo de convite nunca preenche e cujo redirect por padrão continua
 * "/cliente" quando ausente — ver app/auth/confirm/route.ts).
 *
 * 16/09/2026 — bug real em produção: um teste ao vivo mostrou "Ver
 * prescrição" retornando a mensagem de falha ("Não conseguimos gerar seu
 * link...") sem nenhum rastro no porquê. Cada `return null` agora loga o
 * motivo específico (`whatsapp_access_link_failed`, com uma `reason`
 * diferente por ponto de falha) — não muda o comportamento (o paciente
 * ainda recebe o mesmo texto de fallback), só torna a próxima ocorrência
 * diagnosticável pelos logs do servidor, sem precisar adivinhar.
 */
async function buildClientAreaAccessLink(
  admin: AdminClient,
  organizationId: string,
  clientId: string,
  whatsappE164: string,
  redirectPath: string,
  inboundMessageId: string
): Promise<string | null> {
  const { data: account } = await admin.from('client_user_accounts').select('user_id').eq('client_id', clientId).limit(1).maybeSingle();
  if (!account?.user_id) {
    console.error('whatsapp_access_link_failed', { reason: 'no_client_user_account', clientId });
    return null;
  }
  const { data: userData, error: userLookupError } = await admin.auth.admin.getUserById(account.user_id);
  if (userLookupError || !userData.user?.email) {
    console.error('whatsapp_access_link_failed', { reason: 'no_user_email', clientId, userId: account.user_id, code: userLookupError?.message });
    return null;
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: userData.user.email,
    options: { redirectTo: `${publicEnv.appUrl()}/cliente` }
  });
  if (linkError || !linkData.properties?.hashed_token) {
    console.error('whatsapp_access_link_failed', { reason: 'generate_link_failed', clientId, code: linkError?.message });
    return null;
  }

  const hashedToken = linkData.properties.hashed_token;
  const tokenFingerprint = crypto.createHash('sha256').update(hashedToken).digest('hex');
  const consentVersion = process.env.OPTOTICA_CONSENT_VERSION || '2026-09-01';

  const { error: accessError } = await admin.from('whatsapp_access_requests').upsert({
    organization_id: organizationId,
    client_id: clientId,
    invitation_id: null,
    whatsapp_e164: whatsappE164,
    whatsapp_message_id: inboundMessageId,
    consent_version: consentVersion,
    token_hash: tokenFingerprint,
    status: 'pending',
    consumed_at: null,
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    redirect_path: redirectPath
  }, { onConflict: 'whatsapp_message_id' });
  if (accessError) {
    console.error('whatsapp_access_link_failed', { reason: 'access_request_upsert_failed', clientId, code: accessError.code, message: accessError.message });
    return null;
  }

  return `${publicEnv.appUrl()}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}`;
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!validMetaSignature(rawBody, request.headers.get('x-hub-signature-256'))) return new NextResponse('Invalid signature', { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return new NextResponse('Invalid JSON', { status: 400 });
  }

  // Toque em botão de RESPOSTA rápida (fluxo de mensagens por estágio,
  // 16/09/2026) — tratado e encerrado aqui, ANTES de qualquer lógica do
  // fluxo de convite "OPTOTICA <código>" abaixo, que fica inteiramente
  // intocada (só mensagens de texto puro chegam até `firstIncomingMessage`).
  const buttonReply = firstIncomingButtonReply(payload);
  if (buttonReply) {
    const admin = createAdminSupabaseClient();

    // Contexto: de qual pedido/estágio este toque é resposta. `context.id` é
    // o wamid da mensagem de estágio original, que a rota de envio sempre
    // registra em order_whatsapp_messages (direction='outbound') antes de
    // devolver sucesso ao profissional — "considerar o que está
    // efetivamente salvo no atendimento", nenhum estado novo em memória.
    const { data: origin } = await admin
      .from('order_whatsapp_messages')
      .select('order_id, client_id, organization_id, stage')
      .eq('whatsapp_message_id', buttonReply.contextMessageId)
      .eq('direction', 'outbound')
      .maybeSingle();
    if (!origin) return NextResponse.json({ received: true });

    const stage = origin.stage as WhatsAppStageId;
    const buttonId = buttonReply.buttonId as WhatsAppButtonId;

    // Idempotência: reentrega do mesmo evento pela Meta não deve gerar uma
    // segunda resposta automática. unique(whatsapp_message_id) faz o INSERT
    // falhar na segunda tentativa — tratado como "já processado".
    const { error: logInboundError } = await admin.from('order_whatsapp_messages').insert({
      organization_id: origin.organization_id,
      order_id: origin.order_id,
      client_id: origin.client_id,
      stage,
      direction: 'inbound',
      whatsapp_message_id: buttonReply.messageId,
      button_id: buttonId,
      body: buttonReply.buttonTitle
    });
    if (logInboundError) return NextResponse.json({ received: true });

    // "Não oferecer condições fictícias a pacientes reais": revalidado aqui
    // (não só no momento em que o botão "Ganhar cupom" foi mostrado) — se o
    // paciente deixou de ser de teste entre o envio e o toque, a resposta
    // de cupom não sai (ver buildWhatsAppButtonFollowUp).
    const { data: client } = await admin.from('clients').select('is_test_patient, whatsapp_e164').eq('id', origin.client_id).maybeSingle();
    const isTestPatient = Boolean(client?.is_test_patient);

    let accessLink: string | null = null;
    if (whatsappButtonNeedsAccessLink(buttonId)) {
      // "Ver prescrição" pedido explícito do usuário (16/09/2026): o link
      // precisa levar direto ao documento emitido — a página que mostra a
      // prescrição já formatada e oferece o PDF/impressão
      // (app/prescricao/[id]/page.tsx, alimentada por `issued_prescriptions`
      // — a emissão formal feita pelo profissional em "Emitir prescrição",
      // não o rascunho simples salvo em `prescriptions`). Isso é DIFERENTE
      // da seção "Minha receita" antiga (`#receita`, `prescriptions`), que
      // só existe (e continua servindo de fallback abaixo) para quando o
      // profissional ainda não emitiu formalmente nenhuma prescrição para
      // este atendimento — nesse caso o paciente ainda recebe um link
      // funcional, só que para o rascunho, não para o documento emitido.
      let redirectPath = `/cliente/pedido/${origin.order_id}${WHATSAPP_BUTTON_SECTION[buttonId] ? `#${WHATSAPP_BUTTON_SECTION[buttonId]}` : ''}`;
      if (buttonId === 'ver_prescricao') {
        const { data: issuedRx } = await admin
          .from('issued_prescriptions')
          .select('id')
          .eq('order_id', origin.order_id)
          .eq('status', 'active')
          .maybeSingle();
        if (issuedRx) redirectPath = `/prescricao/${issuedRx.id}`;
      }
      // `whatsapp_access_requests.whatsapp_e164` é obrigatória (not null) —
      // bug real encontrado em produção (17/09/2026): esta função, ao ser
      // criada, não preenchia essa coluna (só o fluxo de convite original
      // preenchia), e o upsert falhava silenciosamente (accessError),
      // sempre caindo no texto de fallback. Usa o telefone já salvo no
      // cadastro do cliente — é o mesmo número usado para mandar a
      // mensagem de estágio e o mesmo que originou este toque de botão.
      if (client?.whatsapp_e164) {
        accessLink = await buildClientAreaAccessLink(admin, origin.organization_id, origin.client_id, client.whatsapp_e164, redirectPath, buttonReply.messageId);
      } else {
        console.error('whatsapp_access_link_failed', { reason: 'no_client_whatsapp_e164', clientId: origin.client_id });
      }
    }

    const followUpText = buildWhatsAppButtonFollowUp(buttonId, { accessLink, isTestPatient });
    try {
      const sentId = await sendWhatsAppTextAndGetId(buttonReply.phone, followUpText);
      if (sentId) {
        await admin.from('order_whatsapp_messages').insert({
          organization_id: origin.organization_id,
          order_id: origin.order_id,
          client_id: origin.client_id,
          stage,
          direction: 'outbound',
          whatsapp_message_id: sentId,
          button_id: buttonId,
          body: followUpText
        });
      }
    } catch (error) {
      console.error('whatsapp_button_followup_failed', { code: (error as Error)?.message });
    }
    return NextResponse.json({ received: true });
  }

  const message = firstIncomingMessage(payload);
  if (!message) return NextResponse.json({ received: true });
  const phoneDigits = message.phone;
  const whatsappE164 = toCanonicalWhatsAppE164(phoneDigits);
  const admin = createAdminSupabaseClient();

  const { data: processed } = await admin
    .from('whatsapp_access_requests')
    .select('id, status')
    .eq('whatsapp_message_id', message.messageId)
    .maybeSingle();
  if (processed && processed.status !== 'revoked') return NextResponse.json({ received: true });

  // 17/09/2026 — pedido do usuário: a mensagem pré-preenchida do WhatsApp
  // (app/convite/[token]/page.tsx) passou a vir com uma frase amigável ANTES
  // do código ("Olá! Segue o código para ser atendido: OPTOTICA <token>"),
  // em vez de só "OPTOTICA <token>" sozinho. O regex era ancorado no início E
  // no fim da mensagem (`^...$`) — exigia que a mensagem inteira fosse
  // exatamente "OPTOTICA <token>", sem nada antes nem depois. Sem essa âncora
  // dupla, a frase nova quebraria o reconhecimento do código. Agora o regex
  // só exige que "OPTOTICA <token>" apareça em algum ponto da mensagem —
  // aceita tanto o formato novo (com frase antes) quanto o antigo (mensagem
  // só com o código, que continua funcionando sem nenhuma mudança).
  const tokenMatch = processed?.status === 'revoked' ? null : message.text.match(/OPTOTICA\s+([A-Za-z0-9_-]{32,})/i);
  let invitationId: string | null = null;
  let client: { id: string; organization_id: string; full_name: string } | null = null;

  if (tokenMatch) {
    const tokenHash = crypto.createHash('sha256').update(tokenMatch[1]).digest('hex');
    const { data: invitation } = await admin
      .from('patient_access_invitations')
      .select('id, organization_id, professional_user_id, patient_name, expected_whatsapp_e164, status, expires_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    const valid = invitation
      && invitation.status === 'pending'
      && new Date(invitation.expires_at).getTime() > Date.now()
      && toCanonicalWhatsAppE164(invitation.expected_whatsapp_e164) === whatsappE164;
    if (!valid || !invitation) {
      await sendWhatsAppText(phoneDigits, 'Este convite é inválido, expirou ou pertence a outro número. Solicite um novo convite ao profissional.');
      return NextResponse.json({ received: true });
    }
    const { data: professional } = await admin.from('professional_profiles').select('id').eq('user_id', invitation.professional_user_id).eq('status', 'approved').maybeSingle();
    if (!professional) {
      await sendWhatsAppText(phoneDigits, 'O acesso deste profissional não está disponível. Fale com a equipe Optótica.');
      return NextResponse.json({ received: true });
    }

    const { data: claimed } = await admin.from('patient_access_invitations').update({
      status: 'accepted',
      accepted_whatsapp_e164: whatsappE164,
      opt_in_message_id: message.messageId,
      accepted_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', invitation.id).eq('status', 'pending').select('id').maybeSingle();
    if (!claimed) return NextResponse.json({ received: true });
    invitationId = invitation.id;

    const { data: existingClient } = await admin
      .from('clients')
      .select('id, organization_id, full_name')
      .eq('organization_id', invitation.organization_id)
      .eq('whatsapp_e164', whatsappE164)
      .limit(1)
      .maybeSingle();
    client = existingClient;
    if (!client) {
      const { data: createdClient, error } = await admin.from('clients').insert({
        organization_id: invitation.organization_id,
        whatsapp_e164: whatsappE164,
        full_name: invitation.patient_name || 'Paciente',
        email: null,
        status: 'active',
        created_by: invitation.professional_user_id
      }).select('id, organization_id, full_name').single();
      if (error || !createdClient) throw error || new Error('client_not_created');
      client = createdClient;
    }

    const { error: assignmentError } = await admin.from('professional_client_assignments').upsert({
      organization_id: invitation.organization_id,
      client_id: client.id,
      professional_user_id: invitation.professional_user_id,
      invitation_id: invitation.id,
      assigned_by: invitation.professional_user_id,
      active: true,
      updated_at: new Date().toISOString()
    }, { onConflict: 'client_id,professional_user_id' });
    if (assignmentError) throw assignmentError;
    await admin.from('patient_access_invitations').update({ client_id: client.id }).eq('id', invitation.id);
  } else {
    const { data: existingClient } = await admin
      .from('clients')
      .select('id, organization_id, full_name')
      .eq('whatsapp_e164', whatsappE164)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    if (existingClient) {
      const { data: assignment } = await admin.from('professional_client_assignments').select('client_id, invitation_id').eq('client_id', existingClient.id).eq('active', true).not('invitation_id', 'is', null).limit(1).maybeSingle();
      const { data: acceptedInvitation } = assignment?.invitation_id
        ? await admin.from('patient_access_invitations').select('id').eq('id', assignment.invitation_id).eq('client_id', existingClient.id).eq('status', 'accepted').maybeSingle()
        : { data: null };
      if (acceptedInvitation) client = existingClient;
    }
    if (!client) {
      await sendWhatsAppText(phoneDigits, 'Não encontramos um vínculo ativo para este número. Solicite um convite de 24 horas ao profissional responsável.');
      return NextResponse.json({ received: true });
    }
  }

  const authUser = await ensurePatientUser(admin, client.id, whatsappE164, client.full_name);
  if (invitationId) await admin.from('patient_access_invitations').update({ accepted_by: authUser.id }).eq('id', invitationId);
  if (!authUser.email) throw new Error('patient_auth_email_missing');
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: authUser.email,
    options: { redirectTo: `${publicEnv.appUrl()}/cliente` }
  });
  if (linkError || !linkData.properties?.hashed_token) throw linkError || new Error('magic_link_not_created');

  const hashedToken = linkData.properties.hashed_token;
  const tokenFingerprint = crypto.createHash('sha256').update(hashedToken).digest('hex');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const consentVersion = process.env.OPTOTICA_CONSENT_VERSION || '2026-09-01';
  const accessLink = `${publicEnv.appUrl()}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}&next=/cliente`;

  const { error: accessError } = await admin.from('whatsapp_access_requests').upsert({
    organization_id: client.organization_id,
    client_id: client.id,
    invitation_id: invitationId,
    whatsapp_e164: whatsappE164,
    whatsapp_message_id: message.messageId,
    consent_version: consentVersion,
    token_hash: tokenFingerprint,
    status: 'pending',
    consumed_at: null,
    expires_at: expiresAt
  }, { onConflict: 'whatsapp_message_id' });
  if (accessError) throw accessError;

  const { error: consentError } = await admin.from('client_consents').insert([
    { organization_id: client.organization_id, client_id: client.id, whatsapp_e164: whatsappE164, consent_type: 'authentication', granted: true, source: 'whatsapp_inbound', policy_version: consentVersion, evidence: { whatsapp_message_id: message.messageId, invitation_id: invitationId } },
    { organization_id: client.organization_id, client_id: client.id, whatsapp_e164: whatsappE164, consent_type: 'transactional_messages', granted: true, source: 'whatsapp_inbound', policy_version: consentVersion, evidence: { whatsapp_message_id: message.messageId, invitation_id: invitationId } }
  ]);
  if (consentError) throw consentError;

  try {
    await sendWhatsAppText(phoneDigits, `Seu acesso seguro ao Portal Optótica:\n${accessLink}\n\nO link é pessoal, expira em 15 minutos e funciona uma única vez.`);
  } catch (error) {
    await admin.from('whatsapp_access_requests').update({ status: 'revoked' }).eq('whatsapp_message_id', message.messageId);
    throw error;
  }
  return NextResponse.json({ received: true });
}
