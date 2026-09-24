import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';
import { beginOAuth, connection, getColor, getLink, getSession, signedPreview } from '@/lib/canva/api';
import { CanvaError, configured, sameOrigin, uuid } from '@/lib/canva/security';
import { createSession, exportSession, linkExisting, openDesign, saveSession } from '@/lib/canva/workflow';

import { getTemplate } from '@/lib/canva/template';
import { photoFilename } from '@/lib/canva/layout';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';
function failure(error: unknown) {
  return NextResponse.json({ message: error instanceof CanvaError ? error.message : 'Não foi possível concluir a operação no Canva. Tente novamente.' },
    { status: error instanceof CanvaError ? error.status : 500, headers: { 'Cache-Control': 'no-store' } });
}
export async function GET(request: Request) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });
  try {
    const url = new URL(request.url), productId = url.searchParams.get('productId'), colorId = url.searchParams.get('colorId');
    if (!uuid(productId) || !uuid(colorId)) throw new CanvaError('Produto ou cor inválidos.');
    const { color, product } = await getColor(auth.admin, productId, colorId);
    const ready = configured();
    const [current, link, originalUrl, currentUrl, template] = await Promise.all([
      ready ? connection(auth.admin, auth.userId) : null,
      ready ? getLink(auth.admin, colorId) : null,
      signedPreview(auth.admin, color.original_image_path), signedPreview(auth.admin, color.processed_image_path), getTemplate(auth.admin)
    ]);
    let filename: string | null = null;
    try { filename = photoFilename(product.sku_optotica, Number(color.color_variant_number), Number(product.frame_total_width_mm)); } catch {}
    return NextResponse.json({ filename, pageNumber: link?.page_number, pageTitle: link?.page_filename,
      templateUrl: template ? 'data:image/png;base64,' + template.png_base64 : null,
      templateReady: !!template?.has_transparency, configured: ready, connected: !!current,
      productName: product.model_name, colorName: color.color_name, frameWidthMm: product.frame_total_width_mm,
      originalUrl, currentUrl, hasDesign: !!link?.page_id, needsRecovery: !!link && (link.page_stage === 'recovery' || (link.page_stage === 'importing' && !link.import_job_id) || (link.page_stage === 'merging' && !link.merge_job_id)),
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
