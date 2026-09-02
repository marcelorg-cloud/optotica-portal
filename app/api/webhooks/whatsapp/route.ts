import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { firstIncomingMessage, sendWhatsAppText, validMetaSignature } from '@/lib/meta';
import { publicEnv, serverEnv } from '@/lib/env';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && token === serverEnv.metaVerifyToken() && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!validMetaSignature(rawBody, request.headers.get('x-hub-signature-256'))) {
    return new NextResponse('Invalid signature', { status: 401 });
  }

  const payload = JSON.parse(rawBody) as unknown;
  const message = firstIncomingMessage(payload);
  if (!message) return NextResponse.json({ received: true });
  const { phone, messageId } = message;

  const admin = createAdminSupabaseClient();
  const { data: existingRequest } = await admin
    .from('whatsapp_access_requests')
    .select('id')
    .eq('whatsapp_message_id', messageId)
    .maybeSingle();
  if (existingRequest) return NextResponse.json({ received: true });

  const { data: client } = await admin
    .from('clients')
    .select('id, organization_id, email, status')
    .eq('whatsapp_e164', `+${phone}`)
    .eq('status', 'active')
    .maybeSingle();

  if (!client?.email) {
    await sendWhatsAppText(phone, 'Não encontramos um acesso ativo para este número. Fale com o profissional responsável pelo seu atendimento.');
    return NextResponse.json({ received: true });
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: client.email,
    options: { redirectTo: `${publicEnv.appUrl()}/auth/callback?next=/cliente` }
  });

  if (error || !data.properties?.hashed_token) {
    console.error('Falha ao gerar Magic Link para cliente autorizado', client.id);
    return NextResponse.json({ received: true });
  }

  if (data.user?.id) {
    const { error: accountError } = await admin.from('client_user_accounts').upsert(
      { client_id: client.id, user_id: data.user.id },
      { onConflict: 'client_id,user_id' }
    );
    if (accountError) throw accountError;
  }

  const magicLink = `${publicEnv.appUrl()}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&next=/cliente`;
  const consentVersion = process.env.OPTOTICA_CONSENT_VERSION || '2026-09-01';
  const tokenFingerprint = crypto.createHash('sha256').update(data.properties.hashed_token).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const { error: requestError } = await admin.from('whatsapp_access_requests').upsert({
    organization_id: client.organization_id,
    client_id: client.id,
    whatsapp_e164: `+${phone}`,
    whatsapp_message_id: messageId,
    consent_version: consentVersion,
    token_hash: tokenFingerprint,
    expires_at: expiresAt
  }, { onConflict: 'whatsapp_message_id' });
  if (requestError) throw requestError;

  const { error: consentError } = await admin.from('client_consents').insert([
    {
      organization_id: client.organization_id,
      client_id: client.id,
      whatsapp_e164: `+${phone}`,
      consent_type: 'authentication',
      granted: true,
      source: 'whatsapp_inbound',
      policy_version: consentVersion,
      evidence: { whatsapp_message_id: messageId }
    },
    {
      organization_id: client.organization_id,
      client_id: client.id,
      whatsapp_e164: `+${phone}`,
      consent_type: 'transactional_messages',
      granted: true,
      source: 'whatsapp_inbound',
      policy_version: consentVersion,
      evidence: { whatsapp_message_id: messageId }
    }
  ]);
  if (consentError) throw consentError;

  await sendWhatsAppText(phone, `Seu acesso seguro ao Portal Optótica:\n${magicLink}\n\nEste link é pessoal e temporário. Não encaminhe.`);
  return NextResponse.json({ received: true });
}
