import crypto from 'node:crypto';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { firstIncomingMessage, sendWhatsAppText, validMetaSignature } from '@/lib/meta';
import { publicEnv, serverEnv } from '@/lib/env';

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

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!validMetaSignature(rawBody, request.headers.get('x-hub-signature-256'))) return new NextResponse('Invalid signature', { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return new NextResponse('Invalid JSON', { status: 400 });
  }
  const message = firstIncomingMessage(payload);
  if (!message) return NextResponse.json({ received: true });
  const phoneDigits = message.phone;
  const whatsappE164 = `+${phoneDigits}`;
  const admin = createAdminSupabaseClient();

  const { data: processed } = await admin
    .from('whatsapp_access_requests')
    .select('id, status')
    .eq('whatsapp_message_id', message.messageId)
    .maybeSingle();
  if (processed && processed.status !== 'revoked') return NextResponse.json({ received: true });

  const tokenMatch = processed?.status === 'revoked' ? null : message.text.match(/^OPTOTICA\s+([A-Za-z0-9_-]{32,})$/i);
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
      && invitation.expected_whatsapp_e164 === whatsappE164;
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
