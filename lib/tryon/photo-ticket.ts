import { createHmac, timingSafeEqual } from 'node:crypto';
export type PhotoTicket = { userId: string; clientId: string; organizationId: string; path: string; sourcePath: string; previousPath: string | null; previousDate: string | null; expires: number };
export function signPhotoTicket(value: PhotoTicket, secret: string) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(`face-photo-v3:${payload}`).digest('base64url')}`;
}
export function readPhotoTicket(token: unknown, secret: string): PhotoTicket | null {
  if (typeof token !== 'string' || token.length > 8000) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = createHmac('sha256', secret).update(`face-photo-v3:${payload}`).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try { const value = JSON.parse(Buffer.from(payload, 'base64url').toString()); return typeof value.expires === 'number' && value.expires > Date.now() ? value : null; } catch { return null; }
}
