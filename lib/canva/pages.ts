import { access, api, BUCKET, canResumeDesignLink, dbError, getColor, getLink, lease, sameAccount, type Admin } from './api';
import { CanvaError, canvaUrl } from './security';
import { colorPageDocument, ODP_MIME, photoFilename, SIZE } from './layout';
import { getTemplate } from './template';

export type CanvaPage = { id?: string; page_number: number; dimensions?: { width: number; height: number } };
type ProductDesign = { product_id: string; user_id: string; canva_user_id: string; canva_team_id: string;
  design_id: string | null; pending_color_id: string | null };
type ImportJob = { id: string; status: 'success' | 'failed' | 'in_progress'; result?: { designs: { id: string }[] } };
type MergeJob = { id: string; status: 'success' | 'failed' | 'in_progress'; result?: { design: { id: string } } };
async function productLink(admin: Admin, productId: string): Promise<ProductDesign> {
  const { data, error } = await admin.from('canva_product_designs').select('*').eq('product_id', productId).single();
  dbError(error); return data;
}
async function patchColor(admin: Admin, colorId: string, fields: Record<string, unknown>) {
  dbError((await admin.from('catalog_canva_designs').update(fields).eq('color_id', colorId)).error);
}
async function patchProduct(admin: Admin, productId: string, fields: Record<string, unknown>) {
  dbError((await admin.from('canva_product_designs').update(fields).eq('product_id', productId)).error);
}
export async function listPages(token: string, designId: string) {
  const pages: CanvaPage[] = [];
  for (let offset = 1; offset <= 500; offset += 200) {
    const { items } = await api<{ items: CanvaPage[] }>(token, '/designs/' + encodeURIComponent(designId) + '/pages?offset=' + offset + '&limit=200');
    if (!Array.isArray(items)) throw new CanvaError('Não foi possível conferir as páginas do Canva.', 502);
    pages.push(...items);
    if (items.length < 200) break;
  }
  return pages;
}
export function pageById(pages: CanvaPage[], id: string) {
  const page = pages.find(p => p.id === id);
  if (!page) throw new CanvaError('A página desta cor foi removida ou substituída no Canva. Confira o vínculo antes de importar.', 409);
  return page;
}
export function insertedPage(beforeIds: string[], pages: CanvaPage[]) {
  const before = new Set(beforeIds), added = pages.filter(p => p.id && !before.has(p.id));
  if (pages.some(p => !p.id) || added.length !== 1 || beforeIds.some(id => !pages.some(p => p.id === id))) {
    throw new CanvaError('As páginas do design mudaram durante a criação. Use Vincular página existente para conferir a página desta cor.', 409);
  }
  return added[0];
}
function hasCompletePageMetadata(page: CanvaPage) {
  return page.id !== undefined && page.page_number !== undefined && page.dimensions !== undefined &&
    page.dimensions.width !== undefined && page.dimensions.height !== undefined;
}
function samePageIds(beforeIds: string[], pages: CanvaPage[]) {
  if (pages.length !== beforeIds.length || pages.some(page => !page.id)) return false;
  const current = new Set(pages.map(page => page.id!));
  return current.size === beforeIds.length && beforeIds.every(id => current.has(id));
}
function pendingMergedPage(beforeIds: string[], pages: CanvaPage[]) {
  if (samePageIds(beforeIds, pages)) return true;
  if (pages.length !== beforeIds.length + 1 || beforeIds.some(id => !pages.some(page => page.id === id))) return false;
  const before = new Set(beforeIds);
  const candidates = pages.filter(page => !page.id || !before.has(page.id));
  return candidates.length === 1 && !hasCompletePageMetadata(candidates[0]);
}
function requireSquare(page: CanvaPage) {
  const width = page.dimensions?.width, height = page.dimensions?.height;
  if (!page.id || !Number.isInteger(page.page_number) || page.page_number < 1 || page.page_number > 500 ||
      typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height) ||
      width !== height || width < SIZE || width > 25000) {
    throw new CanvaError('A página precisa ser quadrada, ter ao menos 540 px por lado e um identificador estável no Canva.', 422);
  }
}
async function initializeProduct(admin: Admin, productId: string, current: { user_id: string; canva_user_id: string; canva_team_id: string }) {
  dbError((await admin.from('canva_product_designs').upsert({ product_id: productId, user_id: current.user_id,
    canva_user_id: current.canva_user_id, canva_team_id: current.canva_team_id }, { onConflict: 'product_id', ignoreDuplicates: true })).error);
}
async function bindPage(admin: Admin, productId: string, colorId: string, designId: string, page: CanvaPage) {
  requireSquare(page);
  await patchColor(admin, colorId, { design_id: designId, page_id: page.id, page_number: page.page_number, page_stage: 'ready', creating: false });
  await patchProduct(admin, productId, { design_id: designId, pending_color_id: null });
}
export async function ensureColorPage(admin: Admin, userId: string, productId: string, colorId: string) {
  const { color, product } = await getColor(admin, productId, colorId);
  const filename = photoFilename(product.sku_optotica, Number(color.color_variant_number), Number(product.frame_total_width_mm));
  if (!color.original_image_path?.startsWith(productId + '/')) throw new CanvaError('Cadastre a foto original desta cor.', 422);
  const { token, connection: current } = await access(admin, userId);
  await initializeProduct(admin, productId, current);
  return lease(admin, 'canva_product_designs', 'product_id', productId, async () => {
    const productDesign = await productLink(admin, productId);
    sameAccount(productDesign, current);
    if (productDesign.pending_color_id && productDesign.pending_color_id !== colorId) {
      throw new CanvaError('Outra cor deste produto está sendo preparada. Conclua essa cor antes de criar uma nova página.', 409);
    }
    let link = await getLink(admin, colorId);
    if (link) sameAccount(link, current);
    if (link?.page_id && link.design_id) {
      if (productDesign.design_id && productDesign.design_id !== link.design_id) throw new CanvaError('Vínculo do produto divergente.', 409);
      const page = pageById(await listPages(token, link.design_id), link.page_id);
      await patchColor(admin, colorId, { page_number: page.page_number });
      await patchProduct(admin, productId, { design_id: link.design_id, pending_color_id: null });
      return { ready: true, token, designId: link.design_id };
    }
    if (!link) {
      const template = await getTemplate(admin);
      if (!template?.has_transparency) throw new CanvaError('Cadastre uma imagem modelo PNG transparente de 540 × 540 px.', 422);
      dbError((await admin.from('catalog_canva_designs').insert({ color_id: colorId, product_id: productId, user_id: userId,
        canva_user_id: current.canva_user_id, canva_team_id: current.canva_team_id, source_path: color.original_image_path,
        page_filename: filename, template_updated_at: template.updated_at })).error);
      link = (await getLink(admin, colorId))!;
    }
    if (link.product_id !== productId) throw new CanvaError('Vínculo de cor inválido.', 409);
    if ((link.page_stage === 'importing' && !link.import_job_id) ||
        (link.page_stage === 'merging' && !link.merge_job_id) ||
        (link.page_stage === 'recovery' && !canResumeDesignLink(link))) {
      throw new CanvaError('Uma criação foi interrompida. Confira no Canva e use Vincular página existente para retomar sem duplicar.', 409);
    }
    if (!link.source_design_id) {
      if (!link.import_job_id) {
        const template = await getTemplate(admin);
        if (!template?.has_transparency) throw new CanvaError('Substitua a imagem modelo por um PNG transparente.', 422);
        const { data, error } = await admin.storage.from(BUCKET).download(link.source_path);
        if (error || !data || data.size > 20 * 1024 * 1024) throw new CanvaError('Foto original indisponível ou maior que 20 MB.', 422);
        const document = await colorPageDocument(Buffer.from(template.png_base64, 'base64'), Buffer.from(await data.arrayBuffer()), filename);
        await patchProduct(admin, productId, { pending_color_id: colorId });
        await patchColor(admin, colorId, { page_stage: 'importing', creating: true, page_filename: filename, template_updated_at: template.updated_at });
        const { job } = await api<{ job: ImportJob }>(token, '/imports', { method: 'POST', headers: {
          'Content-Type': 'application/octet-stream', 'Import-Metadata': JSON.stringify({
            title_base64: Buffer.from(Array.from(`${product.sku_optotica} — Prova online`).slice(0, 50).join('')).toString('base64'), mime_type: ODP_MIME }) },
          body: new Uint8Array(document) });
        if (!job.id) throw new CanvaError('O Canva não confirmou a criação.', 502);
        await patchColor(admin, colorId, { import_job_id: job.id });
        return { ready: false };
      }
      const { job } = await api<{ job: ImportJob }>(token, '/imports/' + encodeURIComponent(link.import_job_id));
      if (job.status === 'in_progress') return { ready: false };
      if (job.status !== 'success' || job.result?.designs.length !== 1) {
        await patchColor(admin, colorId, { page_stage: 'recovery' });
        throw new CanvaError('O Canva não conseguiu preparar a página. Confira o design antes de retomar.', 422);
      }
      link.source_design_id = job.result.designs[0].id;
      await patchColor(admin, colorId, { source_design_id: link.source_design_id, page_stage: 'imported' });
    }
    if (!productDesign.design_id) {
      const pages = await listPages(token, link.source_design_id);
      if (pages.length === 0 || (pages.length === 1 && !hasCompletePageMetadata(pages[0]))) return { ready: false };
      if (pages.length !== 1 || pages[0].page_number !== 1) {
        await patchColor(admin, colorId, { page_stage: 'recovery' });
        throw new CanvaError('A importação deve conter uma única página.', 422);
      }
      try { await bindPage(admin, productId, colorId, link.source_design_id, pages[0]); }
      catch (error) { await patchColor(admin, colorId, { page_stage: 'recovery' }); throw error; }
      return { ready: true, token, designId: link.source_design_id };
    }
    if (!link.merge_job_id) {
      const before = await listPages(token, productDesign.design_id);
      if (before.some(p => !p.id) || before.length >= 500) throw new CanvaError('Não é possível adicionar outra página a este design.', 422);
      await patchProduct(admin, productId, { pending_color_id: colorId });
      await patchColor(admin, colorId, { page_stage: 'merging', before_page_ids: before.map(p => p.id) });
      const { job } = await api<{ job: MergeJob }>(token, '/merges', { method: 'POST', body: JSON.stringify({
        type: 'modify_existing_design', design_id: productDesign.design_id,
        operations: [{ type: 'insert_pages', source: { type: 'design', design_id: link.source_design_id, page_numbers: [1] } }]
      }) });
      if (!job.id) throw new CanvaError('O Canva não confirmou a inclusão da página.', 502);
      await patchColor(admin, colorId, { merge_job_id: job.id });
      return { ready: false };
    }
    const { job } = await api<{ job: MergeJob }>(token, '/merges/' + encodeURIComponent(link.merge_job_id));
    if (job.status === 'in_progress') return { ready: false };
    if (job.status !== 'success' || job.result?.design.id !== productDesign.design_id) {
      await patchColor(admin, colorId, { page_stage: 'recovery' });
      throw new CanvaError('Não foi possível confirmar a nova página. Confira o design antes de retomar.', 422);
    }
    const pages = await listPages(token, productDesign.design_id);
    const beforeIds = link.before_page_ids;
    if (!beforeIds?.length || new Set(beforeIds).size !== beforeIds.length || beforeIds.some(id => !id)) {
      await patchColor(admin, colorId, { page_stage: 'recovery' });
      throw new CanvaError('Não foi possível confirmar as páginas anteriores do design. Use Vincular página existente para retomar.', 409);
    }
    if (pendingMergedPage(beforeIds, pages)) return { ready: false };
    try { await bindPage(admin, productId, colorId, productDesign.design_id, insertedPage(beforeIds, pages)); }
    catch (error) { await patchColor(admin, colorId, { page_stage: 'recovery' }); throw error; }
    return { ready: true, token, designId: productDesign.design_id };
  });
}

export async function linkColorPage(admin: Admin, userId: string, productId: string, colorId: string, value: string, pageNumber: number) {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 500) throw new CanvaError('Informe o número da página desta cor.');
  const designId = new URL(canvaUrl(value)).pathname.match(/^\/design\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1];
  if (!designId) throw new CanvaError('Cole o link completo de edição do design.');
  const { color, product } = await getColor(admin, productId, colorId);
  const filename = photoFilename(product.sku_optotica, Number(color.color_variant_number), Number(product.frame_total_width_mm));
  const { token, connection: current } = await access(admin, userId);
  await initializeProduct(admin, productId, current);
  return lease(admin, 'canva_product_designs', 'product_id', productId, async () => {
    const target = await productLink(admin, productId); sameAccount(target, current);
    if (target.design_id && target.design_id !== designId) throw new CanvaError('Use o mesmo design já vinculado a este produto.', 409);
    if (target.pending_color_id && target.pending_color_id !== colorId) throw new CanvaError('Conclua a outra cor que está sendo preparada.', 409);
    const existing = await getLink(admin, colorId);
    if (existing) sameAccount(existing, current);
    if (existing?.page_id) throw new CanvaError('Esta cor já tem uma página vinculada.', 409);
    const { design } = await api<{ design: { owner: { user_id: string; team_id: string } } }>(token, '/designs/' + encodeURIComponent(designId));
    if (design.owner.user_id !== current.canva_user_id || design.owner.team_id !== current.canva_team_id) throw new CanvaError('Use um design da conta e equipe conectadas.', 403);
    const page = (await listPages(token, designId)).find(p => p.page_number === pageNumber);
    if (!page) throw new CanvaError('Página não encontrada.', 404);
    requireSquare(page);
    if (!existing) dbError((await admin.from('catalog_canva_designs').insert({ color_id: colorId, product_id: productId,
      user_id: userId, canva_user_id: current.canva_user_id, canva_team_id: current.canva_team_id,
      source_path: color.original_image_path, page_filename: filename })).error);
    await bindPage(admin, productId, colorId, designId, page);
  });
}
