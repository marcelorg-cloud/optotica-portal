import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { firstIncomingPhone, sendWhatsAppText, validMetaSignature } from '@/lib/meta';
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
  const phone = firstIncomingPhone(payload);
  if (!phone) return NextResponse.json({ received: true });

  const admin = createAdminSupabaseClient();
  const { data: client } = await admin
    .from('clients')
    .select('id, email, active')
    .eq('whatsapp_e164', `+${phone}`)
    .eq('active', true)
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
    await admin.from('clients').update({ auth_user_id: data.user.id }).eq('id', client.id).is('auth_user_id', null);
  }

  const magicLink = `${publicEnv.appUrl()}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&next=/cliente`;
  await sendWhatsAppText(phone, `Seu acesso seguro ao Portal Optótica:\n${magicLink}\n\nEste link é pessoal e temporário. Não encaminhe.`);
  return NextResponse.json({ received: true });
}
