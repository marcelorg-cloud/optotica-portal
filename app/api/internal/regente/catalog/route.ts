import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { regentCanvaRunIsAuthorized } from '@/lib/canva/regent';
import { catalogSourcePath, prepareFaithfulCatalogPhoto } from '@/lib/catalog/regent-catalog';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';
const BUCKET = 'catalog-product-photos';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HEADERS = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!UUID.test(body?.runId || '') || typeof body?.token !== 'string' || body.token.length < 32 || body.token.length > 256) return NextResponse.json({ message: 'Credencial de execução inválida.' }, { status: 400, headers: HEADERS });
  const admin = createAdminSupabaseClient();
  const digest = createHash('sha256').update(body.token).digest('hex');
  const now = new Date().toISOString();
  const selected = await admin.from('regent_tool_runs').select('id,task_id,user_id,node_id,step_number,adapter,status,input')
    .eq('id', body.runId).eq('node_id', 'F4').eq('adapter', 'catalog_portal_standardize').eq('status', 'pending')
    .eq('token_hash', digest).gt('token_expires_at', now).maybeSingle();
  if (selected.error || !selected.data) return NextResponse.json({ message: 'Execução inválida, expirada ou já consumida.' }, { status: 403, headers: HEADERS });
  const run = selected.data;
  const [master, task, step] = await Promise.all([
    admin.from('system_admins').select('user_id').eq('user_id', run.user_id).eq('active', true).maybeSingle(),
    admin.from('regent_tasks').select('id,status,pipeline,human_decision,current_step,execution_id,execution_invocation_id,execution_lease_until').eq('id', run.task_id).eq('user_id', run.user_id).maybeSingle(),
    admin.from('regent_task_steps').select('step_number,status,revision').eq('task_id', run.task_id).eq('user_id', run.user_id).eq('step_number', run.step_number).maybeSingle(),
  ]);
  if (master.error || task.error || step.error) return NextResponse.json({ message: 'Não foi possível verificar a autorização.' }, { status: 503, headers: HEADERS });
  if (!master.data || !regentCanvaRunIsAuthorized({ task: task.data, step: step.data, run })) return NextResponse.json({ message: 'Fase, revisão ou invocação não autorizada.' }, { status: 403, headers: HEADERS });
  const phase = Array.isArray(task.data?.pipeline) ? task.data.pipeline.find((item) => item.step === run.step_number) : null;
  const input = run.input as { catalogProductId?: string; catalogColorImageId?: string; catalogMode?: string; stepRevision?: number; executionId?: string };
  if (!phase || phase.nodes?.length !== 1 || phase.nodes[0] !== 'F4' || phase.catalogMode !== 'standardize' ||
    input.catalogMode !== phase.catalogMode || input.catalogProductId !== phase.catalogProductId || input.catalogColorImageId !== phase.catalogColorImageId ||
    !UUID.test(input.catalogProductId || '') || !UUID.test(input.catalogColorImageId || '')) return NextResponse.json({ message: 'Foto e produto devem corresponder exatamente à fase aprovada.' }, { status: 422, headers: HEADERS });
  const source = await admin.from('catalog_product_color_images').select('id,product_id,original_image_path')
    .eq('id', input.catalogColorImageId).eq('product_id', input.catalogProductId).maybeSingle();
  if (source.error || !source.data) return NextResponse.json({ message: 'Foto original deste produto não encontrada.' }, { status: 404, headers: HEADERS });
  let claimed = false;
  try {
    const path = catalogSourcePath(input.catalogProductId!, source.data.original_image_path);
    const claim = await admin.from('regent_tool_runs').update({ status: 'running', token_hash: null, token_expires_at: null, updated_at: now })
      .eq('id', run.id).eq('task_id', run.task_id).eq('user_id', run.user_id).eq('status', 'pending').eq('token_hash', digest)
      .gt('token_expires_at', now).select('id').maybeSingle();
    if (claim.error) throw new Error('Falha ao adquirir a operação.');
    if (!claim.data) return NextResponse.json({ message: 'Execução já consumida; consulte o run original.' }, { status: 409, headers: HEADERS });
    claimed = true;
    const original = await admin.storage.from(BUCKET).download(path);
    if (original.error || !original.data) throw new Error('Não foi possível abrir o original armazenado.');
    const prepared = await prepareFaithfulCatalogPhoto(Buffer.from(await original.data.arrayBuffer()));
    // Recheck the live fence immediately before persistent storage; do not write after a human revocation.
    const [liveTask, liveStep, liveMaster] = await Promise.all([
      admin.from('regent_tasks').select('status,human_decision,current_step,execution_id,execution_invocation_id,execution_lease_until').eq('id', run.task_id).eq('user_id', run.user_id).maybeSingle(),
      admin.from('regent_task_steps').select('step_number,status,revision').eq('task_id', run.task_id).eq('user_id', run.user_id).eq('step_number', run.step_number).maybeSingle(),
      admin.from('system_admins').select('user_id').eq('user_id', run.user_id).eq('active', true).maybeSingle(),
    ]);
    if (liveTask.error || liveStep.error || liveMaster.error || !liveMaster.data || !regentCanvaRunIsAuthorized({ task: liveTask.data, step: liveStep.data, run })) throw new Error('A autorização expirou antes de salvar; nenhuma foto do catálogo foi substituída.');
    const outputPath = `regente/${run.user_id}/${run.task_id}/${run.id}/catalog.jpg`;
    const uploaded = await admin.storage.from(BUCKET).upload(outputPath, prepared.image, { contentType: 'image/jpeg', upsert: false });
    if (uploaded.error) throw new Error('Arquivo não salvo. Confira o caminho do run antes de repetir.');
    const stored = await admin.storage.from(BUCKET).download(outputPath);
    if (stored.error || !stored.data || createHash('sha256').update(Buffer.from(await stored.data.arrayBuffer())).digest('hex') !== prepared.evidence.sha256) throw new Error('Não foi possível confirmar o arquivo salvo; confira o run original.');
    const output = { result: 'Foto padronizada em arquivo separado. Original preservado; confira fidelidade antes de aplicar ao catálogo.',
      runId: run.id, step: run.step_number, revision: step.data?.revision, executionId: input.executionId,
      catalog: { ...prepared.evidence, bucket: BUCKET, path: outputPath, productId: input.catalogProductId,
        colorImageId: input.catalogColorImageId, sourcePath: path },
      notes: [...prepared.evidence.fidelity.limitations, 'Nenhuma foto vigente foi substituída e nenhuma chamada paga ao Replicate foi feita.'] };
    const saved = await admin.from('regent_tool_runs').update({ status: 'succeeded', output, updated_at: new Date().toISOString() })
      .eq('id', run.id).eq('task_id', run.task_id).eq('user_id', run.user_id).eq('status', 'running').select('id').maybeSingle();
    if (saved.error || !saved.data) throw new Error('Arquivo criado, mas evidência não persistida. Confira o caminho original antes de repetir.');
    return NextResponse.json(output, { headers: HEADERS });
  } catch {
    // No raw provider/storage messages or signed URLs in logs or client responses.
    const message = 'Padronização não confirmada. Confira o run e o arquivo separado antes de autorizar nova versão. Original não substituído.';
    if (claimed) {
      const saved = await admin.from('regent_tool_runs').update({ status: 'failed', output: { result: message, originalPreserved: true, outputPath: `regente/${run.user_id}/${run.task_id}/${run.id}/catalog.jpg`, complete: false }, updated_at: new Date().toISOString() }).eq('id', run.id).eq('task_id', run.task_id).eq('user_id', run.user_id).eq('status', 'running').select('id').maybeSingle();
      if (saved.error || !saved.data) return NextResponse.json({ message: 'Não foi possível persistir o diagnóstico. Confira o run original; não autorize repetição automática.' }, { status: 503, headers: HEADERS });
    }
    return NextResponse.json({ message }, { status: 503, headers: HEADERS });
  }
}
