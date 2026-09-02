import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { publicEnv } from '@/lib/env';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const next = url.searchParams.get('next');
  const safeNext = next?.startsWith('/') && !next.startsWith('//') ? next : '/cliente';

  if (tokenHash) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
    if (!error) return NextResponse.redirect(`${publicEnv.appUrl()}${safeNext}`);
  }

  return NextResponse.redirect(`${publicEnv.appUrl()}/entrar?erro=link-invalido`);
}
