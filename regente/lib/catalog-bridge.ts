import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PipelineStep } from './adapters';

export function validCatalogOutput(value: unknown, expected: { runId: string; step: number; revision: number; executionId: string; userId: string; taskId: string; productId: string; colorImageId: string }) {
  const result = value as { runId?: unknown; step?: unknown; revision?: unknown; executionId?: unknown;
    catalog?: { complete?: unknown; productId?: unknown; colorImageId?: unknown; width?: unknown; height?: unknown; bytes?: unknown; sha256?: unknown; originalPreserved?: unknown; bucket?: unknown; path?: unknown; method?: unknown; paidGenerationPerformed?: unknown; published?: unknown } } | null;
  const catalog = result?.catalog;
  return Boolean(result && result.runId === expected.runId && result.step === expected.step && result.revision === expected.revision && result.executionId === expected.executionId &&
    catalog?.complete === true && catalog.productId === expected.productId && catalog.colorImageId === expected.colorImageId &&
    catalog.width === 1040 && catalog.height === 320 && Number.isInteger(catalog.bytes) && Number(catalog.bytes) > 0 && Number(catalog.bytes) <= 200 * 1024 &&
    typeof catalog.sha256 === 'string' && /^[a-f0-9]{64}$/.test(catalog.sha256) && catalog.originalPreserved === true &&
    catalog.method === 'deterministic_standardize' && catalog.paidGenerationPerformed === false && catalog.published === false &&
    catalog.bucket === 'catalog-product-photos' && catalog.path === `regente/${expected.userId}/${expected.taskId}/${expected.runId}/catalog.jpg`);
}

export async function executeCatalogBridge(input: { supabase: SupabaseClient; taskId: string; userId: string; step: PipelineStep;
  revision: number; executionId: string; executionInvocationId: string; fetchImpl?: typeof fetch }) {
  const step = input.step;
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (step.catalogMode !== 'standardize' || !uuid.test(step.catalogProductId || '') || !uuid.test(step.catalogColorImageId || '') ||
    ![input.taskId, input.userId, input.executionId, input.executionInvocationId].every((value) => uuid.test(value)) || !Number.isInteger(input.revision) || input.revision < 1) throw new Error('catalog_configuration_required: informe modo standardize e IDs reais do produto e da foto original. Nenhuma foto foi processada.');
  const active = await input.supabase.from('regent_tool_runs').select('id,status').eq('task_id', input.taskId).eq('user_id', input.userId)
    .eq('step_number', step.step).eq('node_id', 'F4').in('status', ['pending', 'running']);
  if (active.error) throw new Error('catalog_run_read_failed: não foi possível conferir operações anteriores.');
  if (active.data?.length) throw new Error('catalog_run_pending: confira o run original antes de criar outra operação.');
  const origin = new URL(process.env.REGENT_PORTAL_ORIGIN || 'https://app.optotica.com.br');
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('catalog_origin_invalid: origem HTTPS do Portal inválida.');
  const token = randomBytes(32).toString('base64url');
  const digest = createHash('sha256').update(token).digest('hex');
  const created = await input.supabase.from('regent_tool_runs').insert({ task_id: input.taskId, user_id: input.userId,
    step_number: step.step, node_id: 'F4', adapter: 'catalog_portal_standardize', status: 'pending',
    input: { step, catalogMode: step.catalogMode, catalogProductId: step.catalogProductId, catalogColorImageId: step.catalogColorImageId,
      stepRevision: input.revision, executionId: input.executionId, executionInvocationId: input.executionInvocationId },
    token_hash: digest, token_expires_at: new Date(Date.now() + 5 * 60_000).toISOString() }).select('id').single();
  if (created.error || !created.data) throw new Error('catalog_prepare_failed: nenhuma chamada ao Portal foi iniciada.');
  const runId = created.data.id;
  const expected = { runId, step: step.step, revision: input.revision, executionId: input.executionId,
    userId: input.userId, taskId: input.taskId, productId: step.catalogProductId!, colorImageId: step.catalogColorImageId! };
  let payload: unknown = null;
  try {
    const response = await (input.fetchImpl || fetch)(new URL('/api/internal/regente/catalog', origin.origin), {
      method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(110_000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId, token }) });
    if (response.ok) payload = await response.json().catch(() => null);
  } catch { /* Canonical persisted evidence decides whether transport failure lost the response. */ }
  const saved = await input.supabase.from('regent_tool_runs').select('status,output').eq('id', runId).eq('task_id', input.taskId).eq('user_id', input.userId).eq('node_id', 'F4').maybeSingle();
  if (saved.error || !saved.data) throw new Error(`catalog_run_not_verified: confira o run ${runId}; não repetir automaticamente.`);
  if (saved.data.status === 'succeeded' && validCatalogOutput(saved.data.output, expected)) {
    if (payload != null && !validCatalogOutput(payload, expected)) throw new Error('catalog_response_contract_invalid: resposta HTTP diverge da evidência canônica.');
    return saved.data.output;
  }
  const invalidated = await input.supabase.from('regent_tool_runs').update({ status: 'failed', token_hash: null, token_expires_at: null,
    output: { result: 'Portal não consumiu esta credencial. Confira a operação antes de retomar.', complete: false }, updated_at: new Date().toISOString() })
    .eq('id', runId).eq('task_id', input.taskId).eq('user_id', input.userId).eq('status', 'pending').eq('token_hash', digest);
  if (invalidated.error) throw new Error(`catalog_run_not_verified: não foi possível invalidar a credencial do run ${runId}; não repetir automaticamente.`);
  throw new Error(`catalog_delivery_unconfirmed: confira run ${runId}, arquivo salvo e autorização. Original preservado; sem retry automático.`);
}
