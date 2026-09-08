import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { publicEnv } from '@/lib/env';

const policyVersion = process.env.OPTOTICA_CONSENT_VERSION || '2026-09-01';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim().replace(/\s+/g, ' ') : '';
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const acceptedTerms = body?.acceptedTerms === true;

  if (fullName.length < 2 || fullName.length > 120) {
    return NextResponse.json({ message: 'Informe seu nome completo.' }, { status: 400 });
  }
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) {
    return NextResponse.json({ message: 'Informe um e-mail válido.' }, { status: 400 });
  }
  if (!acceptedTerms) {
    return NextResponse.json({ message: 'Confirme a ciência sobre o uso dos seus dados.' }, { status: 400 });
  }

  const supabase = createClient(publicEnv.supabaseUrl(), publicEnv.supabasePublishableKey(), {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${publicEnv.appUrl()}/auth/confirm`,
      data: {
        full_name: fullName,
        requested_role: 'professional',
        registration_source: 'portal',
        policy_version: policyVersion
      }
    }
  });

  if (error) {
    console.error('self_registration_otp_failed', { code: error.code, status: error.status });
    const status = error.status === 429 ? 429 : 503;
    const message = status === 429
      ? 'Muitas tentativas. Aguarde alguns minutos antes de solicitar outro link.'
      : 'Não foi possível enviar o link agora. Tente novamente mais tarde.';
    return NextResponse.json({ message }, { status });
  }

  return NextResponse.json({
    message: 'Cadastro iniciado. Confira seu e-mail para abrir o formulário profissional.'
  });
}
