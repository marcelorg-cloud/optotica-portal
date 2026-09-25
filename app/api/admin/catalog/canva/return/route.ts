import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';
import { dbError, getSession } from '@/lib/canva/api';
import { CanvaError, config, uuid, verifyReturnJwt, workspace } from '@/lib/canva/security';

export const runtime = 'nodejs';
function unverifiedCorrelationState(token: string | null) {
  if (!token || token.length > 16000) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return uuid(payload?.correlation_state) ? payload.correlation_state : null;
  } catch { return null; }
}
function failureKind(error: unknown) {
  if (error instanceof CanvaError) return error.code || 'canva_validation';
  if (error instanceof Error && ['missing_token', 'keys_unavailable', 'session_mismatch'].includes(error.message)) return error.message;
  return 'unexpected_error';
}
export async function GET(request: Request) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });
  const requestUrl = new URL(request.url), jwt = requestUrl.searchParams.get('correlation_jwt');
  let stage = 'configuration', portalOrigin = requestUrl.origin;
  try {
    const settings = config(); portalOrigin = settings.origin;
    if (!jwt) throw new Error('missing_token');
    stage = 'keys';
    const response = await fetch('https://api.canva.com/rest/v1/connect/keys', {
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('keys_unavailable');
    const { keys } = await response.json();
    stage = 'signature';
    const claims = verifyReturnJwt(jwt, keys, settings.clientId);
    stage = 'session';
    const session = await getSession(auth.admin, auth.userId, claims.correlation_state);
    stage = 'binding';
    if (session.design_id !== claims.design_id || session.canva_user_id !== claims.sub || session.canva_team_id !== claims.team_id) {
      throw new Error('session_mismatch');
    }
    stage = 'persist';
    dbError((await auth.admin.from('canva_edit_sessions').update({ return_verified_at: new Date().toISOString() })
      .eq('id', session.id).eq('user_id', auth.userId)).error);
    const target = new URL(workspace(session.product_id, session.color_id), settings.origin);
    target.searchParams.set('session', session.id);
    return NextResponse.redirect(target);
  } catch (error) {
    console.error('[canva:return] validation failed', { stage, kind: failureKind(error) });
    const correlationState = unverifiedCorrelationState(jwt);
    if (correlationState) {
      try {
        const session = await getSession(auth.admin, auth.userId, correlationState);
        const target = new URL(workspace(session.product_id, session.color_id), portalOrigin);
        target.searchParams.set('session', session.id);
        target.searchParams.set('canva_error', 'Não foi possível validar o retorno do Canva, mas o design foi preservado e será importado para conferência.');
        return NextResponse.redirect(target);
      } catch { /* Keep the generic authenticated fallback below. */ }
    }
    const target = new URL('/admin/catalogo', portalOrigin);
    target.searchParams.set('canva_error', 'Não foi possível validar o retorno do Canva. Abra o produto e use Importar do Canva.');
    return NextResponse.redirect(target);
  }
}
