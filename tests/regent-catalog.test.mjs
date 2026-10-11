import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import sharp from 'sharp';
const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText)
    (name => name in mocks ? mocks[name] : require(name), module, module.exports);
  return module.exports;
}
const standard = load('../lib/catalog/display-photo-standard.ts');
const catalog = load('../lib/catalog/regent-catalog.ts', { './display-photo-standard': standard });
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const productId = uuid(1), colorId = uuid(2), owner = uuid(3), taskId = uuid(4), runId = uuid(5);
const security = load('../lib/canva/security.ts');
const { regentCanvaRunIsAuthorized } = load('../lib/canva/regent.ts', { './api': {}, './pages': {}, './security': security });
const token = 'test-capability-token-not-a-real-credential-123';
const digest = value => createHash('sha256').update(value).digest('hex');
async function fixture() {
  const object = await sharp({ create: { width: 600, height: 180, channels: 3, background: '#284e85' } }).png().toBuffer();
  return sharp({ create: { width: 700, height: 280, channels: 3, background: '#ffffff' } }).composite([{ input: object, top: 50, left: 50 }]).png().toBuffer();
}
const NextResponse = { json: (body, init) => Response.json(body, init) };
function database(original, override = {}) {
  const phase = { step: 2, nodes: ['F4'], catalogMode: 'standardize', catalogProductId: productId, catalogColorImageId: colorId };
  const rows = {
    regent_tool_runs: [{ id: runId, task_id: taskId, user_id: owner, node_id: 'F4', step_number: 2, adapter: 'catalog_portal_standardize', status: 'pending',
      token_hash: digest(token), token_expires_at: new Date(Date.now() + 60000).toISOString(),
      input: { catalogMode: 'standardize', catalogProductId: productId, catalogColorImageId: colorId, stepRevision: 1, executionId: uuid(6), executionInvocationId: uuid(7) } }],
    regent_tasks: [{ id: taskId, user_id: owner, status: 'executing', pipeline: [phase], current_step: 2,
      execution_id: uuid(6), execution_invocation_id: uuid(7), execution_lease_until: new Date(Date.now() + 60000).toISOString(),
      human_decision: { approval_scope: 'single_phase', approved_steps: [2], phase_revision: 1 } }],
    regent_task_steps: [{ task_id: taskId, user_id: owner, step_number: 2, status: 'running', revision: 1 }],
    system_admins: [{ user_id: owner, active: true }],
    catalog_product_color_images: [{ id: colorId, product_id: productId, original_image_path: `${productId}/original.png` }],
  };
  const files = new Map([[`${productId}/original.png`, original]]), queries = [], uploads = [];
  const db = { rows, files, queries, uploads, auth: { getUser: async () => ({ data: { user: { id: override.owner || owner } }, error: override.authError || null }) },
    from(table) {
      let values = null; const filters = [];
      const builder = { select() { return builder; }, eq(key, value) { filters.push(row => row[key] === value); return builder; },
        gt(key, value) { filters.push(row => row[key] > value); return builder; },
        update(value) { values = value; return builder; }, maybeSingle() { return execute(true); }, then(resolve, reject) { return execute(false).then(resolve, reject); } };
      async function execute(one) {
        queries.push({ table, values });
        if (override.failTable === table) return { data: null, error: {} };
        const matches = rows[table].filter(row => filters.every(f => f(row)));
        if (values?.status === 'succeeded' && override.failPersist) return { data: null, error: null };
        if (values) matches.forEach(row => Object.assign(row, structuredClone(values)));
        return { data: one ? matches[0] || null : matches, error: null };
      }
      return builder;
    },
    storage: { from(bucket) { assert.equal(bucket, 'catalog-product-photos'); return {
      download: async path => ({ data: files.has(path) ? new Blob([files.get(path)]) : null, error: null }),
      upload: async (path, bytes, options) => { uploads.push(path); assert.equal(options.upsert, false); assert.notEqual(path, `${productId}/original.png`); files.set(path, Buffer.from(bytes)); return { error: null }; },
    }; } },
  };
  return db;
}
const routes = db => ({
  create: load('../app/api/internal/regente/catalog/route.ts', { 'next/server': { NextResponse }, '@/lib/supabase/server': { createAdminSupabaseClient: () => db },
    '@/lib/canva/regent': { regentCanvaRunIsAuthorized }, '@/lib/catalog/regent-catalog': catalog }),
  file: load('../app/api/internal/regente/catalog/file/route.ts', { 'next/server': { NextResponse }, '@/lib/supabase/server': { createAdminSupabaseClient: () => db } }),
});
const request = () => new Request('https://portal.test/api/internal/regente/catalog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId, token }) });
const download = () => new Request(`https://portal.test/api/internal/regente/catalog/file?runId=${runId}`, { headers: { Authorization: 'Bearer authorized-test-session' } });

test('padronização decodifica JPEG real e preserva original, sem chamar IA ou certificar cor', async () => {
  const original = await fixture(), hash = digest(original);
  const result = await catalog.prepareFaithfulCatalogPhoto(original);
  const meta = await sharp(result.image).metadata();
  assert.equal(meta.format, 'jpeg'); assert.equal(meta.width, 1040); assert.equal(meta.height, 320);
  assert.ok(result.image.length <= 200 * 1024); assert.equal(digest(original), hash);
  assert.equal(result.evidence.originalSha256, hash); assert.equal(result.evidence.sha256, digest(result.image));
  assert.equal(result.evidence.colorVerified, false); assert.equal(result.evidence.humanReviewRequired, true);
  assert.equal(result.evidence.paidGenerationPerformed, false);
  const pixel = await sharp(result.image).extract({ left: 520, top: 160, width: 1, height: 1 }).raw().toBuffer();
  // Regression fixture only, not an approved clinical/commercial color tolerance.
  [40, 78, 133].forEach((channel, i) => assert.ok(Math.abs(pixel[i] - channel) <= 3));
});
test('origem é restrita ao produto e formatos inválidos falham antes de salvar', async () => {
  for (const path of ['https://external/image.jpg', `${productId}/../other.jpg`, 'other/original.png', `${productId}/a\\b`]) assert.throws(() => catalog.catalogSourcePath(productId, path));
  await assert.rejects(catalog.prepareFaithfulCatalogPhoto(Buffer.alloc(0)));
  await assert.rejects(catalog.prepareFaithfulCatalogPhoto(Buffer.from('not-image')));
  await assert.rejects(catalog.prepareFaithfulCatalogPhoto(Buffer.alloc(21 * 1024 * 1024)));
});
test('jornada de fronteiras: autorização → foto → arquivo persistido → download autenticado íntegro', async () => {
  const original = await fixture(), db = database(original), route = routes(db);
  const response = await route.create.POST(request()); assert.equal(response.status, 200);
  const output = await response.json(); assert.equal(output.catalog.originalPreserved, true);
  assert.equal(db.rows.regent_tool_runs[0].status, 'succeeded'); assert.equal(db.rows.regent_tool_runs[0].token_hash, null);
  assert.deepEqual(db.files.get(`${productId}/original.png`), original);
  assert.equal(db.queries.some(q => q.table === 'catalog_product_color_images' && q.values), false);
  const file = await route.file.GET(download()); assert.equal(file.status, 200); assert.equal(file.headers.get('content-type'), 'image/jpeg');
  const bytes = Buffer.from(await file.arrayBuffer()); assert.equal(digest(bytes), output.catalog.sha256);
  const metadata = await sharp(bytes).metadata(); assert.equal(metadata.width, 1040);
  assert.equal((await route.create.POST(request())).status, 403); assert.equal(db.uploads.length, 1);
});
test('revisão divergente, Master inativo e consulta falhada não geram arquivos', async () => {
  for (const mode of ['revision', 'master', 'query']) {
    const db = database(await fixture(), mode === 'query' ? { failTable: 'regent_tasks' } : {});
    if (mode === 'revision') db.rows.regent_task_steps[0].revision = 2;
    if (mode === 'master') db.rows.system_admins[0].active = false;
    const response = await routes(db).create.POST(request()); assert.ok([403, 503].includes(response.status));
    assert.equal(db.uploads.length, 0);
  }
});
test('arquivo salvo sem checkpoint confirmado não se torna succeeded', async () => {
  const db = database(await fixture(), { failPersist: true });
  const response = await routes(db).create.POST(request()); assert.equal(response.status, 503);
  assert.equal(db.rows.regent_tool_runs[0].status, 'failed'); assert.equal(db.uploads.length, 1);
  assert.equal((await routes(db).file.GET(download())).status, 404);
});
test('download rejeita outro proprietário e hash alterado, sem URLs assinadas', async () => {
  const db = database(await fixture()); const route = routes(db); await route.create.POST(request());
  const foreign = database(await fixture(), { owner: uuid(99) }); foreign.rows.regent_tool_runs = db.rows.regent_tool_runs;
  assert.equal((await routes(foreign).file.GET(download())).status, 404);
  const path = db.rows.regent_tool_runs[0].output.catalog.path; db.files.set(path, Buffer.from('corrupted'));
  assert.equal((await route.file.GET(download())).status, 409);
});
