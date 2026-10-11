import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCatalogBridge, validCatalogOutput } from '../lib/catalog-bridge.ts';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const expected = { runId: uuid(1), step: 2, revision: 1, executionId: uuid(2), userId: uuid(3), taskId: uuid(4), productId: uuid(5), colorImageId: uuid(6) };
const output = { ...expected, catalog: { complete: true, productId: expected.productId, colorImageId: expected.colorImageId,
  width: 1040, height: 320, bytes: 10000, sha256: 'a'.repeat(64), originalPreserved: true,
  method: 'deterministic_standardize', paidGenerationPerformed: false, published: false, bucket: 'catalog-product-photos',
  path: `regente/${expected.userId}/${expected.taskId}/${expected.runId}/catalog.jpg` } };
function database(rows = [], fail) {
  const calls = [];
  return { rows, calls, from(table) {
    assert.equal(table, 'regent_tool_runs');
    let action = 'select', values, one = false; const filters = [];
    const query = { select() { return query; }, eq(key, value) { filters.push([key, value]); return query; },
      in(key, value) { filters.push([key, value]); return query; },
      insert(value) { action = 'insert'; values = value; return query; }, update(value) { action = 'update'; values = value; return query; },
      single() { one = true; return execute(); }, maybeSingle() { one = true; return execute(); }, then(resolve, reject) { return execute().then(resolve, reject); } };
    async function execute() {
      calls.push({ action, values, filters });
      if (fail?.(action)) return { data: null, error: {} };
      if (action === 'insert') { const row = { id: expected.runId, ...structuredClone(values) }; rows.push(row); return { data: row, error: null }; }
      const matches = rows.filter(row => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
      if (action === 'update') matches.forEach(row => Object.assign(row, structuredClone(values)));
      return { data: one ? matches[0] || null : matches, error: null };
    }
    return query;
  } };
}
const input = db => ({ supabase: db, taskId: expected.taskId, userId: expected.userId,
  step: { step: 2, nodes: ['F4'], catalogMode: 'standardize', catalogProductId: expected.productId, catalogColorImageId: expected.colorImageId },
  revision: 1, executionId: expected.executionId, executionInvocationId: uuid(7) });

test('catálogo exige identidade, hash, caminho canônico e método não generativo', () => {
  assert.equal(validCatalogOutput(output, expected), true);
  for (const value of [null, {}, { ...output, revision: 2 }, { ...output, executionId: uuid(8) },
    ...[{ bytes: 300000 }, { path: 'outra/foto.jpg' }, { originalPreserved: false }, { published: true }, { paidGenerationPerformed: true }, { sha256: 'fake' }]
      .map(patch => ({ ...output, catalog: { ...output.catalog, ...patch } }))]) assert.equal(validCatalogOutput(value, expected), false);
});
test('IDs ausentes ou operações em andamento impedem POST e consumo', async () => {
  let requests = 0; const fetchImpl = () => { requests++; throw new Error(); };
  const db = database();
  await assert.rejects(executeCatalogBridge({ ...input(db), step: { ...input(db).step, catalogProductId: '../outside' }, fetchImpl }), /configuration_required/);
  db.rows.push({ id: uuid(9), task_id: expected.taskId, user_id: expected.userId, step_number: 2, node_id: 'F4', status: 'running' });
  await assert.rejects(executeCatalogBridge({ ...input(db), fetchImpl }), /run_pending/);
  assert.equal(requests, 0); assert.equal(db.calls.some(c => c.action === 'insert'), false);
});
test('HTTP 200 sem persistência não certifica entrega nem promove succeeded', async () => {
  const db = database();
  await assert.rejects(executeCatalogBridge({ ...input(db), fetchImpl: async () => Response.json(output) }), /delivery_unconfirmed/);
  assert.equal(db.rows[0].status, 'failed'); assert.equal(db.rows[0].token_hash, null);
  assert.equal(db.calls.some(c => c.values?.status === 'succeeded'), false);
  for (const call of db.calls.filter(c => c.action !== 'insert')) {
    assert.ok(call.filters.some(([key, value]) => key === 'user_id' && value === expected.userId));
    assert.ok(call.filters.some(([key, value]) => key === 'task_id' && value === expected.taskId));
  }
});
test('resposta perdida reutiliza arquivo canônico, sem repetir operação', async () => {
  const db = database(); let requests = 0;
  const result = await executeCatalogBridge({ ...input(db), fetchImpl: async (_url, options) => {
    requests++; const request = JSON.parse(options.body);
    assert.equal(request.runId, expected.runId); assert.ok(request.token.length >= 32);
    assert.ok(!JSON.stringify(db.rows[0].input).includes(request.token));
    Object.assign(db.rows[0], { status: 'succeeded', output, token_hash: null }); throw new Error('lost response');
  } });
  assert.deepEqual(result, output); assert.equal(requests, 1);
  assert.equal(db.calls.filter(c => c.action === 'update').length, 0);
});
test('falha de leitura canônica ou resposta divergente não inventa sucesso', async () => {
  const db = database([], action => action === 'select' && db.rows.length > 0);
  await assert.rejects(executeCatalogBridge({ ...input(db), fetchImpl: async () => Response.json(output) }), /run_not_verified/);
  const other = database();
  await assert.rejects(executeCatalogBridge({ ...input(other), fetchImpl: async () => {
    Object.assign(other.rows[0], { status: 'succeeded', output }); return Response.json({ ...output, revision: 3 });
  } }), /response_contract_invalid/);
  assert.equal(other.rows[0].status, 'succeeded');
});
