import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function loadRoute({ admin, processCatalogDisplayPhoto }) {
  const module = { exports: {} };
  const source = fs.readFileSync(
    new URL('../app/api/admin/catalog/products/[productId]/images/[colorImageId]/process/route.ts', import.meta.url),
    'utf8'
  );

  new Function(
    'require',
    'module',
    'exports',
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true
      }
    }).outputText
  )(
    (name) => {
      if (name === 'next/server') {
        return { NextResponse: { json: (body, init) => Response.json(body, init) } };
      }
      if (name === '@/lib/catalog/require-master') {
        return { requireMaster: async () => ({ ok: true, admin }) };
      }
      if (name === '@/lib/catalog/gallery-background-removal') {
        return { processCatalogDisplayPhoto };
      }
      return require(name);
    },
    module,
    module.exports
  );

  return module.exports;
}

function makeAdmin({
  gallery = [],
  existing = [{ position: 1, source_gallery_image_id: null, from_own_color_photo: true }],
  uploadErrorForCall = new Set(),
  insertError = null
} = {}) {
  const uploads = [];
  const removals = [];
  const insertedRows = [];
  let uploadCall = 0;

  function query(table) {
    const state = { mode: 'select', insertRows: null };

    const builder = {
      select() { return this; },
      eq() { return this; },
      order() { return Promise.resolve({ data: gallery, error: null }); },
      maybeSingle() {
        if (table === 'catalog_product_color_images') {
          return Promise.resolve({
            data: { id: 'color-1', original_image_path: 'product/color.webp' },
            error: null
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      insert(rows) {
        state.mode = 'insert';
        state.insertRows = rows;
        insertedRows.push(...rows);
        return this;
      },
      then(resolve, reject) {
        let value;
        if (state.mode === 'insert') {
          value = insertError
            ? { data: null, error: { message: insertError } }
            : {
                data: (state.insertRows || []).map((_, index) => ({ id: `created-${index + 1}` })),
                error: null
              };
        } else if (table === 'catalog_product_color_display_images') {
          value = { data: existing, error: null };
        } else if (table === 'catalog_product_gallery_images') {
          value = { data: gallery, error: null };
        } else {
          value = { data: null, error: null };
        }
        return Promise.resolve(value).then(resolve, reject);
      }
    };

    return builder;
  }

  const admin = {
    from: query,
    storage: {
      from() {
        return {
          async createSignedUrl() {
            return { data: { signedUrl: 'https://storage.test/own.webp' }, error: null };
          },
          async upload(path, buffer) {
            uploadCall += 1;
            uploads.push({ path, buffer });
            if (uploadErrorForCall.has(uploadCall)) {
              return { error: { message: `upload ${uploadCall} failed` } };
            }
            return { error: null };
          },
          async remove(paths) {
            removals.push([...paths]);
            return { error: null };
          }
        };
      }
    }
  };

  return { admin, uploads, removals, insertedRows };
}

async function invoke(POST) {
  return POST(
    new Request('https://example.test/process', { method: 'POST' }),
    { params: Promise.resolve({ productId: 'product-1', colorImageId: 'color-1' }) }
  );
}

test('a bad process and a bad upload do not stop later photos', async () => {
  const fixture = makeAdmin({
    gallery: [
      { id: 'photo-process-fails', image_url: 'https://source.test/process-fails.jpg' },
      { id: 'photo-upload-fails', image_url: 'https://source.test/upload-fails.jpg' },
      { id: 'photo-good', image_url: 'https://source.test/good.jpg' }
    ],
    uploadErrorForCall: new Set([1])
  });

  const calls = [];
  const processCatalogDisplayPhoto = async (url) => {
    calls.push(url);
    if (url.includes('process-fails')) throw new Error('bad source');
    return {
      buffer: Buffer.from('jpeg'),
      aiDurationMs: 123,
      totalDurationMs: 150,
      visibleBoxRatio: 2.4
    };
  };

  const { POST } = loadRoute({ admin: fixture.admin, processCatalogDisplayPhoto });
  const response = await invoke(POST);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls.length, 3);
  assert.equal(fixture.uploads.length, 2);
  assert.equal(fixture.insertedRows.length, 1);
  assert.equal(fixture.insertedRows[0].source_gallery_image_id, 'photo-good');
  assert.equal(body.createdIds.length, 1);
  assert.match(body.message, /1 foto\(s\) processada\(s\)/);
  assert.match(body.message, /2 foto\(s\) não puderam ser processadas/);
});

test('database insert failure removes every file uploaded by that execution', async () => {
  const fixture = makeAdmin({
    gallery: [
      { id: 'photo-a', image_url: 'https://source.test/a.jpg' },
      { id: 'photo-b', image_url: 'https://source.test/b.jpg' }
    ],
    insertError: 'database unavailable'
  });

  const processCatalogDisplayPhoto = async () => ({
    buffer: Buffer.from('jpeg'),
    aiDurationMs: 100,
    totalDurationMs: 120,
    visibleBoxRatio: 2
  });

  const { POST } = loadRoute({ admin: fixture.admin, processCatalogDisplayPhoto });
  const response = await invoke(POST);
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(fixture.uploads.length, 2);
  assert.equal(fixture.removals.length, 1);
  assert.deepEqual(
    new Set(fixture.removals[0]),
    new Set(fixture.uploads.map((item) => item.path))
  );
  assert.match(body.message, /arquivos enviados nesta execução foram removidos/);
});
