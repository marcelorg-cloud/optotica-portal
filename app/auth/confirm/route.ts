import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { publicEnv } from '@/lib/env';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  if (!tokenHash) return NextResponse.redirect(`${publicEnv.appUrl()}/entrar?erro=link-invalido`);

  const admin = createAdminSupabaseClient();
  const fingerprint = crypto.createHash('sha256').update(tokenHash).digest('hex');
  const { data: accessRequest } = await admin
    .from('whatsapp_access_requests')
    .select('id, expires_at, status')
    .eq('token_hash', fingerprint)
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Quando o token foi enviado pelo WhatsApp, a janela adicional do portal
  // prevalece sobre a validade padrão do Supabase.
  if (accessRequest && (accessRequest.status !== 'pending' || new Date(accessRequest.expires_at).getTime() <= Date.now())) {
    return NextResponse.redirect(`${publicEnv.appUrl()}/entrar?erro=link-expirado`);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
  if (error) return NextResponse.redirect(`${publicEnv.appUrl()}/entrar?erro=link-invalido`);

  if (accessRequest) {
    await admin.from('whatsapp_access_requests').update({ status: 'consumed', consumed_at: new Date().toISOString() }).eq('id', accessRequest.id).eq('status', 'pending');
    return NextResponse.redirect(`${publicEnv.appUrl()}/cliente`);
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${publicEnv.appUrl()}/entrar?erro=sessao-invalida`);
  const [{ data: master }, { data: profile }] = await Promise.all([
    admin.from('system_admins').select('user_id').eq('user_id', user.id).eq('active', true).maybeSingle(),
    admin.from('professional_profiles').select('status').eq('user_id', user.id).maybeSingle()
  ]);
  if (master) return NextResponse.redirect(`${publicEnv.appUrl()}/admin`);
  if (!profile || ['draft', 'changes_requested'].includes(profile.status)) return NextResponse.redirect(`${publicEnv.appUrl()}/profissional/cadastro`);
  return NextResponse.redirect(`${publicEnv.appUrl()}/profissional`);
}
