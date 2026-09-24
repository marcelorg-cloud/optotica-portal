import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';
import { api, connection, dbError, exchange, lease, oauthAuthorizationError, tokenFields } from '@/lib/canva/api';
import { CanvaError, config, decrypt, digest, workspace } from '@/lib/canva/security';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });
  let returnPath = '/admin/catalogo';
  let stage = 'state';
  try {
    const url = new URL(request.url), state = url.searchParams.get('state'), code = url.searchParams.get('code');
    if (!state || state.length > 256) throw new Error('state');
    // DELETE ... RETURNING consumes state once and binds the OAuth flow to this master.
    const { data: pending, error } = await auth.admin.from('canva_oauth_states').delete()
      .eq('state_hash', digest(state)).eq('user_id', auth.userId).gt('expires_at', new Date().toISOString())
      .select('*').maybeSingle();
    dbError(error); if (!pending) throw new Error('state');
    returnPath = workspace(pending.product_id, pending.color_id);
    const providerError = url.searchParams.get('error');
    if (providerError) throw oauthAuthorizationError(providerError);
    if (!code || code.length > 4096) throw new CanvaError('O Canva não devolveu um código de autorização. Tente conectar novamente.',
      401, 'missing_authorization_code');
    stage = 'token_exchange';
    const settings = config();
    const tokens = await exchange(new URLSearchParams({ grant_type: 'authorization_code', code,
      redirect_uri: settings.redirectUri,
      code_verifier: decrypt(pending.verifier, settings.encryptionKey, auth.userId + ':oauth') }));
    stage = 'identity';
    const { team_user } = await api<{ team_user: { user_id: string; team_id: string } }>(tokens.access_token, '/users/me');
    if (!team_user?.user_id || !team_user.team_id) throw new Error('identity');
    const record = { user_id: auth.userId, canva_user_id: team_user.user_id, canva_team_id: team_user.team_id,
      ...tokenFields(tokens, auth.userId) };
    stage = 'connection_save';
    if (await connection(auth.admin, auth.userId)) {
      await lease(auth.admin, 'canva_connections', 'user_id', auth.userId, async () => {
        dbError((await auth.admin.from('canva_connections').update(record).eq('user_id', auth.userId)).error);
      });
    } else {
      dbError((await auth.admin.from('canva_connections').insert(record)).error);
    }
    return NextResponse.redirect(new URL(returnPath, settings.origin));
  } catch (error) {
    const known = error instanceof CanvaError;
    // Never log the authorization code, state, PKCE verifier, tokens, secrets or request URL.
    console.error('canva_oauth_callback_failed', {
      stage,
      status: known ? error.status : 500,
      code: known ? error.code || 'canva_error' : 'unexpected_error'
    });
    const target = new URL(returnPath, new URL(request.url).origin);
    target.searchParams.set('canva_error', known
      ? error.message
      : stage === 'identity'
        ? 'O Canva autorizou a conta, mas não devolveu a identificação do usuário. Tente conectar novamente.'
        : stage === 'connection_save'
          ? 'A conta foi autorizada, mas o portal não conseguiu salvar a conexão. Tente novamente.'
          : 'Não foi possível conectar a conta Canva. Tente conectar novamente.');
    return NextResponse.redirect(target);
  }
}
