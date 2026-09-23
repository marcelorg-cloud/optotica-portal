import { randomUUID } from 'node:crypto';
import { access, api, BUCKET, dbError, getColor, getLink, getSession, lease, sameAccount, signedPreview,
  type Admin, type Job, type Session } from './api';
import { CanvaError, canvaUrl } from './security';
import { downloadExport, prepareTryonPng } from './image';

export async function openDesign(admin: Admin, userId: string, productId: string, colorId: string) {
  const { color, product } = await getColor(admin, productId, colorId);
  if (!color.original_image_path?.startsWith(productId + '/')) throw new CanvaError('Cadastre a foto original desta cor antes de abrir o Canva.', 422);
  if (!(Number(product.frame_total_width_mm) > 0)) throw new CanvaError('Preencha e salve a Frente Total (mm) no cadastro do produto.', 422);
  const { token, connection: current } = await access(admin, userId);
  const { error: insertError } = await admin.from('catalog_canva_designs').upsert({
    color_id: colorId, product_id: productId, user_id: userId, source_path: color.original_image_path,
    canva_user_id: current.canva_user_id, canva_team_id: current.canva_team_id
  }, { onConflict: 'color_id', ignoreDuplicates: true });
  dbError(insertError);
  return lease(admin, 'catalog_canva_designs', 'color_id', colorId, async () => {
    const link = await getLink(admin, colorId);
    if (!link || link.product_id !== productId) throw new CanvaError('Vínculo de cor inválido.', 409);
    sameAccount(link, current);
    let assetId = link.asset_id, designId = link.design_id;
    const label = [product.sku_optotica, product.model_name, color.color_name, 'Prova online'].filter(Boolean).join(' — ');
    if (!designId && link.creating) {
      throw new CanvaError('A criação anterior foi interrompida. Se o design já existe no Canva, use “Vincular design existente” para recuperá-lo.', 409);
    }
    if (!designId && !assetId) {
      let uploadId = link.upload_job_id;
      if (!uploadId) {
        const { data, error } = await admin.storage.from(BUCKET).download(link.source_path);
        if (error || !data) throw new CanvaError('Não foi possível carregar a foto original.', 422);
        if (data.size > 20 * 1024 * 1024) throw new CanvaError('A foto original deve ter até 20 MB.', 422);
        const bytes = new Uint8Array(await data.arrayBuffer());
        const uploaded = await api<{ job: Job }>(token, '/asset-uploads', {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream',
            'Asset-Upload-Metadata': JSON.stringify({ name_base64: Buffer.from(Array.from(label).slice(0, 50).join('')).toString('base64') }) },
          body: bytes
        });
        uploadId = uploaded.job.id || null;
        assetId = uploaded.job.asset?.id || null;
        if (!uploadId && !assetId) throw new CanvaError('O Canva não confirmou o envio da foto.', 502);
        dbError((await admin.from('catalog_canva_designs').update({ upload_job_id: uploadId, asset_id: assetId }).eq('color_id', colorId)).error);
      }
      if (!assetId && uploadId) {
        const { job } = await api<{ job: Job }>(token, '/asset-uploads/' + encodeURIComponent(uploadId));
        if (job.status === 'failed') {
          dbError((await admin.from('catalog_canva_designs').update({ upload_job_id: null }).eq('color_id', colorId)).error);
          throw new CanvaError('O Canva não conseguiu importar a foto. Tente novamente.', 502);
        }
        if (job.status !== 'success') return { status: 'processing' as const };
        assetId = job.asset?.id || null;
        if (!assetId) throw new CanvaError('O Canva não retornou a foto importada.', 502);
        dbError((await admin.from('catalog_canva_designs').update({ asset_id: assetId }).eq('color_id', colorId)).error);
      }
    }
    if (!designId) {
      dbError((await admin.from('catalog_canva_designs').update({ creating: true }).eq('color_id', colorId)).error);
      const result = await api<{ design: { id: string } }>(token, '/designs', { method: 'POST', body: JSON.stringify({
        design_type: { type: 'custom', width: 1080, height: 1080 }, asset_id: assetId, title: label.slice(0, 255)
      }) });
      designId = result.design.id;
      dbError((await admin.from('catalog_canva_designs').update({ design_id: designId, creating: false }).eq('color_id', colorId)).error);
    }
    const { design } = await api<{ design: { id: string; urls: { edit_url: string } } }>(token, '/designs/' + encodeURIComponent(designId));
    const session = await createSession(admin, userId, productId, colorId);
    const url = new URL(canvaUrl(design.urls.edit_url));
    url.searchParams.set('correlation_state', session.id);
    return { status: 'ready' as const, editUrl: url.toString(), sessionId: session.id };
  });
}

export async function linkExisting(admin: Admin, userId: string, productId: string, colorId: string, value: string) {
  const { color } = await getColor(admin, productId, colorId);
  if (!color.original_image_path) throw new CanvaError('Cadastre a foto original primeiro.', 422);
  const url = new URL(canvaUrl(value));
  const designId = url.pathname.match(/^\/design\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1];
  if (!designId) throw new CanvaError('Cole o link completo de edição do design no Canva.');
  const { token, connection: current } = await access(admin, userId);
  const { design } = await api<{ design: { id: string; owner: { user_id: string; team_id: string } } }>(token, '/designs/' + encodeURIComponent(designId));
  if (design.owner.user_id !== current.canva_user_id || design.owner.team_id !== current.canva_team_id) {
    throw new CanvaError('O design deve pertencer à conta e equipe Canva conectadas.', 403);
  }
  const link = await getLink(admin, colorId);
  if (link?.design_id) throw new CanvaError('Esta cor já tem um design vinculado. Abra a edição existente.', 409);
  if (link) {
    sameAccount(link, current);
    await lease(admin, 'catalog_canva_designs', 'color_id', colorId, async () => {
      const { data, error } = await admin.from('catalog_canva_designs')
        .update({ design_id: design.id, creating: false }).eq('color_id', colorId).is('design_id', null).select('color_id').maybeSingle();
      dbError(error); if (!data) throw new CanvaError('Esta cor já recebeu outro design. Atualize a página.', 409);
    });
  } else {
    dbError((await admin.from('catalog_canva_designs').insert({ color_id: colorId, product_id: productId, user_id: userId,
      canva_user_id: current.canva_user_id, canva_team_id: current.canva_team_id,
      source_path: color.original_image_path, design_id: design.id })).error);
  }
}

export async function createSession(admin: Admin, userId: string, productId: string, colorId: string): Promise<Session> {
  const { color, product } = await getColor(admin, productId, colorId);
  const link = await getLink(admin, colorId);
  if (!link?.design_id || link.product_id !== productId || link.user_id !== userId) throw new CanvaError('Abra o design desta cor no Canva primeiro.', 409);
  if (!color.original_image_path || !(Number(product.frame_total_width_mm) > 0)) throw new CanvaError('Salve a foto original e a Frente Total (mm) antes de continuar.', 422);
  const { data, error } = await admin.from('canva_edit_sessions').insert({
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
      previewUrl: await signedPreview(admin, session.staged_path), sessionId };
    const { token, connection: current } = await access(admin, userId);
    sameAccount(session, current);
    let jobId = session.export_job_id;
    if (!jobId) {
      const { capabilities } = await api<{ capabilities?: string[] }>(token, '/users/me/capabilities');
      if (!capabilities?.includes('export_png_transparency')) {
        throw new CanvaError('Sua conta precisa permitir exportação de PNG transparente (por exemplo, Canva Pro).', 403);
      }
      const { job } = await api<{ job: Job }>(token, '/exports', { method: 'POST', body: JSON.stringify({
        design_id: session.design_id, format: { type: 'png', pages: [1], width: 1080, height: 1080,
          transparent_background: true, lossless: true }
      }) });
      jobId = job.id || null;
      if (!jobId) throw new CanvaError('O Canva não confirmou a exportação.', 502);
      dbError((await admin.from('canva_edit_sessions').update({ export_job_id: jobId }).eq('id', sessionId)).error);
      return { status: 'processing', sessionId };
    }
    const { job } = await api<{ job: Job }>(token, '/exports/' + encodeURIComponent(jobId));
    if (job.status === 'in_progress') return { status: 'processing', sessionId };
    if (job.status === 'failed' || job.urls?.length !== 1) {
      dbError((await admin.from('canva_edit_sessions').update({ export_job_id: null }).eq('id', sessionId)).error);
      throw new CanvaError('A exportação falhou. Confira o plano Canva, os elementos premium e a primeira página do design.', 422);
    }
    let png: Buffer;
    try { png = await prepareTryonPng(await downloadExport(job.urls[0])); }
    catch (error) {
      await admin.from('canva_edit_sessions').update({ export_job_id: null }).eq('id', sessionId);
      throw error;
    }
    const path = session.product_id + '/canva/' + session.color_id + '/' + session.id + '-' + session.frame_width_mm + 'mm.png';
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, png, { contentType: 'image/png', upsert: true });
    dbError(uploadError);
    dbError((await admin.from('canva_edit_sessions').update({ staged_path: path }).eq('id', sessionId)).error);
    return { status: 'ready', sessionId, previewUrl: await signedPreview(admin, path) };
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
