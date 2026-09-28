import { randomUUID } from 'node:crypto';
import { access, api, BUCKET, dbError, getColor, getLink, getSession, lease, sameAccount,
  type Admin, type Connection, type DesignLink, type Job, type Session } from './api';
import { CanvaError, canvaUrl } from './security';
import { downloadExport, prepareTryonPng, rejectReferencePhoto } from './image';
import { ensureColorPage, hasCompletePageMetadata, insertedPage, linkColorPage, listPages, pageById,
  pendingMergedPage, requireSquare, type CanvaPage } from './pages';
import { colorPageDocument, ODP_MIME, photoFilename } from './layout';
import { canvaImageUrl } from './navigation';
import { getTemplate, sameTemplateSnapshot } from './template';

type CanvaOwner = Pick<Connection, 'user_id' | 'canva_user_id' | 'canva_team_id'>;
type ImportJob = { id: string; status: 'success' | 'failed' | 'in_progress'; result?: { designs: { id: string }[] } };
type MergeJob = { id: string; status: 'success' | 'failed' | 'in_progress'; result?: { design: { id: string } } };
type ProductDesign = CanvaOwner & { product_id: string; design_id: string | null; pending_color_id: string | null };
const REDO_START = 'redo:start:';
const REDO_IMPORT = 'redo:import:';
const REDO_FAILED = 'redo:failed:';
const REDO_MARKER = 'redo:v1';
const REDO_START_GRACE_MS = 150000;

function sessionRecord(id: string, userId: string, productId: string, colorId: string,
  color: { original_image_path: string | null; processed_image_path: string | null; processed_at: string | null; color_variant_number: number | null },
  product: { sku_optotica: string; frame_total_width_mm: number | string | null; canva_reference_revision: number | string },
  templateUpdatedAt: string, current: CanvaOwner, designId: string, pageId: string | null) {
  if (!color.original_image_path?.startsWith(productId + '/') || !(Number(product.frame_total_width_mm) > 0)) {
    throw new CanvaError('Salve a foto original e a Frente Total (mm) antes de continuar.', 422);
  }
  return {
    id, sku_snapshot: product.sku_optotica, variant_snapshot: color.color_variant_number,
    reference_revision: product.canva_reference_revision, template_updated_at: templateUpdatedAt,
    page_id: pageId,
    export_filename: photoFilename(product.sku_optotica, Number(color.color_variant_number), Number(product.frame_total_width_mm)),
    color_id: colorId, product_id: productId, user_id: userId, design_id: designId,
    canva_user_id: current.canva_user_id, canva_team_id: current.canva_team_id,
    original_path: color.original_image_path, previous_path: color.processed_image_path,
    previous_processed_at: color.processed_at, frame_width_mm: product.frame_total_width_mm
  };
}

async function insertSession(admin: Admin, record: ReturnType<typeof sessionRecord>) {
  const { data, error } = await admin.from('canva_edit_sessions').insert(record).select('*').single();
  dbError(error); return data as Session;
}

export async function openDesign(admin: Admin, userId: string, productId: string, colorId: string) {
  const result = await ensureColorPage(admin, userId, productId, colorId);
  if (!result.ready || !result.designId || !result.token) return { status: 'processing' as const };
  const { design } = await api<{ design: { urls: { edit_url: string } } }>(result.token, '/designs/' + encodeURIComponent(result.designId));
  const session = await createSession(admin, userId, productId, colorId);
  const url = new URL(canvaUrl(design.urls.edit_url));
  url.searchParams.set('correlation_state', session.id);
  return { status: 'ready' as const, editUrl: url.toString(), sessionId: session.id };
}
export const linkExisting = linkColorPage;

export async function createSession(admin: Admin, userId: string, productId: string, colorId: string): Promise<Session> {
  const [{ color, product }, template] = await Promise.all([getColor(admin, productId, colorId), getTemplate(admin)]);
  measurementPath(productId, product.position_image_path);
  const link = await getLink(admin, colorId);
  if (!link?.design_id || !link.page_id || link.product_id !== productId || link.user_id !== userId) throw new CanvaError('Abra o design desta cor no Canva primeiro.', 409);
  if (link.source_path !== color.original_image_path ||
      Number(link.reference_revision) !== Number(product.canva_reference_revision) ||
      !sameTemplateSnapshot(link.template_updated_at, template?.updated_at)) {
    throw new CanvaError('Esta página foi criada com uma foto, medidas ou imagem modelo antigas. Use Refazer com as referências.', 409);
  }
  return insertSession(admin, sessionRecord(randomUUID(), userId, productId, colorId, color, product, template!.updated_at, link,
    link.design_id, link.page_id));
}

async function requestedSession(admin: Admin, userId: string, sessionId: string) {
  const { data, error } = await admin.from('canva_edit_sessions').select('*')
    .eq('id', sessionId).eq('user_id', userId).maybeSingle();
  dbError(error);
  if (!data) return null;
  const session = data as Session;
  if (new Date(session.expires_at).getTime() <= Date.now()) throw new CanvaError('Esta edição expirou. Clique em Refazer no Canva novamente.', 410);
  return session;
}

function assertSessionBinding(session: Session, productId: string, colorId: string) {
  if (session.product_id !== productId || session.color_id !== colorId) throw new CanvaError('A edição pertence a outra cor.', 403);
}

function assertRedoSession(session: Session) {
  if (!isRedoSession(session)) {
    throw new CanvaError('Esta edição não é um rascunho de refação.', 409);
  }
}

function isRedoSession(session: Session) {
  return session.export_page_ids?.length === 1 && session.export_page_ids[0] === REDO_MARKER;
}

function sameSnapshot(session: Session,
  color: { original_image_path: string | null; processed_image_path: string | null; processed_at: string | null; color_variant_number: number | null },
  product: { sku_optotica: string; frame_total_width_mm: number | string | null; canva_reference_revision: number | string },
  templateUpdatedAt: string | null) {
  return session.original_path === color.original_image_path && session.previous_path === color.processed_image_path &&
    session.previous_processed_at === color.processed_at && Number(session.frame_width_mm) === Number(product.frame_total_width_mm) &&
    session.sku_snapshot !== null && session.sku_snapshot === product.sku_optotica &&
    session.variant_snapshot !== null && Number(session.variant_snapshot) === Number(color.color_variant_number) &&
    session.reference_revision !== null && Number(session.reference_revision) === Number(product.canva_reference_revision) &&
    sameTemplateSnapshot(session.template_updated_at, templateUpdatedAt);
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

function importTitle(sessionId: string) {
  return `Refazer ${sessionId}`;
}

function staleCanonicalLink(link: DesignLink,
  color: { original_image_path: string | null },
  product: { canva_reference_revision: number | string }, templateUpdatedAt: string | null) {
  return link.source_path !== color.original_image_path ||
    Number(link.reference_revision) !== Number(product.canva_reference_revision) ||
    !sameTemplateSnapshot(link.template_updated_at, templateUpdatedAt);
}

function stableBeforeIds(value: string[] | null) {
  return Array.isArray(value) && value.length > 0 && value.every(id => typeof id === 'string' && id.length > 0) &&
    new Set(value).size === value.length;
}

async function pendingProductDesign(admin: Admin, productId: string) {
  const { data, error } = await admin.from('canva_product_designs').select('*')
    .eq('product_id', productId).maybeSingle();
  dbError(error);
  return data as ProductDesign | null;
}

async function recoverStalePendingBeforeRedo(admin: Admin, userId: string, productId: string, colorId: string,
  token: string, current: Connection,
  color: { original_image_path: string | null },
  product: { canva_reference_revision: number | string }, templateUpdatedAt: string | null) {
  const initialProductDesign = await pendingProductDesign(admin, productId);
  if (!initialProductDesign) return { status: 'clear' as const };
  return lease(admin, 'canva_product_designs', 'product_id', productId, async () => {
    const [link, productDesign] = await Promise.all([
      getLink(admin, colorId), pendingProductDesign(admin, productId)
    ]);
    if (!productDesign?.pending_color_id) return { status: 'clear' as const };
    sameAccount(productDesign, current);
    if (productDesign.pending_color_id !== colorId) {
      throw new CanvaError('Outra cor deste produto ainda está sendo preparada. Conclua essa cor antes de refazer.', 409);
    }
    if (!link || link.product_id !== productId || link.user_id !== userId) {
      throw new CanvaError('A preparação pendente desta cor não pôde ser conferida. Tente novamente.', 409);
    }
    sameAccount(link, current);
    if (!staleCanonicalLink(link, color, product, templateUpdatedAt)) {
      throw new CanvaError('A preparação atual desta cor ainda está em andamento. Conclua-a antes de refazer.', 409);
    }

    let outcome: 'abandon' | 'failed' | 'success' | 'ambiguous' = 'abandon';
    let mergedPage: CanvaPage | null = null;
    if (link.merge_job_id) {
      const { job } = await api<{ job: MergeJob }>(token, '/merges/' + encodeURIComponent(link.merge_job_id));
      if (job.status === 'in_progress') return { status: 'processing' as const };
      if (job.status !== 'success' && job.status !== 'failed') return { status: 'processing' as const };
      outcome = job.status === 'success' ? 'ambiguous' : 'failed';
      if (job.status === 'success' && productDesign.design_id && job.result?.design.id === productDesign.design_id &&
          stableBeforeIds(link.before_page_ids)) {
        const pages = await listPages(token, productDesign.design_id);
        if (pendingMergedPage(link.before_page_ids!, pages)) return { status: 'processing' as const };
        try {
          const candidate = insertedPage(link.before_page_ids!, pages);
          requireSquare(candidate);
          mergedPage = candidate;
          outcome = 'success';
        } catch {
          // A terminal merge must release the product even when Canva does not
          // expose one unambiguous, complete page yet. The stale link remains
          // in recovery for manual inspection.
        }
      }
    } else if (link.page_stage === 'merging' || link.before_page_ids !== null) {
      throw new CanvaError('O Canva pode ter iniciado a inclusão desta página, mas não devolveu o identificador do trabalho. Confira o design e vincule a página antes de refazer.', 409);
    }
    const { data, error } = await admin.rpc('recover_stale_canva_pending', {
      p_product_id: productId, p_color_id: colorId,
      p_merge_job_id: link.merge_job_id, p_outcome: outcome,
      p_design_id: mergedPage ? productDesign.design_id : null,
      p_page_id: mergedPage?.id || null, p_page_number: mergedPage?.page_number || null
    });
    dbError(error);
    if (!data) throw new CanvaError('A preparação desta cor mudou durante a recuperação. Tente novamente.', 409);
    return { status: 'clear' as const };
  });
}

async function openRedoSession(admin: Admin, userId: string, session: Session) {
  assertRedoSession(session);
  return lease(admin, 'canva_edit_sessions', 'id', session.id, async () => {
    let fresh = await getSession(admin, userId, session.id);
    assertRedoSession(fresh);
    const { token, connection: current } = await access(admin, userId);
    sameAccount(fresh, current);
    if (fresh.design_id.startsWith(REDO_START)) {
      const createdAt = new Date(fresh.created_at).getTime();
      if (Number.isFinite(createdAt) && createdAt > Date.now() - REDO_START_GRACE_MS) {
        return { status: 'processing' as const, sessionId: fresh.id };
      }
      throw new CanvaError('A criação anterior foi interrompida antes de o Canva confirmá-la. Clique em Refazer no Canva novamente.', 409);
    }
    if (fresh.design_id.startsWith(REDO_FAILED)) {
      throw new CanvaError('O Canva não conseguiu criar esse rascunho. Clique em Refazer no Canva novamente.', 422);
    }
    if (fresh.design_id.startsWith(REDO_IMPORT)) {
      const jobId = fresh.design_id.slice(REDO_IMPORT.length);
      if (!jobId) throw new CanvaError('O Canva não confirmou a criação deste rascunho.', 409);
      const { job } = await api<{ job: ImportJob }>(token, '/imports/' + encodeURIComponent(jobId));
      if (job.status === 'in_progress') return { status: 'processing' as const, sessionId: fresh.id };
      if (job.status !== 'success' || !Array.isArray(job.result?.designs) || job.result.designs.length !== 1) {
        dbError((await admin.from('canva_edit_sessions').update({ design_id: REDO_FAILED + jobId }).eq('id', fresh.id)).error);
        throw new CanvaError('O Canva não conseguiu criar o novo rascunho. Clique em Refazer no Canva novamente.', 422);
      }
      const designId = job.result.designs[0]?.id;
      if (!designId || !/^[A-Za-z0-9_-]{1,200}$/.test(designId)) throw new CanvaError('O Canva retornou um design inválido.', 502);
      const { data: designUpdated, error: designError } = await admin.from('canva_edit_sessions').update({ design_id: designId })
        .eq('id', fresh.id).eq('design_id', fresh.design_id).select('id').maybeSingle();
      dbError(designError);
      if (!designUpdated) throw new CanvaError('Outra atualização alterou este rascunho. Tente abri-lo novamente.', 409);
      fresh = { ...fresh, design_id: designId };
    }
    if (!fresh.page_id) {
      const pages = await listPages(token, fresh.design_id);
      if (pages.length === 0 || (pages.length === 1 && !hasCompletePageMetadata(pages[0]))) {
        return { status: 'processing' as const, sessionId: fresh.id };
      }
      if (pages.length !== 1 || pages[0].page_number !== 1) throw new CanvaError('O novo rascunho deve conter uma única página.', 422);
      requireSquare(pages[0]);
      const { data: pageUpdated, error: pageError } = await admin.from('canva_edit_sessions').update({ page_id: pages[0].id })
        .eq('id', fresh.id).is('page_id', null).select('id').maybeSingle();
      dbError(pageError);
      if (!pageUpdated) throw new CanvaError('Outra atualização alterou a página deste rascunho. Tente abri-lo novamente.', 409);
      fresh = { ...fresh, page_id: pages[0].id! };
    }
    const { design } = await api<{ design: { urls: { edit_url: string } } }>(token,
      '/designs/' + encodeURIComponent(fresh.design_id));
    const url = new URL(canvaUrl(design.urls.edit_url));
    url.searchParams.set('correlation_state', fresh.id);
    return { status: 'ready' as const, editUrl: url.toString(), sessionId: fresh.id };
  });
}

export async function redoDesign(admin: Admin, userId: string, productId: string, colorId: string, sessionId: string) {
  const existing = await requestedSession(admin, userId, sessionId);
  if (existing) {
    assertSessionBinding(existing, productId, colorId);
    assertRedoSession(existing);
    const [{ color, product }, template] = await Promise.all([getColor(admin, productId, colorId), getTemplate(admin)]);
    if (!sameSnapshot(existing, color, product, template?.updated_at || null)) {
      throw new CanvaError('A foto, o SKU, as medidas ou a imagem modelo mudaram. Clique em Refazer no Canva novamente.', 409);
    }
    return openRedoSession(admin, userId, existing);
  }
  const [{ color, product }, { token, connection: current }, template] = await Promise.all([
    getColor(admin, productId, colorId), access(admin, userId), getTemplate(admin)
  ]);
  const pending = await recoverStalePendingBeforeRedo(admin, userId, productId, colorId,
    token, current, color, product, template?.updated_at || null);
  if (pending.status === 'processing') return { status: 'processing' as const, sessionId };
  if (!template?.has_transparency) throw new CanvaError('Cadastre uma imagem modelo PNG transparente de 540 × 540 px.', 422);
  const measurementsPath = measurementPath(productId, product.position_image_path);
  const marker = REDO_START + sessionId;
  const record = { ...sessionRecord(sessionId, userId, productId, colorId, color, product, template.updated_at, current, marker, null),
    export_page_ids: [REDO_MARKER] };
  const [original, measurements] = await Promise.all([
    downloadReference(admin, record.original_path, 'Foto original'),
    downloadReference(admin, measurementsPath, 'Foto de medidas')
  ]);
  const document = await colorPageDocument(Buffer.from(template.png_base64, 'base64'),
    original, measurements, record.export_filename);
  let session: Session;
  try { session = await insertSession(admin, record); }
  catch (error) {
    const raced = await requestedSession(admin, userId, sessionId);
    if (!raced) throw error;
    assertSessionBinding(raced, productId, colorId);
    assertRedoSession(raced);
    return openRedoSession(admin, userId, raced);
  }
  const { job } = await api<{ job: ImportJob }>(token, '/imports', { method: 'POST', headers: {
    'Content-Type': 'application/octet-stream', 'Import-Metadata': JSON.stringify({
      title_base64: Buffer.from(importTitle(sessionId)).toString('base64'), mime_type: ODP_MIME
    })
  }, body: new Uint8Array(document) });
  if (!job.id) throw new CanvaError('O Canva não confirmou a criação do novo rascunho.', 502);
  const { data: updated, error: updateError } = await admin.from('canva_edit_sessions')
    .update({ design_id: REDO_IMPORT + job.id }).eq('id', session.id).eq('design_id', marker).select('id').maybeSingle();
  dbError(updateError);
  if (!updated) throw new CanvaError('Não foi possível confirmar o novo rascunho. Clique em Refazer no Canva novamente.', 409);
  return { status: 'processing' as const, sessionId: session.id };
}
export async function exportSession(admin: Admin, userId: string, sessionId: string) {
  await getSession(admin, userId, sessionId);
  return lease(admin, 'canva_edit_sessions', 'id', sessionId, async () => {
    const session = await getSession(admin, userId, sessionId);
    if (session.staged_path) return { status: session.saved_at ? 'saved' : 'ready',
      previewUrl: canvaImageUrl(session.product_id, session.color_id, 'preview', session.id), filename: session.export_filename, sessionId };
    const { token, connection: current } = await access(admin, userId);
    sameAccount(session, current);
    if (!session.page_id || !session.export_filename) throw new CanvaError('Reabra a página desta cor pelo produto.', 409);
    const pages = await listPages(token, session.design_id);
    const page = pageById(pages, session.page_id);
    requireSquare(page);
    const pageIds = pages.map(p => p.id);
    if (pageIds.some(id => !id)) throw new CanvaError('O Canva não identificou todas as páginas do produto.', 422);
    if (isRedoSession(session) && (pages.length !== 1 || page.id !== session.page_id)) {
      throw new CanvaError('O rascunho de refação deve conter somente a página preparada pelo portal.', 409);
    }
    if (session.export_job_id && JSON.stringify(session.export_page_ids) !== JSON.stringify(pageIds)) {
      dbError((await admin.from('canva_edit_sessions').update({ export_job_id: null, export_page_ids: null }).eq('id', sessionId)).error);
      throw new CanvaError('As páginas mudaram durante a exportação. Importe novamente para conferir a cor correta.', 409);
    }
    let jobId = session.export_job_id;
    if (!jobId) {
      const { capabilities } = await api<{ capabilities?: string[] }>(token, '/users/me/capabilities');
      if (!capabilities?.includes('export_png_transparency')) {
        throw new CanvaError('Sua conta precisa permitir exportação de PNG transparente (por exemplo, Canva Pro).', 403);
      }
      const { job } = await api<{ job: Job }>(token, '/exports', { method: 'POST', body: JSON.stringify({
        design_id: session.design_id, format: { type: 'png', pages: [page.page_number], width: 540, height: 540,
          transparent_background: true, lossless: true }
      }) });
      jobId = job.id || null;
      if (!jobId) throw new CanvaError('O Canva não confirmou a exportação.', 502);
      dbError((await admin.from('canva_edit_sessions').update({ export_job_id: jobId, export_page_ids: pageIds }).eq('id', sessionId)).error);
      return { status: 'processing', sessionId };
    }
    const { job } = await api<{ job: Job }>(token, '/exports/' + encodeURIComponent(jobId));
    if (job.status === 'in_progress') return { status: 'processing', sessionId };
    if (job.status === 'failed' || job.urls?.length !== 1) {
      dbError((await admin.from('canva_edit_sessions').update({ export_job_id: null }).eq('id', sessionId)).error);
      throw new CanvaError('A exportação falhou. Confira o plano Canva, os elementos premium e a página desta cor.', 422);
    }
    let png: Buffer;
    try {
      const input = await downloadExport(job.urls[0]);
      await rejectReferencePhoto(input);
      png = await prepareTryonPng(input);
    }
    catch (error) {
      await admin.from('canva_edit_sessions').update({ export_job_id: null }).eq('id', sessionId);
      throw error;
    }
    const path = session.product_id + '/canva/' + session.color_id + '/' + session.id + '/' + session.export_filename;
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, png, { contentType: 'image/png', upsert: true });
    dbError(uploadError);
    dbError((await admin.from('canva_edit_sessions').update({ staged_path: path }).eq('id', sessionId)).error);
    return { status: 'ready', sessionId, filename: session.export_filename,
      previewUrl: canvaImageUrl(session.product_id, session.color_id, 'preview', session.id) };
  });
}
export async function saveSession(admin: Admin, userId: string, sessionId: string) {
  const session = await getSession(admin, userId, sessionId);
  if (!session.staged_path) throw new CanvaError('Importe e confira a prévia antes de salvar.', 409);
  const { error } = await admin.rpc('save_canva_tryon', { p_session_id: sessionId, p_user_id: userId });
  if (error) {
    if (error.message.includes('CANVA_CONFLICT')) throw new CanvaError('A foto, as medidas ou a imagem modelo mudaram. Importe novamente antes de salvar.', 409);
    throw new CanvaError('Não foi possível salvar esta prévia. Abra novamente pelo produto.', 409);
  }
  return { status: 'saved', productId: session.product_id, colorId: session.color_id };
}
