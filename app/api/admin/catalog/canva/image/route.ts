import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { requireMaster } from '@/lib/catalog/require-master';
import { BUCKET, getColor, getSession } from '@/lib/canva/api';
import { CanvaError, uuid } from '@/lib/canva/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Pragma': 'no-cache',
  'Expires': '0',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow, noarchive'
};
function storedPath(path: string | null, prefix: string) {
  if (!path || path.length > 1024 || !path.startsWith(prefix) || path.includes('\\') || path.includes('\0')) return false;
  return path.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
}

function failure(error: unknown) {
  const known = error instanceof CanvaError;
  return NextResponse.json({ message: known ? error.message : 'Não foi possível carregar esta imagem.' }, {
    status: known ? error.status : 500,
    headers: PRIVATE_HEADERS
  });
}

export async function GET(request: Request) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status, headers: PRIVATE_HEADERS });
  try {
    const params = new URL(request.url).searchParams;
    const productId = params.get('productId'), colorId = params.get('colorId');
    const kind = params.get('kind'), sessionId = params.get('sessionId');
    if (!uuid(productId) || !uuid(colorId) || !['original', 'current', 'preview'].includes(kind || '')) {
      throw new CanvaError('Imagem inválida.');
    }
    const { color } = await getColor(auth.admin, productId, colorId);
    let path: string | null;
    if (kind === 'preview') {
      if (!uuid(sessionId)) throw new CanvaError('Prévia inválida.');
      const session = await getSession(auth.admin, auth.userId, sessionId);
      if (session.product_id !== productId || session.color_id !== colorId) {
        throw new CanvaError('A prévia pertence a outra cor.', 403);
      }
      path = session.staged_path;
      if (path && !storedPath(path, `${productId}/canva/${colorId}/${sessionId}/`)) {
        throw new CanvaError('Caminho da prévia inválido.', 403);
      }
    } else {
      path = kind === 'original' ? color.original_image_path : color.processed_image_path;
      if (path && !storedPath(path, productId + '/')) throw new CanvaError('Caminho da imagem inválido.', 403);
    }
    if (!path) throw new CanvaError('Imagem ainda não disponível.', 404);

    const { data, error } = await auth.admin.storage.from(BUCKET).download(path, {}, {
      cache: 'no-store', signal: AbortSignal.timeout(10000)
    });
    if (error || !data) {
      console.error('[canva:image] storage download failed', { kind });
      throw new CanvaError('Imagem temporariamente indisponível.', 503);
    }
    if (data.size === 0 || data.size > 20 * 1024 * 1024) throw new CanvaError('Arquivo de imagem inválido.', 415);
    const bytes = Buffer.from(await data.arrayBuffer());
    let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
    try { metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata(); }
    catch { throw new CanvaError('Formato de imagem inválido.', 415); }
    const contentType = metadata.format === 'jpeg' ? 'image/jpeg' : metadata.format === 'png' ? 'image/png'
      : metadata.format === 'webp' ? 'image/webp'
      : metadata.format === 'heif' && metadata.compression === 'av1' ? 'image/avif' : null;
    if (!contentType || !metadata.width || !metadata.height || (metadata.pages || 1) !== 1 ||
        metadata.width * metadata.height > 40_000_000 || (kind === 'preview' && contentType !== 'image/png')) {
      throw new CanvaError('Formato de imagem inválido.', 415);
    }
    return new Response(bytes, { headers: { ...PRIVATE_HEADERS, 'Content-Type': contentType } });
  } catch (error) {
    return failure(error);
  }
}
