import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';
import { beginOAuth, canResumeDesignLink, connection, designLinkNeedsRecovery, getColor, getLink, getSession, recoverableSession } from '@/lib/canva/api';
import { CanvaError, configurationStatus, sameOrigin, uuid } from '@/lib/canva/security';
import { createSession, exportSession, linkExisting, openDesign, redoDesign, saveSession } from '@/lib/canva/workflow';
import { canvaImageUrl } from '@/lib/canva/navigation';

import { getTemplate } from '@/lib/canva/template';
import { photoFilename } from '@/lib/canva/layout';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';
function failure(error: unknown) {
  return NextResponse.json({ message: error instanceof CanvaError ? error.message : 'Não foi possível concluir a operação no Canva. Tente novamente.' },
    { status: error instanceof CanvaError ? error.status : 500, headers: { 'Cache-Control': 'no-store' } });
}
function imageVersion(path: string) {
  return createHash('sha256').update(path).digest('base64url').slice(0, 12);
}
export async function GET(request: Request) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });
  try {
    const url = new URL(request.url), productId = url.searchParams.get('productId'), colorId = url.searchParams.get('colorId');
    if (!uuid(productId) || !uuid(colorId)) throw new CanvaError('Produto ou cor inválidos.');
    const { color, product } = await getColor(auth.admin, productId, colorId);
    const configuration = configurationStatus(), ready = configuration.configured;
    const [current, link, recoverable, template] = await Promise.all([
      ready ? connection(auth.admin, auth.userId) : null,
      ready ? getLink(auth.admin, colorId) : null,
      recoverableSession(auth.admin, auth.userId, productId, colorId, color, product), getTemplate(auth.admin)
    ]);
    let filename: string | null = null;
    try { filename = photoFilename(product.sku_optotica, Number(color.color_variant_number), Number(product.frame_total_width_mm)); } catch {}
    const designTitle = Array.from(`${product.sku_optotica} — Prova online`).slice(0, 50).join('');
    const hasResumableDesign = canResumeDesignLink(link);
    return NextResponse.json({ filename, designTitle, pageNumber: link?.page_number, pageTitle: link?.page_filename,
      templateUrl: template ? 'data:image/png;base64,' + template.png_base64 : null,
      templateReady: !!template?.has_transparency, configured: ready, configurationError: configuration.error,
      connected: !!current,
      productName: product.model_name, colorName: color.color_name, frameWidthMm: product.frame_total_width_mm,
      originalUrl: color.original_image_path
        ? canvaImageUrl(productId, colorId, 'original', undefined, imageVersion(color.original_image_path)) : null,
      currentUrl: color.processed_image_path
        ? canvaImageUrl(productId, colorId, 'current', undefined, imageVersion(color.processed_image_path)) : null,
      recoverableSessionId: recoverable?.id || null, hasDesign: !!link?.page_id, hasResumableDesign,
      needsRecovery: designLinkNeedsRecovery(link),
      sourceChanged: !!link && link.source_path !== color.original_image_path
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });
  if (!sameOrigin(request)) return NextResponse.json({ message: 'Origem inválida.' }, { status: 403 });
  try {
    const body = await request.json().catch(() => null);
    if (!uuid(body?.productId) || !uuid(body?.colorId)) throw new CanvaError('Produto ou cor inválidos.');
    const { productId, colorId } = body;
    await getColor(auth.admin, productId, colorId);
    if (body.action === 'connect') {
      return NextResponse.json({ authorizeUrl: await beginOAuth(auth.admin, auth.userId, productId, colorId) });
    }
    if (body.action === 'open') return NextResponse.json(await openDesign(auth.admin, auth.userId, productId, colorId));
    if (body.action === 'redo' && uuid(body.sessionId)) {
      return NextResponse.json(await redoDesign(auth.admin, auth.userId, productId, colorId, body.sessionId));
    }
    if (body.action === 'link' && typeof body.designUrl === 'string' && body.designUrl.length < 2048) {
      await linkExisting(auth.admin, auth.userId, productId, colorId, body.designUrl, Number(body.pageNumber));
      return NextResponse.json({ status: 'linked' });
    }
    if (body.action === 'import') {
      const session = await createSession(auth.admin, auth.userId, productId, colorId);
      return NextResponse.json({ status: 'processing', sessionId: session.id });
    }
    if ((body.action === 'export' || body.action === 'save') && uuid(body.sessionId)) {
      const session = await getSession(auth.admin, auth.userId, body.sessionId);
      if (session.product_id !== productId || session.color_id !== colorId) throw new CanvaError('A prévia pertence a outra cor.', 403);
      return NextResponse.json(body.action === 'save'
        ? await saveSession(auth.admin, auth.userId, session.id)
        : await exportSession(auth.admin, auth.userId, session.id));
    }
    throw new CanvaError('Ação inválida.');
  } catch (error) { return failure(error); }
}
