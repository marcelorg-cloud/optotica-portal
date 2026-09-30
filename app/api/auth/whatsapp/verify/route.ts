import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { challengeHash, isSameOrigin, parseStoredCandidates, resolveLoginCandidates, safeHashEqual } from '@/lib/auth/whatsapp-login';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const invalid = () => NextResponse.json({ message: 'Código inválido ou expirado.' }, { status: 400 });

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ message: 'Origem inválida.' }, { status: 403 });
  const body = await request.json().catch(() => null);
  const challengeId = typeof body?.challengeId === 'string' ? body.challengeId : '';
  const code = typeof body?.code === 'string' ? body.code.replace(/\D/g, '') : '';
  const accountKey = typeof body?.accountKey === 'string' ? body.accountKey : '';
  if (!/^[0-9a-f-]{36}$/i.test(challengeId)) return invalid();

  const admin = createAdminSupabaseClient();
  const { data: challenge, error } = await admin.from('whatsapp_login_challenges')
    .select('id, whatsapp_e164, code_hash, candidate_accounts, status, attempts, expires_at')
    .eq('id', challengeId).maybeSingle();
  if (error || !challenge || challenge.status === 'consumed' || challenge.status === 'revoked' ||
      new Date(challenge.expires_at).getTime() <= Date.now() || challenge.attempts >= 5) return invalid();

  const candidates = parseStoredCandidates(challenge.candidate_accounts);
  if (challenge.status === 'pending') {
    if (!/^\d{6}$/.test(code) || !safeHashEqual(challenge.code_hash, challengeHash(challenge.id, challenge.whatsapp_e164, code))) {
      const attempts = Math.min(5, challenge.attempts + 1);
      await admin.from('whatsapp_login_challenges').update({ attempts, ...(attempts >= 5 ? { status: 'revoked' } : {}) })
        .eq('id', challenge.id).eq('status', 'pending');
      return invalid();
    }
    if (candidates.length > 1 && !accountKey) {
      await admin.from('whatsapp_login_challenges').update({ status: 'verified', verified_at: new Date().toISOString() })
        .eq('id', challenge.id).eq('status', 'pending');
      return NextResponse.json({ requiresAccount: true, accounts: candidates.map(item => ({ key: item.key, label: item.label })) });
    }
  }

  if (!candidates.length) return invalid();
  if (challenge.status === 'verified' && !accountKey) {
    return NextResponse.json({ requiresAccount: true, accounts: candidates.map(item => ({ key: item.key, label: item.label })) });
  }
  const selected = candidates.length === 1 ? candidates[0] : candidates.find(item => item.key === accountKey);
  if (!selected) return NextResponse.json({ message: 'Escolha qual conta deseja acessar.' }, { status: 400 });

  const current = await resolveLoginCandidates(admin, challenge.whatsapp_e164);
  if (!current.some(item => item.userId === selected.userId && item.kind === selected.kind)) return invalid();

  const consumedAt = new Date().toISOString();
  const { data: claimed } = await admin.from('whatsapp_login_challenges')
    .update({ status: 'consumed', consumed_at: consumedAt, verified_at: consumedAt })
    .eq('id', challenge.id).in('status', ['pending', 'verified']).select('id').maybeSingle();
  if (!claimed) return invalid();

  try {
    const { data: userResult, error: userError } = await admin.auth.admin.getUserById(selected.userId);
    const email = userResult.user?.email;
    if (userError || !email) throw userError || new Error('missing_user_email');
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    const tokenHash = link.properties?.hashed_token;
    if (linkError || !tokenHash) throw linkError || new Error('missing_token_hash');
    const supabase = await createServerSupabaseClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
    if (verifyError) throw verifyError;
    return NextResponse.json({ redirectTo: selected.redirectTo }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (loginError) {
    await admin.from('whatsapp_login_challenges').update({ status: 'verified', consumed_at: null })
      .eq('id', challenge.id).eq('consumed_at', consumedAt);
    console.error('whatsapp_login_session_failed', { message: loginError instanceof Error ? loginError.message : 'unknown' });
    return NextResponse.json({ message: 'O código foi confirmado, mas não foi possível abrir a sessão. Tente novamente.' }, { status: 503 });
  }
}
