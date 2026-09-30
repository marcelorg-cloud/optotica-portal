import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { sendWhatsAppAuthenticationCode } from '@/lib/meta';
import { challengeHash, isSameOrigin, normalizeLoginPhone, requesterFingerprint, resolveLoginCandidates } from '@/lib/auth/whatsapp-login';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ message: 'Origem inválida.' }, { status: 403 });
  const body = await request.json().catch(() => null);
  const phone = normalizeLoginPhone(body?.phone);
  if (!phone) return NextResponse.json({ message: 'Informe um WhatsApp válido com DDD.' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const fingerprint = requesterFingerprint(request);
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const retentionLimit = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const [{ count: phoneRequests, error: phoneCountError }, { count: deviceRequests, error: deviceCountError }] = await Promise.all([
    admin.from('whatsapp_login_challenges').select('id', { count: 'exact', head: true }).eq('whatsapp_e164', phone).gte('created_at', since),
    admin.from('whatsapp_login_challenges').select('id', { count: 'exact', head: true }).eq('requester_fingerprint', fingerprint).gte('created_at', since),
    admin.from('whatsapp_login_challenges').delete().lt('created_at', retentionLimit)
  ]);
  if (phoneCountError || deviceCountError) {
    console.error('whatsapp_login_rate_limit_failed', { code: phoneCountError?.code || deviceCountError?.code });
    return NextResponse.json({ message: 'Não foi possível solicitar o código agora.' }, { status: 503 });
  }
  if ((phoneRequests || 0) >= 3 || (deviceRequests || 0) >= 8) {
    return NextResponse.json({ message: 'Muitas solicitações. Aguarde alguns minutos e tente novamente.' }, { status: 429 });
  }

  const candidates = await resolveLoginCandidates(admin, phone);
  const challengeId = crypto.randomUUID();
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const { error: insertError } = await admin.from('whatsapp_login_challenges').insert({
    id: challengeId, whatsapp_e164: phone,
    code_hash: challengeHash(challengeId, phone, code), candidate_accounts: candidates,
    requester_fingerprint: fingerprint, expires_at: expiresAt
  });
  if (insertError) {
    console.error('whatsapp_login_challenge_create_failed', { code: insertError.code });
    return NextResponse.json({ message: 'Não foi possível solicitar o código agora.' }, { status: 503 });
  }

  if (candidates.length) {
    try { await sendWhatsAppAuthenticationCode(phone, code); }
    catch (error) {
      await admin.from('whatsapp_login_challenges').update({ status: 'revoked' }).eq('id', challengeId);
      console.error('whatsapp_login_send_failed', { message: error instanceof Error ? error.message : 'unknown' });
    }
  }

  return NextResponse.json({ challengeId, expiresIn: 300,
    message: 'Se este WhatsApp estiver autorizado, o código chegará em instantes.' },
  { headers: { 'Cache-Control': 'no-store' } });
}
