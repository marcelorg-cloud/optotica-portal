import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { publicEnv } from '@/lib/env';

const genericMessage = 'Se o e-mail estiver autorizado, você receberá um link de acesso.';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ message: 'Informe um e-mail válido.' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const candidate = users?.users.find(user => user.email?.toLowerCase() === email);
  const { data: membership } = candidate
    ? await admin.from('organization_members').select('user_id').eq('user_id', candidate.id).eq('active', true).maybeSingle()
    : { data: null };

  if (membership) {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false,       emailRedirectTo: `${publicEnv.appUrl()}/auth/confirm` }
    });
  }

  // Resposta uniforme evita revelar quais e-mails estão cadastrados.
  return NextResponse.json({ message: genericMessage });
}
