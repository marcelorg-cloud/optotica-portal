import { randomBytes, randomUUID } from 'node:crypto';
import type { createAdminSupabaseClient } from '@/lib/supabase/server';
import { CanvaError, config, encrypt, decrypt, digest, challenge, workspace } from './security';

export type Admin = ReturnType<typeof createAdminSupabaseClient>;
const API = 'https://api.canva.com/rest/v1';
export const BUCKET = 'catalog-product-photos';
export const SCOPES = 'asset:read asset:write design:content:read design:content:write design:meta:read profile:read';
export type Connection = {
  user_id: string; canva_user_id: string; canva_team_id: string;
  access_token: string; refresh_token: string; expires_at: string;
};
export type Session = {
  id: string; color_id: string; product_id: string; user_id: string; design_id: string;
  canva_user_id: string; canva_team_id: string; original_path: string;
  previous_path: string | null; previous_processed_at: string | null; frame_width_mm: number;
  export_job_id: string | null; staged_path: string | null; saved_at: string | null;
  expires_at: string; return_verified_at: string | null; page_id: string | null; export_filename: string | null; export_page_ids: string[] | null;
};
export type DesignLink = {
  color_id: string; product_id: string; user_id: string; canva_user_id: string; canva_team_id: string;
  page_id: string | null; page_number: number | null; page_filename: string | null;
  page_stage: string; import_job_id: string | null; merge_job_id: string | null;
  source_design_id: string | null; before_page_ids: string[] | null;
  source_path: string; asset_id: string | null; upload_job_id: string | null; design_id: string | null; creating: boolean;
};
export type Job = { id?: string; status: 'in_progress' | 'success' | 'failed';
  asset?: { id: string }; urls?: string[]; error?: { code?: string } };

export function dbError(error: unknown) {
  if (error) throw new CanvaError('Não foi possível salvar a operação. Tente novamente.', 500);
}
export async function lease<T>(admin: Admin, table: string, column: string, id: string, run: () => Promise<T>) {
  const token = randomUUID(), now = new Date();
  const { data, error } = await admin.from(table).update({ lock_token: token, lock_until: new Date(now.getTime() + 150000).toISOString() })
    .eq(column, id).lt('lock_until', now.toISOString()).select(column).maybeSingle();
  dbError(error);
  if (!data) throw new CanvaError('Outra operação do Canva está em andamento. Aguarde alguns instantes.', 409);
  try { return await run(); }
  finally {
    await admin.from(table).update({ lock_token: null, lock_until: new Date(0).toISOString() })
      .eq(column, id).eq('lock_token', token);
  }
}

export async function api<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(API + path, { ...init, cache: 'no-store', redirect: 'error',
    signal: AbortSignal.timeout(25000),
    headers: { 'Content-Type': 'application/json', ...init.headers, Authorization: 'Bearer ' + accessToken } });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) throw new CanvaError('Reconecte sua conta Canva para continuar.', 401);
    if (response.status === 429) throw new CanvaError('O Canva atingiu o limite de solicitações. Aguarde e tente novamente.', 429);
    if (response.status === 403) throw new CanvaError('Sua conta Canva não permite esta ação. Confira as permissões e o plano.', 403);
    throw new CanvaError('O Canva não concluiu a solicitação. Confira o design e tente novamente.', 502);
  }
  return body as T;
}
type Tokens = { access_token: string; refresh_token: string; expires_in: number };
export async function exchange(body: URLSearchParams): Promise<Tokens> {
  const settings = config();
  const response = await fetch(API + '/oauth/token', { method: 'POST', cache: 'no-store', redirect: 'error',
    signal: AbortSignal.timeout(25000), headers: {
      Authorization: 'Basic ' + Buffer.from(settings.clientId + ':' + settings.clientSecret).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    }, body: body.toString() });
  const value = await response.json().catch(() => null);
  if (!response.ok || !value?.access_token || !value?.refresh_token || !(value.expires_in > 0)) {
    throw new CanvaError('Não foi possível autorizar o Canva. Conecte a conta novamente.', 401);
  }
  return value;
}
export function tokenFields(tokens: Tokens, userId: string) {
  const secret = config().encryptionKey;
  return {
    access_token: encrypt(tokens.access_token, secret, userId + ':access'),
    refresh_token: encrypt(tokens.refresh_token, secret, userId + ':refresh'),
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString()
  };
}
export async function connection(admin: Admin, userId: string): Promise<Connection | null> {
  const { data, error } = await admin.from('canva_connections').select('*').eq('user_id', userId).maybeSingle();
  dbError(error); return data as Connection | null;
}
export async function access(admin: Admin, userId: string) {
  const current = await connection(admin, userId);
  if (!current) throw new CanvaError('Conecte sua conta Canva para continuar.', 401);
  if (new Date(current.expires_at).getTime() > Date.now() + 60000) {
    return { token: decrypt(current.access_token, config().encryptionKey, userId + ':access'), connection: current };
  }
  return lease(admin, 'canva_connections', 'user_id', userId, async () => {
    const fresh = await connection(admin, userId);
    if (!fresh) throw new CanvaError('Reconecte sua conta Canva.', 401);
    if (new Date(fresh.expires_at).getTime() > Date.now() + 60000) {
      return { token: decrypt(fresh.access_token, config().encryptionKey, userId + ':access'), connection: fresh };
    }
    const tokens = await exchange(new URLSearchParams({ grant_type: 'refresh_token',
      refresh_token: decrypt(fresh.refresh_token, config().encryptionKey, userId + ':refresh') }));
    const fields = tokenFields(tokens, userId);
    const { error } = await admin.from('canva_connections').update(fields).eq('user_id', userId);
    dbError(error);
    return { token: tokens.access_token, connection: { ...fresh, ...fields } };
  });
}
export async function beginOAuth(admin: Admin, userId: string, productId: string, colorId: string) {
  const settings = config(), state = randomBytes(32).toString('base64url'), verifier = randomBytes(64).toString('base64url');
  await admin.from('canva_oauth_states').delete().eq('user_id', userId).lt('expires_at', new Date().toISOString());
  const { error } = await admin.from('canva_oauth_states').insert({ state_hash: digest(state), user_id: userId,
    product_id: productId, color_id: colorId, verifier: encrypt(verifier, settings.encryptionKey, userId + ':oauth'),
    expires_at: new Date(Date.now() + 600000).toISOString() });
  dbError(error);
  const url = new URL('https://www.canva.com/api/oauth/authorize');
  url.search = new URLSearchParams({ client_id: settings.clientId, response_type: 'code', scope: SCOPES,
    redirect_uri: settings.redirectUri, state, code_challenge: challenge(verifier), code_challenge_method: 'S256' }).toString();
  return url.toString();
}
export async function getColor(admin: Admin, productId: string, colorId: string) {
  workspace(productId, colorId);
  const [colorResult, productResult] = await Promise.all([
    admin.from('catalog_product_color_images').select('id, product_id, color_name, color_variant_number, color_principal, color_secondary, original_image_path, processed_image_path, processed_at')
      .eq('id', colorId).eq('product_id', productId).maybeSingle(),
    admin.from('catalog_products').select('id, model_name, sku_optotica, frame_total_width_mm').eq('id', productId).maybeSingle()
  ]);
  dbError(colorResult.error || productResult.error);
  if (!colorResult.data || !productResult.data) throw new CanvaError('Produto ou cor não encontrados.', 404);
  return { color: colorResult.data, product: productResult.data };
}
export async function getLink(admin: Admin, colorId: string): Promise<DesignLink | null> {
  const { data, error } = await admin.from('catalog_canva_designs').select('*').eq('color_id', colorId).maybeSingle();
  dbError(error); return data as DesignLink | null;
}
export async function getSession(admin: Admin, userId: string, sessionId: string): Promise<Session> {
  const { data, error } = await admin.from('canva_edit_sessions').select('*')
    .eq('id', sessionId).eq('user_id', userId).gt('expires_at', new Date().toISOString()).maybeSingle();
  dbError(error);
  if (!data) throw new CanvaError('Esta edição expirou. Abra o design novamente pelo produto.', 410);
  return data as Session;
}
export function sameAccount(link: { user_id: string; canva_user_id: string; canva_team_id: string }, current: Connection) {
  if (link.user_id !== current.user_id || link.canva_user_id !== current.canva_user_id || link.canva_team_id !== current.canva_team_id) {
    throw new CanvaError('Este design está vinculado a outra conta ou equipe Canva. Use a conta que criou o design.', 403);
  }
}
export async function signedPreview(admin: Admin, path: string | null) {
  if (!path) return null;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 3600);
  dbError(error); return data?.signedUrl || null;
}
