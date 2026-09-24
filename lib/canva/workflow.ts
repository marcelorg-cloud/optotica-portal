import { randomUUID } from 'node:crypto';
import { access, api, BUCKET, dbError, getColor, getLink, getSession, lease, sameAccount, signedPreview,
  type Admin, type Job, type Session } from './api';
import { CanvaError, canvaUrl } from './security';
import { downloadExport, prepareTryonPng, rejectReferencePhoto } from './image';
import { ensureColorPage, linkColorPage, listPages, pageById } from './pages';
import { photoFilename } from './layout';

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
  const { color, product } = await getColor(admin, productId, colorId);
  const link = await getLink(admin, colorId);
  if (!link?.design_id || !link.page_id || link.product_id !== productId || link.user_id !== userId) throw new CanvaError('Abra o design desta cor no Canva primeiro.', 409);
  if (!color.original_image_path || !(Number(product.frame_total_width_mm) > 0)) throw new CanvaError('Salve a foto original e a Frente Total (mm) antes de continuar.', 422);
  const { data, error } = await admin.from('canva_edit_sessions').insert({
    sku_snapshot: product.sku_optotica, variant_snapshot: color.color_variant_number,
    page_id: link.page_id, export_filename: photoFilename(product.sku_optotica, Number(color.color_variant_number), Number(product.frame_total_width_mm)),
    id: randomUUID(), color_id: colorId, product_id: productId, user_id: userId, design_id: link.design_id,
    canva_user_id: link.canva_user_id, canva_team_id: link.canva_team_id,
    original_path: color.original_image_path, previous_path: color.processed_image_path,
    previous_processed_at: color.processed_at, frame_width_mm: product.frame_total_width_mm
  }).select('*').single();
  dbError(error); return data as Session;
}
export async function exportSession(admin: Admin, userId: string, sessionId: string) {
  await getSession(admin, userId, sessionId);
  return lease(admin, 'canva_edit_sessions', 'id', sessionId, async () => {
    const session = await getSession(admin, userId, sessionId);
    if (session.staged_path) return { status: session.saved_at ? 'saved' : 'ready',
      previewUrl: await signedPreview(admin, session.staged_path), filename: session.export_filename, sessionId };
    const { token, connection: current } = await access(admin, userId);
    sameAccount(session, current);
    if (!session.page_id || !session.export_filename) throw new CanvaError('Reabra a página desta cor pelo produto.', 409);
    const pages = await listPages(token, session.design_id);
    const page = pageById(pages, session.page_id);
    const pageIds = pages.map(p => p.id);
    if (pageIds.some(id => !id)) throw new CanvaError('O Canva não identificou todas as páginas do produto.', 422);
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
    return { status: 'ready', sessionId, filename: session.export_filename, previewUrl: await signedPreview(admin, path) };
  });
}
export async function saveSession(admin: Admin, userId: string, sessionId: string) {
  const session = await getSession(admin, userId, sessionId);
  if (!session.staged_path) throw new CanvaError('Importe e confira a prévia antes de salvar.', 409);
  const { error } = await admin.rpc('save_canva_tryon', { p_session_id: sessionId, p_user_id: userId });
  if (error) {
    if (error.message.includes('CANVA_CONFLICT')) throw new CanvaError('A foto ou a medida do produto mudou. Importe novamente antes de salvar.', 409);
    throw new CanvaError('Não foi possível salvar esta prévia. Abra novamente pelo produto.', 409);
  }
  return { status: 'saved', productId: session.product_id, colorId: session.color_id };
}
