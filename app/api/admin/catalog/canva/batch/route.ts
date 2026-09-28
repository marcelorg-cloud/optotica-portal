import { NextResponse } from 'next/server';
import { requireMaster } from '@/lib/catalog/require-master';
import { access, api, connection, dbError, getColor, sameAccount } from '@/lib/canva/api';
import { ensureColorPage } from '@/lib/canva/pages';
import { buildCanvaBatchPrompt } from '@/lib/canva/prompt';
import { getTemplate, sameTemplateSnapshot } from '@/lib/canva/template';
import { CanvaError, canvaUrl, configurationStatus, sameOrigin, uuid } from '@/lib/canva/security';
import { photoFilename } from '@/lib/canva/layout';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

function failure(error: unknown) {
  return NextResponse.json({ message: error instanceof CanvaError ? error.message : 'Não foi possível concluir o lote do Canva.' },
    { status: error instanceof CanvaError ? error.status : 500, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });
  try {
    const productId = new URL(request.url).searchParams.get('productId');
    if (!uuid(productId)) throw new CanvaError('Produto inválido.');
    const [productResult, colorsResult, linksResult, designResult, template] = await Promise.all([
      auth.admin.from('catalog_products').select('id, model_name, sku_optotica, position_image_path, lens_width_mm, lens_height_mm, bridge_mm, lens_diagonal_mm, temple_length_mm, rim_mm, frame_total_width_mm, standard_height_mm, canva_reference_revision').eq('id', productId).maybeSingle(),
      auth.admin.from('catalog_product_color_images').select('id, color_name, color_variant_number, original_image_path, processed_image_path').eq('product_id', productId).order('color_variant_number', { ascending: true }),
      auth.admin.from('catalog_canva_designs').select('color_id, page_id, page_number, source_path, reference_revision, template_updated_at, page_stage').eq('product_id', productId),
      auth.admin.from('canva_product_designs').select('pending_color_id').eq('product_id', productId).maybeSingle(),
      getTemplate(auth.admin)
    ]);
    dbError(productResult.error || colorsResult.error || linksResult.error || designResult.error);
    const product = productResult.data;
    if (!product) throw new CanvaError('Produto não encontrado.', 404);
    const config = configurationStatus();
    const connected = config.configured ? !!(await connection(auth.admin, auth.userId)) : false;
    const links = new Map((linksResult.data || []).map(link => [link.color_id, link]));
    const colors = (colorsResult.data || []).map(color => {
      const link = links.get(color.id);
      let filename: string | null = null;
      try { filename = photoFilename(product.sku_optotica, Number(color.color_variant_number), Number(product.frame_total_width_mm)); } catch {}
      const stale = !!link && (link.source_path !== color.original_image_path ||
        Number(link.reference_revision) !== Number(product.canva_reference_revision) ||
        !sameTemplateSnapshot(link.template_updated_at, template?.updated_at));
      return { id: color.id, name: color.color_name, variant: color.color_variant_number,
        filename, hasOriginal: !!color.original_image_path?.startsWith(productId + '/'),
        hasResult: !!color.processed_image_path, pageNumber: link?.page_number || null,
        hasPage: !!link?.page_id, stale, stage: link?.page_stage || null };
    });
    return NextResponse.json({ productName: product.model_name, sku: product.sku_optotica,
      connected, configured: config.configured, configurationError: config.error,
      hasMeasurements: !!product.position_image_path?.startsWith(productId + '/'),
      templateReady: !!template?.has_transparency,
      pendingColorId: designResult.data?.pending_color_id || null,
      prompt: buildCanvaBatchPrompt(product, colors.filter(color => color.hasOriginal && !!color.filename && !color.stale)
        .map(color => ({ name: color.name, filename: color.filename! }))),
      colors }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const auth = await requireMaster();
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });
  if (!sameOrigin(request)) return NextResponse.json({ message: 'Origem inválida.' }, { status: 403 });
  try {
    const body = await request.json().catch(() => null);
    if (!uuid(body?.productId)) throw new CanvaError('Produto inválido.');
    if (body.action === 'prepare') {
      if (!uuid(body.colorId)) throw new CanvaError('Cor inválida.');
      await getColor(auth.admin, body.productId, body.colorId);
      const result = await ensureColorPage(auth.admin, auth.userId, body.productId, body.colorId);
      return NextResponse.json({ status: result.ready ? 'ready' : 'processing' });
    }
    if (body.action === 'edit') {
      const { data: product, error } = await auth.admin.from('canva_product_designs').select('*')
        .eq('product_id', body.productId).maybeSingle();
      dbError(error);
      if (!product?.design_id || product.pending_color_id) throw new CanvaError('Conclua a preparação das cores antes de abrir o design.', 409);
      const { token, connection: current } = await access(auth.admin, auth.userId);
      sameAccount(product, current);
      const { design } = await api<{ design: { urls: { edit_url: string } } }>(token, '/designs/' + encodeURIComponent(product.design_id));
      return NextResponse.json({ editUrl: canvaUrl(design.urls.edit_url) });
    }
    throw new CanvaError('Ação inválida.');
  } catch (error) { return failure(error); }
}
