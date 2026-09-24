import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
const require = createRequire(import.meta.url), ts = require('typescript'), sharp = require('sharp');
function load(file, mocks = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  new Function('require', 'module', 'exports', output)(name => mocks[name] ?? require(name), module, module.exports);
  return module.exports;
}
const security = load('../lib/canva/security.ts');
const key = '4a'.repeat(32);
const productId = '11111111-1111-4111-8111-111111111111', colorId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
test('OAuth tokens are encrypted and bound to the user and token purpose', () => {
  const sealed = security.encrypt('secret-token', key, 'master:access');
  assert.equal(security.decrypt(sealed, key, 'master:access'), 'secret-token');
  assert.throws(() => security.decrypt(sealed, key, 'other:access'));
  assert.throws(() => security.decrypt(sealed, key, 'master:refresh'));
  assert.throws(() => security.decrypt(sealed, 'ff'.repeat(32), 'master:access'));
  const parts = sealed.split('.'); const body = Buffer.from(parts[2], 'base64url'); body[0] ^= 1;
  parts[2] = body.toString('base64url');
  assert.throws(() => security.decrypt(parts.join('.'), key, 'master:access'));
});
test('PKCE matches the published RFC 7636 example', () => {
  assert.equal(security.challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
test('mutations reject foreign and missing origins', () => {
  assert.equal(security.sameOrigin(new Request('https://portal.test/api', { headers: { origin: 'https://portal.test' } })), true);
  assert.equal(security.sameOrigin(new Request('https://portal.test/api', { headers: { origin: 'https://evil.test' } })), false);
  assert.equal(security.sameOrigin(new Request('https://portal.test/api')), false);
});
test('only authenticated HTTPS Canva hosts can be used for export and editing', () => {
  assert.equal(security.canvaUrl('https://export-download.canva.com/result.png?signature=x'), 'https://export-download.canva.com/result.png?signature=x');
  for (const url of ['http://canva.com/x', 'https://canva.com.evil.test/x', 'https://canva.com@evil.test/x',
    'https://127.0.0.1/x', 'https://canva.com:444/x', 'https://user:password@canva.com/x']) assert.throws(() => security.canvaUrl(url));
});
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'key-1', alg: 'RS256', use: 'sig' };
const claims = { aud: 'app', exp: 2000, sub: 'canva-user', team_id: 'team', type: 'rti', jti: 'jwt-id',
  design_id: 'D123', correlation_state: sessionId };
function jwt(payload = claims, header = { alg: 'RS256', kid: 'key-1' }) {
  const data = [header, payload].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
  return data + '.' + sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url');
}
test('Canva return verifies signature, audience, expiry, type and correlation ID', () => {
  assert.deepEqual(security.verifyReturnJwt(jwt(), [jwk], 'app', 1000), claims);
  assert.throws(() => security.verifyReturnJwt(jwt(), [jwk], 'another-app', 1000));
  assert.throws(() => security.verifyReturnJwt(jwt(), [jwk], 'app', 2000));
  assert.throws(() => security.verifyReturnJwt(jwt({ ...claims, type: 'other' }), [jwk], 'app', 1000));
  assert.throws(() => security.verifyReturnJwt(jwt({ ...claims, correlation_state: '//evil' }), [jwk], 'app', 1000));
  assert.throws(() => security.verifyReturnJwt(jwt(claims, { alg: 'none', kid: 'key-1' }), [jwk], 'app', 1000));
  const parts = jwt().split('.'); parts[1] = Buffer.from(JSON.stringify({ ...claims, design_id: 'D_OTHER' })).toString('base64url');
  assert.throws(() => security.verifyReturnJwt(parts.join('.'), [jwk], 'app', 1000));
});
const image = load('../lib/canva/image.ts', { './security': security });
test('opaque, blank and non-PNG exports cannot become try-on images', async () => {
  const opaque = await sharp({ create: { width: 50, height: 50, channels: 4, background: '#fff' } }).png().toBuffer();
  const empty = await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  await assert.rejects(image.prepareTryonPng(opaque), /transparência/);
  await assert.rejects(image.prepareTryonPng(empty), /vazia/);
  await assert.rejects(image.prepareTryonPng(await sharp(opaque).jpeg().toBuffer()), /PNG/);
});
test('transparent margins are normalized while preserving navy pixels and lens holes', async () => {
  const width = 100, height = 100, raw = Buffer.alloc(width * height * 4);
  for (let y = 40; y < 60; y++) for (let x = 10; x < 90; x++) {
    if (x > 20 && x < 40 && y > 44 && y < 56) continue;
    const i = (y * width + x) * 4; raw[i] = 30; raw[i + 1] = 40; raw[i + 2] = 80; raw[i + 3] = 255;
  }
  const input = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const output = await image.prepareTryonPng(input), metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 540); assert.equal(metadata.height, 540); assert.equal(metadata.hasAlpha, true);
  const pixels = await sharp(output).ensureAlpha().raw().toBuffer();
  const pixel = (x, y) => [...pixels.subarray((y * 540 + x) * 4, (y * 540 + x) * 4 + 4)];
  assert.deepEqual(pixel(325, 270), [30, 40, 80, 255]);
  assert.equal(pixel(135, 270)[3], 0); assert.equal(pixel(270, 5)[3], 0);
  assert.equal(pixel(0, 270)[3], 255); assert.equal(pixel(539, 270)[3], 255);
});
test('a completed preview is reused without issuing another paid export', async () => {
  const session = { id: sessionId, staged_path: 'prepared.png', saved_at: null };
  const workflow = load('../lib/canva/workflow.ts', { './security': security, './image': {}, './pages': {}, './layout': {},
    './api': { getSession: async () => session, lease: async (_a, _t, _c, _id, fn) => fn(),
      signedPreview: async () => 'https://preview.test/prepared.png',
      access: () => { throw Error('unexpected Canva request'); } } });
  const result = await workflow.exportSession({}, 'master', sessionId);
  assert.equal(result.status, 'ready'); assert.equal(result.previewUrl, 'https://preview.test/prepared.png');
});
test('saving requires a prepared preview and reports stale-photo conflicts', async () => {
  let session = { id: sessionId, staged_path: null, product_id: productId, color_id: colorId };
  const workflow = load('../lib/canva/workflow.ts', { './security': security, './image': {}, './pages': {}, './layout': {},
    './api': { getSession: async () => session } });
  await assert.rejects(workflow.saveSession({}, 'master', sessionId), /prévia/);
  session.staged_path = 'prepared.png';
  await assert.rejects(workflow.saveSession({ rpc: async () => ({ error: { message: 'CANVA_CONFLICT' } }) }, 'master', sessionId), /mudou/);
});
test('master authorization and session-color binding precede export or save', async () => {
  let auth = { ok: false, status: 403, message: 'forbidden' };
  const route = load('../app/api/admin/catalog/canva/route.ts', {
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '@/lib/catalog/require-master': { requireMaster: async () => auth },
    '@/lib/canva/security': security, '@/lib/canva/template': {}, '@/lib/canva/layout': {},
    '@/lib/canva/api': { getColor: async () => ({}), getSession: async () => ({ product_id: productId, color_id: 'other' }) },
    '@/lib/canva/workflow': { exportSession: () => { throw Error('unexpected export'); } }
  });
  const request = () => new Request('https://portal.test/api', { method: 'POST',
    headers: { origin: 'https://portal.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'export', productId, colorId, sessionId }) });
  assert.equal((await route.POST(request())).status, 403);
  auth = { ok: true, userId: 'master', admin: {} };
  const response = await route.POST(request()); assert.equal(response.status, 403);
  assert.match((await response.json()).message, /outra cor/);
});
const layout = load('../lib/canva/layout.ts', { './security': security });
const pagesModule = load('../lib/canva/pages.ts', { './security': security, './api': {}, './layout': layout, './template': {} });
test('filenames use the existing color SKU and actual physical width', () => {
  assert.equal(layout.photoFilename('GE-AC-003', 2, 113), 'GE-AC-003-C2-113mm.png');
  assert.equal(layout.photoFilename('GE-AC-003', 2, 95), 'GE-AC-003-C2-095mm.png');
  assert.equal(layout.photoFilename('GE-AC-003', 2, 113.5), 'GE-AC-003-C2-113.5mm.png');
  for (const args of [['GE', 0, 113], ['GE', 1, 0], ['GE', 1, NaN]]) assert.throws(() => layout.photoFilename(...args));
});
async function transparentModel() {
  const raw = Buffer.alloc(540 * 540 * 4);
  for (let y = 185; y < 345; y++) for (let x = 0; x < 540; x++) {
    if (y > 200 && y < 330 && x > 20 && x < 520) continue;
    raw[(y * 540 + x) * 4 + 3] = 255;
  }
  return sharp(raw, { raw: { width: 540, height: 540, channels: 4 } }).png().toBuffer();
}
test('model validation detects a white PNG even if the file extension is correct', async () => {
  const white = await sharp({ create: { width: 540, height: 540, channels: 3, background: '#fff' } }).png().toBuffer();
  assert.equal((await layout.inspectTemplate(white)).hasTransparency, false);
  assert.equal((await layout.inspectTemplate(await transparentModel())).hasTransparency, true);
  await assert.rejects(layout.inspectTemplate(await sharp(white).resize(1080, 1080).png().toBuffer()));
});
test('page document contains two independent images, exact square geometry and a named page', async () => {
  const model = await transparentModel();
  const original = await sharp({ create: { width: 600, height: 300, channels: 3, background: '#a06020' } }).jpeg().toBuffer();
  const document = await layout.colorPageDocument(model, original, 'GE-AC-003-C2-113mm.png');
  const zip = await require('jszip').loadAsync(document);
  assert.equal(await zip.file('mimetype').async('string'), layout.ODP_MIME);
  assert.deepEqual(await zip.file('Pictures/model.png').async('nodebuffer'), model);
  const content = await zip.file('content.xml').async('string');
  assert.equal((content.match(/<draw:frame /g) || []).length, 2);
  assert.match(content, /draw:name="GE-AC-003-C2-113mm.png"/);
  assert.match(content, /draw:fill="none"/);
  const styles = await zip.file('styles.xml').async('string');
  assert.match(styles, /fo:page-width="5.625in" fo:page-height="5.625in"/);
});
test('stable page IDs survive reordering and ambiguous additions are rejected', () => {
  const pages = [{ id: 'B', page_number: 1 }, { id: 'A', page_number: 2 }];
  assert.equal(pagesModule.pageById(pages, 'A').page_number, 2);
  assert.throws(() => pagesModule.pageById(pages, 'DELETED'));
  assert.equal(pagesModule.insertedPage(['A'], pages).id, 'B');
  assert.throws(() => pagesModule.insertedPage(['A'], [...pages, { id: 'C', page_number: 3 }]));
  assert.throws(() => pagesModule.insertedPage(['A', 'DELETED'], pages));
});
test('the corner reference must be removed before preparing the final PNG', async () => {
  const model = await transparentModel();
  await image.rejectReferencePhoto(model);
  const reference = await sharp({ create: { width: 100, height: 70, channels: 4, background: '#fff' } }).png().toBuffer();
  const composite = await sharp(model).composite([{ input: reference, left: 400, top: 42 }]).png().toBuffer();
  await assert.rejects(image.rejectReferencePhoto(composite), /foto pequena/);
});
test('export selects the page ID for this color and uses 540 square transparent output', async () => {
  const session = { id: sessionId, page_id: 'B', export_filename: 'GE-AC-003-C2-113mm.png', design_id: 'D', export_job_id: null };
  const calls = [];
  const admin = { from: () => ({ update: fields => { calls.push(fields); return { eq: async () => ({ error: null }) }; } }) };
  const workflow = load('../lib/canva/workflow.ts', { './security': security, './image': {}, './layout': layout,
    './pages': { ...pagesModule, listPages: async () => [{ id: 'A', page_number: 1 }, { id: 'B', page_number: 2 }] },
    './api': { getSession: async () => session, lease: async (_a, _b, _c, _d, run) => run(),
      access: async () => ({ token: 't', connection: {} }), sameAccount: () => {}, dbError: () => {},
      api: async (_token, path, init) => {
        if (path === '/users/me/capabilities') return { capabilities: ['export_png_transparency'] };
        calls.push(JSON.parse(init.body)); return { job: { id: 'export-job' } };
      } }
  });
  assert.equal((await workflow.exportSession(admin, 'master', sessionId)).status, 'processing');
  assert.deepEqual(calls[0].format, { type: 'png', pages: [2], width: 540, height: 540, transparent_background: true, lossless: true });
  assert.deepEqual(calls[1].export_page_ids, ['A', 'B']);
  session.export_job_id = 'export-job'; session.export_page_ids = ['B', 'A'];
  await assert.rejects(workflow.exportSession(admin, 'master', sessionId), /páginas mudaram/);
});
test('two colors append to one product design, while a pending color blocks concurrent creation', async () => {
  const color2 = '44444444-4444-4444-8444-444444444444';
  const db = { canva_product_designs: new Map(), catalog_canva_designs: new Map() };
  const calls = [], designPages = new Map([['D1', [{ id: 'P1', page_number: 1, dimensions: { width: 540, height: 540 } }]]]);
  const photo = await sharp({ create: { width: 300, height: 150, channels: 3, background: '#654321' } }).png().toBuffer();
  const current = { user_id: 'master', canva_user_id: 'cu', canva_team_id: 'ct' };
  const admin = {
    storage: { from: () => ({ download: async () => ({ data: new Blob([photo]), error: null }) }) },
    from: name => {
      const table = db[name], key = name === 'canva_product_designs' ? 'product_id' : 'color_id';
      return {
        upsert: async data => { if (!table.has(data[key])) table.set(data[key], { ...data }); return { error: null }; },
        insert: async data => { table.set(data[key], { page_stage: 'idle', ...data }); return { error: null }; },
        select: () => ({ eq: (_key, id) => ({ single: async () => ({ data: { ...table.get(id) }, error: null }) }) }),
        update: data => ({ eq: async (_key, id) => { Object.assign(table.get(id), data); return { error: null }; } })
      };
    }
  };
  let imports = 0;
  const p = load('../lib/canva/pages.ts', { './security': security, './layout': layout,
    './template': { getTemplate: async () => ({ has_transparency: true, updated_at: '2026-09-23', png_base64: (await transparentModel()).toString('base64') }) },
    './api': {
      access: async () => ({ token: 'token', connection: current }), sameAccount: () => {}, BUCKET: 'bucket',
      dbError: error => { if (error) throw error; },
      getColor: async (_admin, _productId, id) => ({ color: { id, color_variant_number: id === colorId ? 1 : 2, original_image_path: productId + '/' + id + '.png' }, product: { sku_optotica: 'GE-AC-003', frame_total_width_mm: 113 } }),
      getLink: async (_admin, id) => { const row = db.catalog_canva_designs.get(id); return row ? { ...row } : null; },
      lease: async (_admin, table, key, id, run) => { assert.equal(table, 'canva_product_designs'); assert.equal(id, productId); return run(); },
      api: async (_token, path, init) => {
        calls.push([path, init?.method]);
        if (path === '/imports') return { job: { id: 'I' + (++imports), status: 'in_progress' } };
        if (path.startsWith('/imports/')) return { job: { status: 'success', result: { designs: [{ id: path.endsWith('1') ? 'D1' : 'D2' }] } } };
        if (path.startsWith('/designs/')) return { items: designPages.get('D1') };
        if (path === '/merges') {
          const body = JSON.parse(init.body);
          assert.equal(body.design_id, 'D1'); assert.equal(body.operations[0].source.design_id, 'D2');
          assert.equal(body.type, 'modify_existing_design');
          designPages.set('D1', [...designPages.get('D1'), { id: 'P2', page_number: 2, dimensions: { width: 540, height: 540 } }]);
          return { job: { id: 'M1', status: 'in_progress' } };
        }
        if (path === '/merges/M1') return { job: { status: 'success', result: { design: { id: 'D1' } } } };
        throw Error('Unexpected Canva path ' + path);
      }
    }
  });
  assert.equal((await p.ensureColorPage(admin, 'master', productId, colorId)).ready, false);
  await assert.rejects(p.ensureColorPage(admin, 'master', productId, color2), /Outra cor/);
  assert.equal((await p.ensureColorPage(admin, 'master', productId, colorId)).designId, 'D1');
  assert.equal((await p.ensureColorPage(admin, 'master', productId, color2)).ready, false);
  assert.equal((await p.ensureColorPage(admin, 'master', productId, color2)).ready, false);
  assert.equal((await p.ensureColorPage(admin, 'master', productId, color2)).designId, 'D1');
  assert.equal(db.catalog_canva_designs.get(colorId).page_id, 'P1');
  assert.equal(db.catalog_canva_designs.get(color2).page_id, 'P2');
  assert.equal(db.canva_product_designs.get(productId).pending_color_id, null);
  const writesBefore = calls.filter(c => c[1] === 'POST').length;
  assert.equal((await p.ensureColorPage(admin, 'master', productId, color2)).designId, 'D1');
  assert.equal(calls.filter(c => c[1] === 'POST').length, writesBefore);
});
