import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';
import { dbError, getSession } from '@/lib/canva/api';
import { config, verifyReturnJwt, workspace } from '@/lib/canva/security';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });
  try {
    const settings = config(), jwt = new URL(request.url).searchParams.get('correlation_jwt');
    if (!jwt) throw new Error('missing');
    const response = await fetch('https://api.canva.com/rest/v1/connect/keys', {
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('keys');
    const { keys } = await response.json();
    const claims = verifyReturnJwt(jwt, keys, settings.clientId);
    const session = await getSession(auth.admin, auth.userId, claims.correlation_state);
    if (session.design_id !== claims.design_id || session.canva_user_id !== claims.sub || session.canva_team_id !== claims.team_id) {
      throw new Error('mismatch');
    }
    dbError((await auth.admin.from('canva_edit_sessions').update({ return_verified_at: new Date().toISOString() })
      .eq('id', session.id).eq('user_id', auth.userId)).error);
    const target = new URL(workspace(session.product_id, session.color_id), settings.origin);
    target.searchParams.set('session', session.id);
    return NextResponse.redirect(target);
  } catch {
    const target = new URL('/admin/catalogo', new URL(request.url).origin);
    target.searchParams.set('canva_error', 'Não foi possível validar o retorno do Canva. Abra o produto e use Importar do Canva.');
    return NextResponse.redirect(target);
  }
}
