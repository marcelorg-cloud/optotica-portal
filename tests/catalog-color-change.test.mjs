import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../app/api/admin/catalog/products/[productId]/images/[colorImageId]/color/route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function setup({ authorized = true, missing = false, duplicate = false, conflict = false } = {}) {
  const writes = [];
  const filters = [];
  const entry = { id: 'new', colorNumber: 3, colorPrincipal: 'Grafite', colorSecondary: null, note: null };
  const admin = { from(table) {
    let updating = false;
    const query = {
      select() { return query; },
      eq(key, value) { filters.push([key, value]); return query; },
      is(key, value) { filters.push([key, value]); return query; },
      update(value) { writes.push(value); updating = true; return query; },
      async maybeSingle() {
        if (table === 'catalog_color_registry') return { data: { id: 'new', color_number: 3, color_principal: 'Grafite', color_secondary: null, note: null } };
        if (updating) return { data: conflict || duplicate ? null : { id: 'image' }, error: duplicate ? { code: '23505' } : null };
        return { data: missing ? null : { id: 'image', color_registry_id: 'old' } };
      }
    };
    return query;
  } };
  const modules = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/catalog/require-master': { requireMaster: async () => authorized ? { ok: true, admin } : { ok: false, status: 403, message: 'Forbidden' } },
    '@/lib/catalog/color-registry': { findOrCreateColorRegistryEntry: async () => ({ ok: true, entry }) },
    '@/lib/catalog/sku-standard': { isValidColor: (value) => ['Preto', 'Grafite'].includes(value) }
  };
  const context = { exports: {}, require: (name) => { assert.ok(modules[name], name); return modules[name]; }, URL, Date };
  vm.runInNewContext(compiled, context);
  const patch = (body = { registryId: 'new' }, origin = 'https://portal.test') => context.exports.PATCH(new Request('https://portal.test/api/color', { method: 'PATCH', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ productId: 'product', colorImageId: 'image' }) });
  return { patch, writes, filters };
}
test('requires master and same origin before modifying a color', async () => {
  for (const options of [{ authorized: false }, {}]) {
    const ctx = setup(options);
    assert.equal((await ctx.patch({}, options.authorized === false ? 'https://portal.test' : 'https://other.test')).status, 403);
    assert.equal(ctx.writes.length, 0);
  }
});
test('does not modify a color outside the specified product', async () => {
  const ctx = setup({ missing: true });
  assert.equal((await ctx.patch()).status, 404);
  assert.equal(ctx.writes.length, 0);
  assert.ok(ctx.filters.some(([key, value]) => key === 'product_id' && value === 'product'));
});
test('changes identity while preserving photos, historical name, and approval state', async () => {
  const ctx = setup();
  assert.equal((await ctx.patch()).status, 200);
  assert.equal(ctx.writes[0].color_registry_id, 'new');
  for (const field of ['color_name', 'original_image_path', 'processed_image_path', 'status', 'is_active']) assert.equal(field in ctx.writes[0], false);
});
test('rejects duplicates and concurrent edits', async () => {
  for (const options of [{ duplicate: true }, { conflict: true }]) assert.equal((await setup(options).patch()).status, 409);
});
test('validates new colors and can create and apply a valid variation', async () => {
  const ctx = setup();
  assert.equal((await ctx.patch({ colorPrincipal: 'invalid' })).status, 400);
  assert.equal(ctx.writes.length, 0);
  assert.equal((await ctx.patch({ colorPrincipal: 'Grafite', note: 'fosco' })).status, 200);
});
