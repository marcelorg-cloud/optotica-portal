import { access, api, BUCKET, canResumeDesignLink, dbError, getColor, getLink, lease, sameAccount,
  type Admin, type DesignLink } from './api';
import { CanvaError, canvaUrl } from './security';
import { colorPageDocument, ODP_MIME, photoFilename, SIZE } from './layout';
import { getTemplate, sameTemplateSnapshot } from './template';

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
function measurementPath(productId: string, path: string | null) {
  if (!path?.startsWith(productId + '/') || path.includes('\\') || path.includes('\0') ||
      path.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw new CanvaError('Cadastre a foto de medidas deste modelo antes de criar ou refazer a página no Canva.', 422);
  }
  return path;
}
async function downloadReference(admin: Admin, path: string, label: string) {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data || data.size === 0 || data.size > 20 * 1024 * 1024) {
    throw new CanvaError(`${label} indisponível ou maior que 20 MB.`, 422);
  }
  return Buffer.from(await data.arrayBuffer());
}
async function assertCurrentReferences(admin: Admin, productId: string, colorId: string, link: {
  source_path: string; reference_revision: number | null; template_updated_at: string | null;
}) {
  const [{ color, product }, template] = await Promise.all([
    getColor(admin, productId, colorId), getTemplate(admin)
  ]);
  if (link.source_path !== color.original_image_path ||
      Number(link.reference_revision) !== Number(product.canva_reference_revision) ||
      !sameTemplateSnapshot(link.template_updated_at, template?.updated_at)) {
    throw new CanvaError('A foto, as medidas ou a imagem modelo mudaram durante a criação no Canva. Use Refazer com as referências.', 409);
  }
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
export function hasCompletePageMetadata(page: CanvaPage) {
  return page.id !== undefined && page.page_number !== undefined && page.dimensions !== undefined &&
    page.dimensions.width !== undefined && page.dimensions.height !== undefined;
}
function samePageIds(beforeIds: string[], pages: CanvaPage[]) {
  if (pages.length !== beforeIds.length || pages.some(page => !page.id)) return false;
  const current = new Set(pages.map(page => page.id!));
  return current.size === beforeIds.length && beforeIds.every(id => current.has(id));
}
export function pendingMergedPage(beforeIds: string[], pages: CanvaPage[]) {
  if (samePageIds(beforeIds, pages)) return true;
  if (pages.length !== beforeIds.length + 1 || beforeIds.some(id => !pages.some(page => page.id === id))) return false;
  const before = new Set(beforeIds);
  const candidates = pages.filter(page => !page.id || !before.has(page.id));
  return candidates.length === 1 && !hasCompletePageMetadata(candidates[0]);
}
export function requireSquare(page: CanvaPage) {
  const width = page.dimensions?.width, height = page.dimensions?.height;
  if (!page.id || !Number.isInteger(page.page_number) || page.page_number < 1 || page.page_number > 500 ||
      typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height) ||
      width !== height || width < SIZE || width > 25000) {
    throw new CanvaError('A página precisa ser quadrada, ter ao menos 540 px por lado e um identificador estável no Canva.', 422);
  }
}
function assertManualMergePage(link: DesignLink, mergeStatus: MergeJob['status'] | null,
  pages: CanvaPage[], selected: CanvaPage) {
  const mustConfirmInsertion = mergeStatus === 'success' ||
    (!link.merge_job_id && (link.page_stage === 'merging' || link.before_page_ids !== null));
  if (!mustConfirmInsertion) return;
  const beforeIds = link.before_page_ids;
  if (!beforeIds?.length || new Set(beforeIds).size !== beforeIds.length || beforeIds.some(id => !id)) {
    throw new CanvaError('Não foi possível conferir quais páginas já existiam antes da inclusão. Confira o design no Canva antes de vincular.', 409);
  }
  if (pendingMergedPage(beforeIds, pages)) {
    throw new CanvaError('A nova página ainda não apareceu por completo no Canva. Aguarde a atualização antes de vincular.', 409);
  }
  try {
    const added = insertedPage(beforeIds, pages);
    requireSquare(added);
    if (added.id !== selected.id) throw new Error('selected page is not the inserted page');
  } catch {
    throw new CanvaError('A página escolhida não é a única página nova desta inclusão. Confira o design no Canva antes de vincular.', 409);
  }
}
async function initializeProduct(admin: Admin, productId: string, current: { user_id: string; canva_user_id: string; canva_team_id: string }) {
  dbError((await admin.from('canva_product_designs').upsert({ product_id: productId, user_id: current.user_id,
    canva_user_id: current.canva_user_id, canva_team_id: current.canva_team_id }, { onConflict: 'product_id', ignoreDuplicates: true })).error);
}
type BindingSnapshot = Pick<DesignLink, 'source_path' | 'reference_revision' | 'template_updated_at' |
  'page_stage' | 'import_job_id' | 'merge_job_id' | 'before_page_ids'>;
async function bindPage(admin: Admin, productId: string, colorId: string, designId: string, page: CanvaPage,
  snapshot: BindingSnapshot, references: Pick<BindingSnapshot, 'source_path' | 'reference_revision' | 'template_updated_at'> = snapshot,
  manualReferenceOverride = false) {
  requireSquare(page);
  const { data, error } = await admin.rpc('bind_canva_page', {
    p_product_id: productId, p_color_id: colorId, p_design_id: designId,
    p_page_id: page.id, p_page_number: page.page_number,
    p_source_path: references.source_path, p_reference_revision: references.reference_revision,
    p_template_updated_at: references.template_updated_at,
    p_expected_source_path: snapshot.source_path,
    p_expected_reference_revision: snapshot.reference_revision,
    p_expected_template_updated_at: snapshot.template_updated_at,
    p_manual_reference_override: manualReferenceOverride,
    p_page_stage: snapshot.page_stage,
    p_import_job_id: snapshot.import_job_id, p_merge_job_id: snapshot.merge_job_id,
    p_before_page_ids: snapshot.before_page_ids
  });
  dbError(error);
  if (!data) {
    throw new CanvaError('As referências ou o andamento da criação mudaram no Canva. Confira a página antes de continuar.', 409);
  }
}
export async function ensureColorPage(admin: Admin, userId: string, productId: string, colorId: string) {
  const [{ color, product }, template] = await Promise.all([getColor(admin, productId, colorId), getTemplate(admin)]);
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
    if (link && (link.page_id || link.source_design_id || link.import_job_id || link.merge_job_id)) {
      await assertCurrentReferences(admin, productId, colorId, link);
    }
    if (link?.page_id && link.design_id) {
      if (link.source_path !== color.original_image_path ||
          Number(link.reference_revision) !== Number(product.canva_reference_revision) ||
          !sameTemplateSnapshot(link.template_updated_at, template?.updated_at)) {
        throw new CanvaError('Esta página foi criada com uma foto, medidas ou imagem modelo antigas. Use Refazer com as referências.', 409);
      }
      if (productDesign.design_id && productDesign.design_id !== link.design_id) throw new CanvaError('Vínculo do produto divergente.', 409);
      const page = pageById(await listPages(token, link.design_id), link.page_id);
      await assertCurrentReferences(admin, productId, colorId, link);
      await bindPage(admin, productId, colorId, link.design_id, page, link);
      return { ready: true, token, designId: link.design_id };
    }
    if (!link) {
      measurementPath(productId, product.position_image_path);
      if (!template?.has_transparency) throw new CanvaError('Cadastre uma imagem modelo PNG transparente de 540 × 540 px.', 422);
      dbError((await admin.from('catalog_canva_designs').insert({ color_id: colorId, product_id: productId, user_id: userId,
        canva_user_id: current.canva_user_id, canva_team_id: current.canva_team_id, source_path: color.original_image_path,
        page_filename: filename, template_updated_at: template.updated_at,
        reference_revision: product.canva_reference_revision })).error);
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
        const measurementsPath = measurementPath(productId, product.position_image_path);
        if (!template?.has_transparency) throw new CanvaError('Substitua a imagem modelo por um PNG transparente.', 422);
        if (link.source_path !== color.original_image_path ||
            Number(link.reference_revision) !== Number(product.canva_reference_revision) ||
            !sameTemplateSnapshot(link.template_updated_at, template.updated_at)) {
          await patchColor(admin, colorId, { source_path: color.original_image_path,
            reference_revision: product.canva_reference_revision, template_updated_at: template.updated_at });
          link = { ...link, source_path: color.original_image_path,
            reference_revision: Number(product.canva_reference_revision), template_updated_at: template.updated_at };
        }
        const [original, measurements] = await Promise.all([
          downloadReference(admin, link.source_path, 'Foto original'),
          downloadReference(admin, measurementsPath, 'Foto de medidas')
        ]);
        const document = await colorPageDocument(Buffer.from(template.png_base64, 'base64'), original, measurements, filename);
        await patchProduct(admin, productId, { pending_color_id: colorId });
        await patchColor(admin, colorId, { page_stage: 'importing', creating: true, page_filename: filename, template_updated_at: template.updated_at });
        const { job } = await api<{ job: ImportJob }>(token, '/imports', { method: 'POST', headers: {
          'Content-Type': 'application/octet-stream', 'Import-Metadata': JSON.stringify({
            title_base64: Buffer.from(Array.from(`${product.sku_optotica} — Prova online`).slice(0, 50).join('')).toString('base64'), mime_type: ODP_MIME }) },
          body: new Uint8Array(document) });
        if (!job.id) throw new CanvaError('O Canva não confirmou a criação.', 502);
        await patchColor(admin, colorId, { import_job_id: job.id });
        await assertCurrentReferences(admin, productId, colorId, link);
        return { ready: false };
      }
      const { job } = await api<{ job: ImportJob }>(token, '/imports/' + encodeURIComponent(link.import_job_id));
      await assertCurrentReferences(admin, productId, colorId, link);
      if (job.status === 'in_progress') return { ready: false };
      if (job.status !== 'success' || job.result?.designs.length !== 1) {
        await patchColor(admin, colorId, { page_stage: 'recovery' });
        throw new CanvaError('O Canva não conseguiu preparar a página. Confira o design antes de retomar.', 422);
      }
      link = { ...link, source_design_id: job.result.designs[0].id, page_stage: 'imported' };
      await patchColor(admin, colorId, { source_design_id: link.source_design_id, page_stage: link.page_stage });
    }
    const sourceDesignId = link.source_design_id;
    if (!sourceDesignId) throw new CanvaError('O Canva não confirmou o design preparado para esta cor.', 409);
    if (!productDesign.design_id) {
      const pages = await listPages(token, sourceDesignId);
      await assertCurrentReferences(admin, productId, colorId, link);
      if (pages.length === 0 || (pages.length === 1 && !hasCompletePageMetadata(pages[0]))) return { ready: false };
      if (pages.length !== 1 || pages[0].page_number !== 1) {
        await patchColor(admin, colorId, { page_stage: 'recovery' });
        throw new CanvaError('A importação deve conter uma única página.', 422);
      }
      try { requireSquare(pages[0]); }
      catch (error) {
        await patchColor(admin, colorId, { page_stage: 'recovery' });
        throw error;
      }
      await bindPage(admin, productId, colorId, sourceDesignId, pages[0], link);
      return { ready: true, token, designId: sourceDesignId };
    }
    if (!link.merge_job_id) {
      const before = await listPages(token, productDesign.design_id);
      await assertCurrentReferences(admin, productId, colorId, link);
      if (before.some(p => !p.id) || before.length >= 500) throw new CanvaError('Não é possível adicionar outra página a este design.', 422);
      await patchProduct(admin, productId, { pending_color_id: colorId });
      await patchColor(admin, colorId, { page_stage: 'merging', before_page_ids: before.map(p => p.id) });
      const { job } = await api<{ job: MergeJob }>(token, '/merges', { method: 'POST', body: JSON.stringify({
        type: 'modify_existing_design', design_id: productDesign.design_id,
        operations: [{ type: 'insert_pages', source: { type: 'design', design_id: sourceDesignId, page_numbers: [1] } }]
      }) });
      if (!job.id) throw new CanvaError('O Canva não confirmou a inclusão da página.', 502);
      await patchColor(admin, colorId, { merge_job_id: job.id });
      await assertCurrentReferences(admin, productId, colorId, link);
      return { ready: false };
    }
    const { job } = await api<{ job: MergeJob }>(token, '/merges/' + encodeURIComponent(link.merge_job_id));
    await assertCurrentReferences(admin, productId, colorId, link);
    if (job.status === 'in_progress') return { ready: false };
    if (job.status !== 'success' || job.result?.design.id !== productDesign.design_id) {
      await patchColor(admin, colorId, { page_stage: 'recovery' });
      throw new CanvaError('Não foi possível confirmar a nova página. Confira o design antes de retomar.', 422);
    }
    const pages = await listPages(token, productDesign.design_id);
    await assertCurrentReferences(admin, productId, colorId, link);
    const beforeIds = link.before_page_ids;
    if (!beforeIds?.length || new Set(beforeIds).size !== beforeIds.length || beforeIds.some(id => !id)) {
      await patchColor(admin, colorId, { page_stage: 'recovery' });
      throw new CanvaError('Não foi possível confirmar as páginas anteriores do design. Use Vincular página existente para retomar.', 409);
    }
    if (pendingMergedPage(beforeIds, pages)) return { ready: false };
    let page: CanvaPage;
    try {
      page = insertedPage(beforeIds, pages);
      requireSquare(page);
    } catch (error) {
      await patchColor(admin, colorId, { page_stage: 'recovery' });
      throw error;
    }
    await bindPage(admin, productId, colorId, productDesign.design_id, page, link);
    return { ready: true, token, designId: productDesign.design_id };
  });
}

export async function linkColorPage(admin: Admin, userId: string, productId: string, colorId: string, value: string, pageNumber: number) {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 500) throw new CanvaError('Informe o número da página desta cor.');
  const designId = new URL(canvaUrl(value)).pathname.match(/^\/design\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1];
  if (!designId) throw new CanvaError('Cole o link completo de edição do design.');
  const [{ color, product }, template] = await Promise.all([getColor(admin, productId, colorId), getTemplate(admin)]);
  if (!color.original_image_path?.startsWith(productId + '/')) throw new CanvaError('Cadastre a foto original desta cor.', 422);
  measurementPath(productId, product.position_image_path);
  if (!template?.has_transparency) throw new CanvaError('Cadastre uma imagem modelo PNG transparente de 540 × 540 px.', 422);
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
    let mergeStatus: MergeJob['status'] | null = null;
    if (existing?.merge_job_id) {
      const { job } = await api<{ job: MergeJob }>(token, '/merges/' + encodeURIComponent(existing.merge_job_id));
      if (job.status === 'in_progress' || (job.status !== 'success' && job.status !== 'failed')) {
        throw new CanvaError('A inclusão desta página ainda está sendo processada no Canva. Aguarde a conclusão e confira o design antes de vincular manualmente.', 409);
      }
      if (job.status === 'success' && job.result?.design?.id !== designId) {
        throw new CanvaError('O Canva concluiu a inclusão em outro design. Confira o link antes de vincular manualmente.', 409);
      }
      mergeStatus = job.status;
    }
    const { design } = await api<{ design: { owner: { user_id: string; team_id: string } } }>(token, '/designs/' + encodeURIComponent(designId));
    if (design.owner.user_id !== current.canva_user_id || design.owner.team_id !== current.canva_team_id) throw new CanvaError('Use um design da conta e equipe conectadas.', 403);
    const pages = await listPages(token, designId);
    const page = pages.find(p => p.page_number === pageNumber);
    if (!page) throw new CanvaError('Página não encontrada.', 404);
    if (existing) assertManualMergePage(existing, mergeStatus, pages, page);
    requireSquare(page);
    const references = { source_path: color.original_image_path,
      reference_revision: product.canva_reference_revision, template_updated_at: template.updated_at };
    if (!existing) dbError((await admin.from('catalog_canva_designs').insert({ color_id: colorId, product_id: productId,
      user_id: userId, canva_user_id: current.canva_user_id, canva_team_id: current.canva_team_id,
      ...references, page_filename: filename })).error);
    // Choosing a page explicitly is the master's confirmation that this Canva
    // result belongs to the current references. The RPC compares the old link
    // snapshot and records the current one in the same transaction as binding.
    await bindPage(admin, productId, colorId, designId, page, existing || {
      ...references, page_stage: 'idle', import_job_id: null, merge_job_id: null, before_page_ids: null
    }, references, true);
  });
}
