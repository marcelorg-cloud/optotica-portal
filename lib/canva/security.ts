import { createCipheriv, createDecipheriv, createHash, createPublicKey, randomBytes, verify, type JsonWebKey } from 'node:crypto';

export class CanvaError extends Error {
  constructor(message: string, public status = 400, public code?: string) { super(message); }
}

export function config() {
  // Vercel values are normally exact, but trimming here avoids a copied newline
  // turning a valid Canva credential into an opaque OAuth failure.
  const clientId = process.env.CANVA_CLIENT_ID?.trim();
  const clientSecret = process.env.CANVA_CLIENT_SECRET?.trim();
  const encryptionKey = process.env.CANVA_TOKEN_ENCRYPTION_KEY?.trim();
  const origin = process.env.CANVA_APP_ORIGIN?.trim();
  if (!clientId || !clientSecret || !encryptionKey || !origin) {
    throw new CanvaError('A conexão com o Canva ainda precisa ser configurada no portal.', 503);
  }
  if (!/^OC-[A-Za-z0-9_-]+$/.test(clientId)) {
    throw new CanvaError('O Client ID do Canva cadastrado no portal é inválido.', 503, 'invalid_client_id_config');
  }
  if (!clientSecret.startsWith('cnvca') || /\s/.test(clientSecret)) {
    throw new CanvaError('O Client Secret do Canva cadastrado no portal é inválido. Gere e copie o segredo novamente.', 503,
      'invalid_client_secret_config');
  }
  const url = new URL(origin);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) {
    throw new CanvaError('Endereço da integração inválido.', 503);
  }
  key(encryptionKey);
  return { clientId, clientSecret, encryptionKey, origin: url.origin,
    redirectUri: url.origin + '/api/admin/catalog/canva/oauth/callback' };
}
export function configurationStatus() {
  try {
    config();
    return { configured: true, error: null };
  } catch (error) {
    return {
      configured: false,
      error: error instanceof CanvaError ? error.message : 'A conexão com o Canva ainda precisa ser configurada no portal.'
    };
  }
}
export function configured() { return configurationStatus().configured; }
function key(value: string) {
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new CanvaError('Chave de proteção do Canva inválida.', 503);
  return Buffer.from(value, 'hex');
}
export function encrypt(value: string, secret: string, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}
export function decrypt(value: string, secret: string, context: string) {
  const parts = value.split('.');
  if (parts.length !== 3) throw new CanvaError('Reconecte sua conta Canva.', 401);
  const [iv, tag, encrypted] = parts.map(part => Buffer.from(part, 'base64url'));
  const cipher = createDecipheriv('aes-256-gcm', key(secret), iv);
  cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8');
}
export function digest(value: string) { return createHash('sha256').update(value).digest('hex'); }
export function challenge(value: string) { return createHash('sha256').update(value).digest('base64url'); }
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return !!origin && origin === new URL(request.url).origin;
}
export function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export function workspace(productId: string, colorId: string) {
  if (!uuid(productId) || !uuid(colorId)) throw new CanvaError('Produto ou cor inválidos.');
  return '/admin/catalogo/' + productId + '/canva/' + colorId;
}
export function canvaUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !(url.hostname === 'canva.com' || url.hostname.endsWith('.canva.com'))) {
    throw new CanvaError('O Canva retornou um endereço inválido.', 502);
  }
  return url.toString();
}
export type ReturnClaims = {
  aud: string | string[]; exp: number; sub: string; team_id: string; type: string;
  design_id: string; correlation_state: string; jti: string;
};
type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string };
export function verifyReturnJwt(token: string, keys: Jwk[], audience: string, now = Date.now() / 1000): ReturnClaims {
  if (token.length > 16000) throw new CanvaError('Retorno do Canva inválido.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new CanvaError('Retorno do Canva inválido.');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  if (header.alg !== 'EdDSA' || typeof header.kid !== 'string') throw new CanvaError('Assinatura do Canva inválida.');
  const jwk = keys.find(item => item.kid === header.kid && item.kty === 'OKP' && item.crv === 'Ed25519' &&
    (!item.alg || item.alg === 'EdDSA') && (!item.use || item.use === 'sig'));
  if (!jwk || !verify(null, Buffer.from(parts[0] + '.' + parts[1]),
    createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) {
    throw new CanvaError('Assinatura do Canva inválida.');
  }
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as ReturnClaims;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(audience) || !Number.isFinite(claims.exp) || claims.exp <= now ||
    claims.exp > now + 86460 || claims.type !== 'rti' || !uuid(claims.correlation_state) ||
    !claims.sub || !claims.team_id || !claims.design_id || !claims.jti) {
    throw new CanvaError('O retorno do Canva expirou ou não pertence a esta integração.');
  }
  return claims;
}
