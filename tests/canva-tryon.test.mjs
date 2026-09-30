import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
const require = createRequire(import.meta.url), ts = require('typescript'), sharp = require('sharp');
function load(file, mocks = {}) {
  const loadedModule = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  new Function('require', 'module', 'exports', output)(name => mocks[name] ?? require(name), loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const security = load('../lib/canva/security.ts');
const canvaApi = load('../lib/canva/api.ts', { './security': security });
const navigation = load('../lib/canva/navigation.ts');
const prompt = load('../lib/canva/prompt.ts');
const templateModule = load('../lib/canva/template.ts', { './api': {}, './layout': {} });
const key = '4a'.repeat(32);
const productId = '11111111-1111-4111-8111-111111111111', colorId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
test('atomic Canva RPCs reject invalid bindings and nullable recovery outcomes at the database boundary', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20260925023846_canva_atomic_page_binding.sql', import.meta.url), 'utf8');
  assert.match(sql, /p_design_id is null or btrim\(p_design_id\) = ''/);
  assert.match(sql, /p_page_id is null or btrim\(p_page_id\) = ''/);
  assert.match(sql, /p_page_number is null or p_page_number < 1 or p_page_number > 500/);
  assert.match(sql, /p_page_stage not in \('idle', 'importing', 'imported', 'merging', 'ready', 'recovery'\)/);
  assert.match(sql, /p_manual_reference_override is null/);
  assert.match(sql, /p_page_stage = 'merging' and p_merge_job_id is null[\s\S]*p_before_page_ids \? p_page_id/);
  assert.match(sql, /p_outcome is null or p_outcome not in \('abandon', 'failed', 'success', 'ambiguous'\)/);
  assert.match(sql, /set source_path = p_source_path,[\s\S]*pending_color_id = null/);
});
test('database triggers invalidate patient try-ons without deleting Storage objects', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20260925030000_invalidate_stale_patient_tryons.sql', import.meta.url), 'utf8');
  const executable = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
  const colorFunction = executable.match(/create or replace function public\.invalidate_patient_display_images_for_color_change\(\)[\s\S]*?\$\$;/)?.[0];
  const measurementFunction = executable.match(/create or replace function public\.invalidate_patient_display_images_for_measurement_change\(\)[\s\S]*?\$\$;/)?.[0];

  assert.ok(colorFunction);
  assert.match(colorFunction, /old\.processed_image_path is not distinct from new\.processed_image_path/);
  assert.match(colorFunction, /delete from public\.catalog_patient_display_images where product_id = new\.product_id and color_name = new\.color_name/);
  assert.match(executable, /drop trigger if exists invalidate_patient_display_images_on_processed_path on public\.catalog_product_color_images/);
  assert.match(executable, /create trigger invalidate_patient_display_images_on_processed_path after update of processed_image_path on public\.catalog_product_color_images/);

  assert.ok(measurementFunction);
  assert.match(measurementFunction, /old\.frame_total_width_mm is not distinct from new\.frame_total_width_mm/);
  assert.match(measurementFunction, /old\.lens_width_mm is not distinct from new\.lens_width_mm/);
  assert.match(measurementFunction, /delete from public\.catalog_patient_display_images where product_id = new\.id/);
  assert.match(executable, /drop trigger if exists invalidate_patient_display_images_on_measurements on public\.catalog_products/);
  assert.match(executable, /create trigger invalidate_patient_display_images_on_measurements after update of frame_total_width_mm, lens_width_mm on public\.catalog_products/);
  assert.doesNotMatch(executable, /\bstorage\s*\.\s*objects\b|\bdelete\s+from\s+storage\s*\./);
});
test('OAuth requests only the Canva scopes used by the workflow', () => {
  assert.equal(canvaApi.SCOPES, 'design:content:read design:content:write design:meta:read profile:read');
  assert.equal(canvaApi.SCOPES.includes('asset:'), false);
});
test('the portal return URL keeps the product route and records the Canva edit session', () => {
  const url = navigation.withCanvaSession('https://portal.test/admin/catalogo/product/canva/color?canva_error=old#review', sessionId);
  assert.equal(url, `https://portal.test/admin/catalogo/product/canva/color?session=${sessionId}#review`);
});
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
test('OAuth failures keep an actionable, non-secret Canva error code', () => {
  const invalidClient = canvaApi.oauthTokenError(401, { code: 'invalid_client', message: 'do not expose this response' });
  assert.equal(invalidClient.code, 'invalid_client');
  assert.match(invalidClient.message, /Client Secret/);
  assert.doesNotMatch(invalidClient.message, /do not expose/);
  assert.match(canvaApi.oauthTokenError(400, { code: 'invalid_grant' }).message, /código de autorização/);
  assert.match(canvaApi.oauthTokenError(400, { code: 'invalid_scope' }).message, /permissões/);
  assert.match(canvaApi.oauthTokenError(401, { code: 'unauthorized_user' }).message, /conta Canva/);
  assert.match(canvaApi.oauthAuthorizationError('access_denied').message, /cancelada/);
  assert.equal(canvaApi.oauthAuthorizationError('<script>').code, 'authorization_failed');
});
test('recoverable Canva sessions are scoped to the current large-model snapshot', async () => {
  const filters = [];
  const query = {
    select() { return this; }, eq(keyName, value) { filters.push(['eq', keyName, value]); return this; },
    is(keyName, value) { filters.push(['is', keyName, value]); return this; },
    gt() { return this; }, or() { return this; }, order() { return this; },
    async limit() { return { data: [{ id: sessionId }], error: null }; }
  };
  const admin = { from: table => { assert.equal(table, 'canva_edit_sessions'); return query; } };
  const color = { original_image_path: `${productId}/original.png`, processed_image_path: null,
    processed_at: null, color_variant_number: 1 };
  const product = { sku_optotica: 'GE-AC-003', frame_total_width_mm: 113, canva_reference_revision: 4 };
  assert.equal(await canvaApi.recoverableSession(admin, 'master', productId, colorId, color, product, null), null);
  const result = await canvaApi.recoverableSession(admin, 'master', productId, colorId, color, product,
    '2026-09-25T01:00:00.000Z');
  assert.equal(result.id, sessionId);
  assert.deepEqual(filters.find(([, keyName]) => keyName === 'template_updated_at'),
    ['eq', 'template_updated_at', '2026-09-25T01:00:00.000Z']);
});
test('Canva configuration trims copied whitespace and validates credential formats', () => {
  const previous = { ...process.env };
  Object.assign(process.env, { CANVA_CLIENT_ID: '  OC-example_1  ', CANVA_CLIENT_SECRET: '  cnvca-example  ',
    CANVA_TOKEN_ENCRYPTION_KEY: `  ${key}  `, CANVA_APP_ORIGIN: '  https://portal.test/path  ' });
  try {
    assert.deepEqual(security.config(), { clientId: 'OC-example_1', clientSecret: 'cnvca-example', encryptionKey: key,
      origin: 'https://portal.test', redirectUri: 'https://portal.test/api/admin/catalog/canva/oauth/callback' });
    process.env.CANVA_CLIENT_SECRET = 'not-a-canva-secret';
    assert.throws(() => security.config(), /Client Secret/);
    assert.deepEqual(security.configurationStatus(), { configured: false,
      error: 'O Client Secret do Canva cadastrado no portal é inválido. Gere e copie o segredo novamente.' });
  } finally {
    for (const name of ['CANVA_CLIENT_ID', 'CANVA_CLIENT_SECRET', 'CANVA_TOKEN_ENCRYPTION_KEY', 'CANVA_APP_ORIGIN']) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
  }
});
function oauthStateAdmin(inserted) {
  const pending = { product_id: productId, color_id: colorId, verifier: 'sealed-verifier' };
  const stateQuery = {
    delete() { return this; }, eq() { return this; }, gt() { return this; }, select() { return this; },
    async maybeSingle() { return { data: pending, error: null }; }
  };
  return {
    from(name) {
      if (name === 'canva_oauth_states') return stateQuery;
      if (name === 'canva_connections') return { insert: async record => { inserted.push(record); return { error: null }; } };
      throw new Error(`Unexpected table ${name}`);
    }
  };
}
function callbackRoute(apiOverrides, inserted = []) {
  const admin = oauthStateAdmin(inserted);
  return load('../app/api/admin/catalog/canva/oauth/callback/route.ts', {
    'next/server': { NextResponse: {
      json: (data, init) => Response.json(data, init),
      redirect: url => new Response(null, { status: 307, headers: { location: url.toString() } })
    } },
    '@/lib/catalog/require-master': { requireMaster: async () => ({ ok: true, userId: 'master', admin }) },
    '@/lib/canva/security': { ...security,
      config: () => ({ clientId: 'OC-example', clientSecret: 'cnvca-example', encryptionKey: key,
        origin: 'https://portal.test', redirectUri: 'https://portal.test/api/admin/catalog/canva/oauth/callback' }),
      decrypt: () => 'verifier', digest: () => 'state-hash' },
    '@/lib/canva/api': {
      api: async () => ({ team_user: { user_id: 'canva-user', team_id: 'canva-team' } }),
      connection: async () => null, dbError: error => { if (error) throw error; },
      exchange: async () => ({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }),
      lease: async (_admin, _table, _column, _id, run) => run(),
      oauthAuthorizationError: canvaApi.oauthAuthorizationError,
      tokenFields: () => ({ access_token: 'sealed-access', refresh_token: 'sealed-refresh', expires_at: 'later' }),
      ...apiOverrides
    }
  });
}
test('OAuth callback returns a specific safe token error to the same product and color', async () => {
  const route = callbackRoute({ exchange: async () => { throw canvaApi.oauthTokenError(401, { code: 'invalid_client' }); } });
  const originalError = console.error; let logged;
  console.error = (...args) => { logged = args; };
  try {
    const response = await route.GET(new Request('https://portal.test/api/admin/catalog/canva/oauth/callback?state=s&code=c'));
    const location = new URL(response.headers.get('location'));
    assert.equal(location.pathname, `/admin/catalogo/${productId}/canva`);
    assert.equal(location.hash, `#cor-${colorId}`);
    assert.match(location.searchParams.get('canva_error'), /Client Secret/);
    assert.deepEqual(logged[1], { stage: 'token_exchange', status: 401, code: 'invalid_client' });
    assert.doesNotMatch(JSON.stringify(logged), /access|refresh|verifier|state=s|code=c/);
  } finally { console.error = originalError; }
});
test('OAuth callback stores the connected Canva account after a successful exchange', async () => {
  const inserted = [], route = callbackRoute({}, inserted);
  const response = await route.GET(new Request('https://portal.test/api/admin/catalog/canva/oauth/callback?state=s&code=c'));
  assert.equal(response.headers.get('location'), `https://portal.test/admin/catalogo/${productId}/canva#cor-${colorId}`);
  assert.deepEqual(inserted, [{ user_id: 'master', canva_user_id: 'canva-user', canva_team_id: 'canva-team',
    access_token: 'sealed-access', refresh_token: 'sealed-refresh', expires_at: 'later' }]);
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
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'key-1' };
const claims = { aud: 'app', exp: 2000, sub: 'canva-user', team_id: 'team', type: 'rti', jti: 'jwt-id',
  design_id: 'D123', correlation_state: sessionId };
function jwt(payload = claims, header = { alg: 'EdDSA', kid: 'key-1' }) {
  const data = [header, payload].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
  return data + '.' + sign(null, Buffer.from(data), privateKey).toString('base64url');
}
test('Canva return verifies the current EdDSA signature, audience, expiry, type and correlation ID', () => {
  assert.deepEqual(security.verifyReturnJwt(jwt(), [jwk], 'app', 1000), claims);
  assert.throws(() => security.verifyReturnJwt(jwt(), [jwk], 'another-app', 1000));
  assert.throws(() => security.verifyReturnJwt(jwt(), [jwk], 'app', 2000));
  assert.throws(() => security.verifyReturnJwt(jwt({ ...claims, type: 'other' }), [jwk], 'app', 1000));
  assert.throws(() => security.verifyReturnJwt(jwt({ ...claims, correlation_state: '//evil' }), [jwk], 'app', 1000));
  assert.throws(() => security.verifyReturnJwt(jwt(claims, { alg: 'none', kid: 'key-1' }), [jwk], 'app', 1000));
  assert.throws(() => security.verifyReturnJwt(jwt(claims, { alg: 'RS256', kid: 'key-1' }), [jwk], 'app', 1000));
  assert.throws(() => security.verifyReturnJwt(jwt(), [{ ...jwk, kid: 'another-key' }], 'app', 1000));
  assert.throws(() => security.verifyReturnJwt(jwt(), [{ ...jwk, kty: 'RSA' }], 'app', 1000));
  assert.throws(() => security.verifyReturnJwt(jwt(), [{ ...jwk, crv: 'X25519' }], 'app', 1000));
  const parts = jwt().split('.'); parts[1] = Buffer.from(JSON.stringify({ ...claims, design_id: 'D_OTHER' })).toString('base64url');
  assert.throws(() => security.verifyReturnJwt(parts.join('.'), [jwk], 'app', 1000));
});
function returnRoute(session, updated) {
  const query = { eq() { return this; }, then(resolve) { resolve({ error: null }); } };
  const admin = { from(name) {
    assert.equal(name, 'canva_edit_sessions');
    return { update(fields) { updated.push(fields); return query; } };
  } };
  return load('../app/api/admin/catalog/canva/return/route.ts', {
    'next/server': { NextResponse: {
      json: (data, init) => Response.json(data, init),
      redirect: url => new Response(null, { status: 307, headers: { location: url.toString() } })
    } },
    '@/lib/catalog/require-master': { requireMaster: async () => ({ ok: true, userId: 'master', admin }) },
    '@/lib/canva/api': { dbError: error => { if (error) throw error; }, getSession: async (_admin, _userId, id) => {
      if (id !== session.id) throw Error('unexpected session');
      return session;
    } },
    '@/lib/canva/security': { ...security, config: () => ({ clientId: 'app', origin: 'https://portal.test' }) }
  });
}
test('Canva return marks an Ed25519-signed session and redirects to its product color', async () => {
  const updated = [], session = { id: sessionId, product_id: productId, color_id: colorId,
    design_id: 'D123', canva_user_id: 'canva-user', canva_team_id: 'team' };
  const route = returnRoute(session, updated), originalFetch = globalThis.fetch;
  const token = jwt({ ...claims, exp: Math.floor(Date.now() / 1000) + 3600 });
  globalThis.fetch = async () => Response.json({ keys: [jwk] });
  try {
    const response = await route.GET(new Request('https://portal.test/api/admin/catalog/canva/return?correlation_jwt=' + token));
    const location = new URL(response.headers.get('location'));
    assert.equal(location.pathname, `/admin/catalogo/${productId}/canva`);
    assert.equal(location.hash, `#cor-${colorId}`);
    assert.equal(location.searchParams.get('session'), sessionId);
    assert.equal(updated.length, 1);
    assert.match(updated[0].return_verified_at, /^\d{4}-\d{2}-\d{2}T/);
  } finally { globalThis.fetch = originalFetch; }
});
test('an invalid Canva return keeps the recoverable product route without trusting the token', async () => {
  const updated = [], session = { id: sessionId, product_id: productId, color_id: colorId,
    design_id: 'D123', canva_user_id: 'canva-user', canva_team_id: 'team' };
  const route = returnRoute(session, updated), originalFetch = globalThis.fetch, originalError = console.error;
  const token = jwt({ ...claims, exp: Math.floor(Date.now() / 1000) + 3600 });
  const parts = token.split('.'); parts[2] = Buffer.alloc(64).toString('base64url');
  let logged;
  globalThis.fetch = async () => Response.json({ keys: [jwk] });
  console.error = (...args) => { logged = args; };
  try {
    const response = await route.GET(new Request('https://portal.test/api/admin/catalog/canva/return?correlation_jwt=' + parts.join('.')));
    const location = new URL(response.headers.get('location'));
    assert.equal(location.pathname, `/admin/catalogo/${productId}/canva`);
    assert.equal(location.hash, `#cor-${colorId}`);
    assert.equal(location.searchParams.get('session'), sessionId);
    assert.match(location.searchParams.get('canva_error'), /design foi preservado/);
    assert.equal(updated.length, 0);
    assert.deepEqual(logged[1], { stage: 'signature', kind: 'canva_validation' });
    assert.doesNotMatch(JSON.stringify(logged), /correlation_jwt|D123|canva-user/);
  } finally { globalThis.fetch = originalFetch; console.error = originalError; }
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
  const session = { id: sessionId, product_id: productId, color_id: colorId, staged_path: 'prepared.png', saved_at: null };
  const workflow = load('../lib/canva/workflow.ts', { './security': security, './image': {}, './pages': {}, './layout': {},
    './navigation': navigation, './template': {},
    './api': { getSession: async () => session, lease: async (_a, _t, _c, _id, fn) => fn(),
      access: () => { throw Error('unexpected Canva request'); } } });
  const result = await workflow.exportSession({}, 'master', sessionId);
  assert.equal(result.status, 'ready');
  assert.equal(result.previewUrl, `/api/admin/catalog/canva/image?productId=${productId}&colorId=${colorId}&kind=preview&sessionId=${sessionId}`);
});
test('saving requires a prepared preview and reports stale-photo conflicts', async () => {
  let session = { id: sessionId, staged_path: null, product_id: productId, color_id: colorId };
  const workflow = load('../lib/canva/workflow.ts', { './security': security, './image': {}, './pages': {}, './layout': {},
    './navigation': navigation, './template': {},
    './api': { getSession: async () => session } });
  await assert.rejects(workflow.saveSession({}, 'master', sessionId), /prévia/);
  session.staged_path = 'prepared.png';
  await assert.rejects(workflow.saveSession({ rpc: async () => ({ error: { message: 'CANVA_CONFLICT' } }) }, 'master', sessionId), /mudaram/);
});
test('a canonical Canva page with old measurement references cannot be edited or imported', async () => {
  let inserted = false;
  const workflow = load('../lib/canva/workflow.ts', { './security': security, './image': {}, './pages': {}, './layout': {
    photoFilename: () => 'GE-AC-003-C1-113mm.png'
  }, './navigation': navigation, './template': {
    getTemplate: async () => ({ updated_at: '2026-09-25T01:00:00.000Z' }),
    sameTemplateSnapshot: templateModule.sameTemplateSnapshot
  }, './api': {
    getColor: async () => ({ color: { original_image_path: `${productId}/original.png`, processed_image_path: null,
      processed_at: null, color_variant_number: 1 }, product: { sku_optotica: 'GE-AC-003', frame_total_width_mm: 113,
        position_image_path: `${productId}/measurements.png`, canva_reference_revision: 2 } }),
    getLink: async () => ({ product_id: productId, user_id: 'master', design_id: 'D1', page_id: 'P1',
      source_path: `${productId}/original.png`, reference_revision: 1,
      template_updated_at: '2026-09-25T01:00:00.000Z' }),
    dbError: error => { if (error) throw error; }
  } });
  const admin = { from: () => ({ insert: () => { inserted = true; throw new Error('unexpected insert'); } }) };
  await assert.rejects(workflow.createSession(admin, 'master', productId, colorId), /medidas ou imagem modelo antigas/);
  assert.equal(inserted, false);
});
test('a canonical Canva page with an old large model cannot create a new edit session', async () => {
  let inserted = false;
  const workflow = load('../lib/canva/workflow.ts', { './security': security, './image': {}, './pages': {}, './layout': {
    photoFilename: () => 'GE-AC-003-C1-113mm.png'
  }, './navigation': navigation, './template': {
    getTemplate: async () => ({ updated_at: '2026-09-25T02:00:00.000Z' }),
    sameTemplateSnapshot: templateModule.sameTemplateSnapshot
  }, './api': {
    getColor: async () => ({ color: { original_image_path: `${productId}/original.png`, processed_image_path: null,
      processed_at: null, color_variant_number: 1 }, product: { sku_optotica: 'GE-AC-003', frame_total_width_mm: 113,
        position_image_path: `${productId}/measurements.png`, canva_reference_revision: 2 } }),
    getLink: async () => ({ product_id: productId, user_id: 'master', design_id: 'D1', page_id: 'P1',
      source_path: `${productId}/original.png`, reference_revision: 2,
      template_updated_at: '2026-09-25T01:00:00.000Z' }),
    dbError: error => { if (error) throw error; }
  } });
  const admin = { from: () => ({ insert: () => { inserted = true; throw new Error('unexpected insert'); } }) };
  await assert.rejects(workflow.createSession(admin, 'master', productId, colorId), /imagem modelo antigas/);
  assert.equal(inserted, false);
});
test('a canonical Canva page cannot be imported without the clean format reference', async () => {
  let linkRead = false, inserted = false;
  const workflow = load('../lib/canva/workflow.ts', { './security': security, './image': {}, './pages': {},
    './layout': {}, './navigation': navigation,
    './template': { getTemplate: async () => ({ updated_at: '2026-09-25T01:00:00.000Z' }) },
    './api': {
      getColor: async () => ({ color: { original_image_path: `${productId}/original.png` },
        product: { position_image_path: null } }),
      getLink: async () => { linkRead = true; throw new Error('unexpected link read'); }
    }
  });
  const admin = { from: () => ({ insert: () => { inserted = true; throw new Error('unexpected insert'); } }) };
  await assert.rejects(workflow.createSession(admin, 'master', productId, colorId), error =>
    error?.status === 422 && /referência visual limpa do formato/.test(error.message));
  assert.equal(linkRead, false);
  assert.equal(inserted, false);
});
test('master authorization and session-color binding precede export or save', async () => {
  let auth = { ok: false, status: 403, message: 'forbidden' };
  const route = load('../app/api/admin/catalog/canva/route.ts', {
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '@/lib/catalog/require-master': { requireMaster: async () => auth },
    '@/lib/canva/security': security, '@/lib/canva/template': {}, '@/lib/canva/layout': {},
    '@/lib/canva/navigation': navigation, '@/lib/canva/prompt': prompt,
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
function imageRoute({ auth, color, product = {}, session }) {
  return load('../app/api/admin/catalog/canva/image/route.ts', {
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '@/lib/catalog/require-master': { requireMaster: async () => auth },
    '@/lib/canva/security': security,
    '@/lib/canva/api': {
      BUCKET: 'catalog-product-photos',
      getColor: async () => ({ color, product }),
      getSession: async () => session
    }
  });
}
test('the image proxy serves the private original through the authenticated portal without exposing a signed URL', async () => {
  let requested;
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } }).webp().toBuffer();
  const auth = { ok: true, userId: 'master', admin: { storage: { from: bucket => {
    assert.equal(bucket, 'catalog-product-photos');
    return { download: async (path, _options, requestOptions) => {
      requested = path; assert.equal(requestOptions.cache, 'no-store');
      return { data: new Blob([bytes], { type: 'application/octet-stream' }), error: null };
    } };
  } } } };
  const route = imageRoute({ auth, color: { original_image_path: `${productId}/photo.webp`, processed_image_path: null } });
  const response = await route.GET(new Request(`https://portal.test/api/admin/catalog/canva/image?productId=${productId}&colorId=${colorId}&kind=original`));
  assert.equal(response.status, 200); assert.equal(requested, `${productId}/photo.webp`);
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});
test('the image proxy serves the model measurement photo from the product path', async () => {
  let requested;
  const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
  const auth = { ok: true, userId: 'master', admin: { storage: { from: () => ({ download: async path => {
    requested = path; return { data: new Blob([bytes]), error: null };
  } }) } } };
  const path = `${productId}/measurements.jpg`;
  const route = imageRoute({ auth, color: {}, product: { position_image_path: path } });
  const response = await route.GET(new Request(`https://portal.test/api/admin/catalog/canva/image?productId=${productId}&colorId=${colorId}&kind=measurements`));
  assert.equal(response.status, 200); assert.equal(requested, path);
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
});
test('the image proxy rejects traversal and previews from another color before downloading storage', async () => {
  let downloads = 0;
  const auth = { ok: true, userId: 'master', admin: { storage: { from: () => ({ download: async () => {
    downloads++; return { data: new Blob(['x'], { type: 'image/png' }), error: null };
  } }) } } };
  let route = imageRoute({ auth, color: { original_image_path: `${productId}/../secret.webp`, processed_image_path: null } });
  let response = await route.GET(new Request(`https://portal.test/api/admin/catalog/canva/image?productId=${productId}&colorId=${colorId}&kind=original`));
  assert.equal(response.status, 403); assert.equal(downloads, 0);
  route = imageRoute({ auth, color: {}, session: { product_id: productId, color_id: '44444444-4444-4444-8444-444444444444', staged_path: 'x' } });
  response = await route.GET(new Request(`https://portal.test/api/admin/catalog/canva/image?productId=${productId}&colorId=${colorId}&kind=preview&sessionId=${sessionId}`));
  assert.equal(response.status, 403); assert.equal(downloads, 0);
});
test('Canva workspace reports an existing design whose page link can be safely resumed', async () => {
  let link, templateUpdatedAt = '2026-09-25T01:00:00.000Z';
  const route = load('../app/api/admin/catalog/canva/route.ts', {
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '@/lib/catalog/require-master': { requireMaster: async () => ({ ok: true, userId: 'master', admin: {} }) },
    '@/lib/canva/security': { ...security, configurationStatus: () => ({ configured: true, error: null }) },
    '@/lib/canva/api': {
      canResumeDesignLink: canvaApi.canResumeDesignLink,
      connection: async () => ({ user_id: 'master' }),
      designLinkNeedsRecovery: canvaApi.designLinkNeedsRecovery,
      getColor: async () => ({ color: { original_image_path: `${productId}/${colorId}.png`,
        processed_image_path: `${productId}/tryon.png`, processed_reference_revision: 1,
        processed_template_updated_at: '2026-09-25T01:00:00.000Z',
        color_variant_number: 1, color_name: 'Preto' },
        product: { sku_optotica: 'GE-AC-003', model_name: 'Retangular', frame_total_width_mm: 113,
          position_image_path: `${productId}/measurements.png`, canva_reference_revision: 1,
          lens_width_mm: 50, lens_height_mm: 43, bridge_mm: 21, lens_diagonal_mm: null,
          temple_length_mm: null, rim_mm: null, standard_height_mm: null } }),
      getLink: async () => link,
      recoverableSession: async () => null
    },
    '@/lib/canva/navigation': navigation,
    '@/lib/canva/prompt': prompt,
    '@/lib/canva/template': {
      getTemplate: async () => ({ has_transparency: true, png_base64: '', updated_at: templateUpdatedAt }),
      sameTemplateSnapshot: templateModule.sameTemplateSnapshot
    },
    '@/lib/canva/layout': { photoFilename: () => 'GE-AC-003-C1-113mm.png' },
    '@/lib/canva/workflow': {}
  });
  const get = async () => (await route.GET(new Request(`https://portal.test/api/admin/catalog/canva?productId=${productId}&colorId=${colorId}`))).json();

  link = { page_id: null, page_stage: 'imported', source_design_id: 'SOURCE', merge_job_id: null,
    import_job_id: 'IMPORT', source_path: `${productId}/${colorId}.png`, reference_revision: 1,
    template_updated_at: '2026-09-25T01:00:00.000Z' };
  const imported = await get();
  assert.equal(imported.hasResumableDesign, true);
  assert.equal(imported.designTitle, 'GE-AC-003 — Prova online');
  assert.match(imported.measurementUrl, /kind=measurements/);
  assert.match(imported.prompt, /Retangular/);
  assert.deepEqual(imported.measurements.slice(0, 4), [
    '- largura total da frente (D): 113 mm',
    '- largura de cada lente (A): 50 mm',
    '- altura de cada lente (B): 43 mm',
    '- largura da ponte (C): 21 mm'
  ]);
  assert.equal(imported.designReferencesChanged, false);
  assert.equal(imported.tryonReferencesChanged, false);

  templateUpdatedAt = '2026-09-25T02:00:00.000Z';
  const staleModel = await get();
  assert.equal(staleModel.designReferencesChanged, true);
  assert.equal(staleModel.tryonReferencesChanged, true);
  templateUpdatedAt = '2026-09-25T01:00:00.000Z';

  link = { ...link, page_stage: 'merging', merge_job_id: 'MERGE' };
  assert.equal((await get()).hasResumableDesign, true);

  link = { ...link, page_stage: 'merging', merge_job_id: null };
  const interrupted = await get();
  assert.equal(interrupted.hasResumableDesign, false);
  assert.equal(interrupted.needsRecovery, true);

  link = { ...link, page_stage: 'recovery', source_design_id: 'SOURCE', merge_job_id: null };
  const recoverable = await get();
  assert.equal(recoverable.hasResumableDesign, true);
  assert.equal(recoverable.needsRecovery, false);

  link = { ...link, page_stage: 'recovery', source_design_id: 'SOURCE', merge_job_id: 'MERGE', before_page_ids: ['P1'] };
  const recoverableMerge = await get();
  assert.equal(recoverableMerge.hasResumableDesign, true);
  assert.equal(recoverableMerge.needsRecovery, false);

  link = { ...link, page_stage: 'recovery', source_design_id: 'SOURCE', merge_job_id: 'MERGE', before_page_ids: null };
  const ambiguousMerge = await get();
  assert.equal(ambiguousMerge.hasResumableDesign, false);
  assert.equal(ambiguousMerge.needsRecovery, true);

  link = { ...link, page_stage: 'recovery', source_design_id: null, merge_job_id: null };
  const unrecoverable = await get();
  assert.equal(unrecoverable.hasResumableDesign, false);
  assert.equal(unrecoverable.needsRecovery, true);

  link = { ...link, page_id: 'PAGE', page_stage: 'ready', merge_job_id: null };
  assert.equal((await get()).hasResumableDesign, false);
});
const layout = load('../lib/canva/layout.ts', { './security': security });
const pagesModule = load('../lib/canva/pages.ts', { './security': security, './api': {}, './layout': layout, './template': {} });
test('refazer creates one resumable draft without changing the canonical Canva link', async () => {
  const current = { user_id: 'master', canva_user_id: 'cu', canva_team_id: 'ct' };
  let row = null, importStarts = 0, importPolls = 0, templateUpdatedAt = '2026-09-25T01:00:00.000Z';
  const matches = filters => filters.every(([kind, key, value]) => kind === 'eq'
    ? row?.[key] === value : kind === 'is' ? row?.[key] === value : true);
  function sessionQuery() {
    let inserted, update, filters = [];
    const applyUpdate = () => {
      if (!row || !matches(filters)) return null;
      Object.assign(row, update); return { id: row.id };
    };
    const query = {
      insert(value) { inserted = value; return this; },
      update(value) { update = value; return this; },
      select() { return this; },
      eq(key, value) { filters.push(['eq', key, value]); return this; },
      is(key, value) { filters.push(['is', key, value]); return this; },
      async single() {
        assert.equal(row, null);
        row = { export_job_id: null, staged_path: null, saved_at: null, return_verified_at: null,
          export_page_ids: null, expires_at: new Date(Date.now() + 3600000).toISOString(),
          created_at: new Date().toISOString(), ...inserted };
        return { data: { ...row }, error: null };
      },
      async maybeSingle() {
        if (update) return { data: applyUpdate(), error: null };
        return { data: row && matches(filters) ? { ...row } : null, error: null };
      },
      then(resolve, reject) {
        Promise.resolve({ data: update ? applyUpdate() : null, error: null }).then(resolve, reject);
      }
    };
    return query;
  }
  const original = new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/webp' });
  const measurements = new Blob([Uint8Array.from([4, 5, 6])], { type: 'image/jpeg' });
  const admin = {
    from(name) {
      if (name === 'canva_edit_sessions') return sessionQuery();
      if (name === 'canva_product_designs') return { select: () => ({ eq: () => ({
        maybeSingle: async () => ({ data: null, error: null })
      }) }) };
      throw new Error(`Unexpected table ${name}`);
    },
    storage: { from: bucket => {
      assert.equal(bucket, 'catalog-product-photos');
      return { download: async path => {
        if (path === `${productId}/original.webp`) return { data: original, error: null };
        if (path === `${productId}/measurements.jpg`) return { data: measurements, error: null };
        throw new Error(`Unexpected storage path ${path}`);
      } };
    } }
  };
  const workflow = load('../lib/canva/workflow.ts', {
    './security': security, './image': {}, './navigation': navigation,
    './template': {
      getTemplate: async () => ({ has_transparency: true, updated_at: templateUpdatedAt,
        png_base64: Buffer.from('template').toString('base64') }),
      sameTemplateSnapshot: templateModule.sameTemplateSnapshot
    },
    './layout': { ODP_MIME: 'application/vnd.oasis.opendocument.presentation',
      photoFilename: () => 'GE-AC-003-C1-113mm.png',
      colorPageDocument: async (template, photo, measure, filename) => {
        assert.equal(template.toString(), 'template'); assert.deepEqual(photo, Buffer.from([1, 2, 3]));
        assert.deepEqual(measure, Buffer.from([4, 5, 6]));
        assert.equal(filename, 'GE-AC-003-C1-113mm.png'); return Buffer.from('odp');
      } },
    './pages': { hasCompletePageMetadata: pagesModule.hasCompletePageMetadata,
      requireSquare: pagesModule.requireSquare,
      listPages: async () => [{ id: 'PAGE', page_number: 1, dimensions: { width: 1080, height: 1080 } }] },
    './api': {
      BUCKET: 'catalog-product-photos', dbError: error => { if (error) throw error; },
      getColor: async () => ({ color: { original_image_path: `${productId}/original.webp`, processed_image_path: null,
        processed_at: null, color_variant_number: 1 }, product: { sku_optotica: 'GE-AC-003', frame_total_width_mm: 113,
          position_image_path: `${productId}/measurements.jpg`, canva_reference_revision: 1 } }),
      getLink: async () => null,
      access: async () => ({ token: 'token', connection: current }), sameAccount: canvaApi.sameAccount,
      getSession: async () => ({ ...row }), lease: async (_admin, _table, _column, _id, run) => run(),
      api: async (_token, path) => {
        if (path === '/imports') { importStarts++; return { job: { id: 'IMPORT' } }; }
        if (path === '/imports/IMPORT') { importPolls++; return { job: { id: 'IMPORT', status: 'success', result: { designs: [{ id: 'DRAFT' }] } } }; }
        if (path === '/designs/DRAFT') return { design: { urls: { edit_url: 'https://www.canva.com/design/DRAFT/edit' } } };
        throw new Error(`Unexpected Canva path ${path}`);
      }
    }
  });
  const first = await workflow.redoDesign(admin, 'master', productId, colorId, sessionId);
  assert.deepEqual(first, { status: 'processing', sessionId });
  assert.equal(row.design_id, 'redo:import:IMPORT'); assert.equal(importStarts, 1);
  const ready = await workflow.redoDesign(admin, 'master', productId, colorId, sessionId);
  assert.equal(ready.status, 'ready'); assert.equal(ready.sessionId, sessionId);
  assert.equal(new URL(ready.editUrl).searchParams.get('correlation_state'), sessionId);
  assert.equal(row.design_id, 'DRAFT'); assert.equal(row.page_id, 'PAGE');
  await workflow.redoDesign(admin, 'master', productId, colorId, sessionId);
  assert.equal(importStarts, 1); assert.equal(importPolls, 1);
  templateUpdatedAt = '2026-09-25T02:00:00.000Z';
  await assert.rejects(workflow.redoDesign(admin, 'master', productId, colorId, sessionId), /imagem modelo mudaram/);
});

function stalePendingRedoFixture({ mergeStatuses = [], mergeJobId = null, pageResponses = null,
  pageStage = mergeJobId ? 'merging' : 'importing', beforePageIds = mergeJobId ? ['P1'] : null,
  hasLink = true, recoveryResult = true }) {
  const current = { user_id: 'master', canva_user_id: 'cu', canva_team_id: 'ct' };
  const templateUpdatedAt = '2026-09-25T01:00:00.000Z';
  const productDesign = { product_id: productId, ...current, design_id: 'D1', pending_color_id: colorId };
  const link = { color_id: colorId, product_id: productId, ...current, design_id: null, page_id: null,
    page_number: null, page_stage: pageStage, import_job_id: 'OLD_IMPORT',
    merge_job_id: mergeJobId, source_design_id: 'OLD_SOURCE', before_page_ids: beforePageIds,
    source_path: `${productId}/original.webp`, reference_revision: 1, template_updated_at: templateUpdatedAt,
    creating: true };
  let session = null, mergePoll = 0, pagePoll = 0, redoImports = 0;
  const recoveryCalls = [];
  function sessionQuery() {
    let inserted, update, filters = [];
    const matches = row => filters.every(([kind, key, value]) => kind === 'eq'
      ? row?.[key] === value : kind === 'is' ? row?.[key] === value : true);
    const applyUpdate = () => {
      if (!session || !matches(session)) return null;
      Object.assign(session, update); return { id: session.id };
    };
    return {
      insert(value) { inserted = value; return this; },
      update(value) { update = value; return this; },
      select() { return this; },
      eq(key, value) { filters.push(['eq', key, value]); return this; },
      is(key, value) { filters.push(['is', key, value]); return this; },
      async single() {
        session = { export_job_id: null, staged_path: null, saved_at: null, return_verified_at: null,
          expires_at: new Date(Date.now() + 3600000).toISOString(), created_at: new Date().toISOString(), ...inserted };
        return { data: { ...session }, error: null };
      },
      async maybeSingle() {
        if (update) return { data: applyUpdate(), error: null };
        return { data: session && matches(session) ? { ...session } : null, error: null };
      }
    };
  }
  const admin = {
    from(name) {
      if (name === 'canva_edit_sessions') return sessionQuery();
      if (name === 'canva_product_designs') return { select: () => ({ eq: () => ({
        maybeSingle: async () => ({ data: { ...productDesign }, error: null })
      }) }) };
      throw new Error(`Unexpected table ${name}`);
    },
    rpc: async (name, args) => {
      assert.equal(name, 'recover_stale_canva_pending');
      recoveryCalls.push(args);
      if (productDesign.pending_color_id !== colorId || args.p_merge_job_id !== link.merge_job_id) {
        return { data: false, error: null };
      }
      if (!recoveryResult) return { data: false, error: null };
      Object.assign(link, { page_stage: 'recovery', creating: false });
      if (args.p_page_id) Object.assign(link, { design_id: args.p_design_id,
        page_id: args.p_page_id, page_number: args.p_page_number });
      productDesign.pending_color_id = null;
      return { data: true, error: null };
    },
    storage: { from: () => ({ download: async path => ({
      data: new Blob([path.endsWith('measurements.jpg') ? Uint8Array.from([4, 5, 6]) : Uint8Array.from([1, 2, 3])]),
      error: null
    }) }) }
  };
  const workflow = load('../lib/canva/workflow.ts', {
    './security': security, './image': {}, './navigation': navigation,
    './template': { getTemplate: async () => ({ has_transparency: true, updated_at: templateUpdatedAt,
      png_base64: Buffer.from('template').toString('base64') }), sameTemplateSnapshot: templateModule.sameTemplateSnapshot },
    './layout': { ODP_MIME: 'application/vnd.oasis.opendocument.presentation',
      photoFilename: () => 'GE-AC-003-C1-113mm.png', colorPageDocument: async () => Buffer.from('odp') },
    './pages': { hasCompletePageMetadata: pagesModule.hasCompletePageMetadata,
      insertedPage: pagesModule.insertedPage, pendingMergedPage: pagesModule.pendingMergedPage,
      requireSquare: pagesModule.requireSquare,
      listPages: async () => {
        const response = pageResponses
          ? pageResponses[Math.min(pagePoll++, pageResponses.length - 1)] : [
            { id: 'P1', page_number: 1, dimensions: { width: 540, height: 540 } },
            { id: 'P2', page_number: 2, dimensions: { width: 1080, height: 1080 } }
          ];
        if (response instanceof Error) throw response;
        return response;
      } },
    './api': {
      BUCKET: 'catalog-product-photos', dbError: error => { if (error) throw error; },
      getColor: async () => ({ color: { original_image_path: `${productId}/original.webp`, processed_image_path: null,
        processed_at: null, color_variant_number: 1 }, product: { sku_optotica: 'GE-AC-003', frame_total_width_mm: 113,
          position_image_path: `${productId}/measurements.jpg`, canva_reference_revision: 2 } }),
      getLink: async () => hasLink ? ({ ...link }) : null,
      access: async () => ({ token: 'token', connection: current }), sameAccount: canvaApi.sameAccount,
      lease: async (_admin, table, column, id, run) => {
        assert.equal(table, 'canva_product_designs'); assert.equal(column, 'product_id'); assert.equal(id, productId);
        return run();
      },
      api: async (_token, path) => {
        if (path === '/merges/' + mergeJobId) {
          const status = mergeStatuses[Math.min(mergePoll++, mergeStatuses.length - 1)];
          return { job: { id: mergeJobId, status, result: status === 'success' ? { design: { id: 'D1' } } : undefined } };
        }
        if (path === '/imports') { redoImports++; return { job: { id: 'REDO_IMPORT' } }; }
        throw new Error(`Unexpected Canva path ${path}`);
      }
    }
  });
  return { workflow, admin, link, productDesign, recoveryCalls,
    get session() { return session; }, get mergePolls() { return mergePoll; },
    get pagePolls() { return pagePoll; }, get redoImports() { return redoImports; } };
}

test('refazer abandons a stale import/source and atomically releases the pending color before creating the draft', async () => {
  const fixture = stalePendingRedoFixture({});
  const result = await fixture.workflow.redoDesign(fixture.admin, 'master', productId, colorId, sessionId);
  assert.deepEqual(result, { status: 'processing', sessionId });
  assert.equal(fixture.recoveryCalls.length, 1);
  assert.equal(fixture.recoveryCalls[0].p_outcome, 'abandon');
  assert.equal(fixture.recoveryCalls[0].p_merge_job_id, null);
  assert.equal(fixture.productDesign.pending_color_id, null);
  assert.equal(fixture.link.page_stage, 'recovery');
  assert.equal(fixture.link.page_id, null);
  assert.equal(fixture.redoImports, 1);
});

test('refazer preserves an orphan pending color when its canonical link is missing', async () => {
  const fixture = stalePendingRedoFixture({ hasLink: false });
  await assert.rejects(fixture.workflow.redoDesign(fixture.admin, 'master', productId, colorId, sessionId),
    /não pôde ser conferida/);
  assert.equal(fixture.recoveryCalls.length, 0);
  assert.equal(fixture.productDesign.pending_color_id, colorId);
  assert.equal(fixture.redoImports, 0);
});

test('refazer preserves pending state when the atomic recovery comparison loses a race', async () => {
  const fixture = stalePendingRedoFixture({ recoveryResult: false });
  await assert.rejects(fixture.workflow.redoDesign(fixture.admin, 'master', productId, colorId, sessionId),
    /mudou durante a recuperação/);
  assert.equal(fixture.recoveryCalls.length, 1);
  assert.equal(fixture.productDesign.pending_color_id, colorId);
  assert.equal(fixture.link.page_stage, 'importing');
  assert.equal(fixture.redoImports, 0);
});

test('refazer keeps a stale merge locked while in progress, then records its inserted page and releases the product at terminal success', async () => {
  const fixture = stalePendingRedoFixture({ mergeJobId: 'OLD_MERGE', mergeStatuses: ['in_progress', 'success'] });
  const first = await fixture.workflow.redoDesign(fixture.admin, 'master', productId, colorId, sessionId);
  assert.deepEqual(first, { status: 'processing', sessionId });
  assert.equal(fixture.productDesign.pending_color_id, colorId);
  assert.equal(fixture.recoveryCalls.length, 0);
  assert.equal(fixture.redoImports, 0);

  const second = await fixture.workflow.redoDesign(fixture.admin, 'master', productId, colorId, sessionId);
  assert.deepEqual(second, { status: 'processing', sessionId });
  assert.equal(fixture.mergePolls, 2);
  assert.equal(fixture.recoveryCalls.length, 1);
  assert.deepEqual({ outcome: fixture.recoveryCalls[0].p_outcome, design: fixture.recoveryCalls[0].p_design_id,
    page: fixture.recoveryCalls[0].p_page_id, number: fixture.recoveryCalls[0].p_page_number },
  { outcome: 'success', design: 'D1', page: 'P2', number: 2 });
  assert.equal(fixture.productDesign.pending_color_id, null);
  assert.equal(fixture.link.page_stage, 'recovery');
  assert.equal(fixture.link.design_id, 'D1');
  assert.equal(fixture.link.page_id, 'P2');
  assert.equal(fixture.redoImports, 1);
});

test('a terminal merge remains locked while its inserted page is still propagating', async () => {
  const existing = { id: 'P1', page_number: 1, dimensions: { width: 540, height: 540 } };
  const fixture = stalePendingRedoFixture({ mergeJobId: 'OLD_MERGE', mergeStatuses: ['success', 'success'],
    pageResponses: [[existing], [existing, { id: 'P2', page_number: 2, dimensions: { width: 1080, height: 1080 } }]] });
  assert.deepEqual(await fixture.workflow.redoDesign(fixture.admin, 'master', productId, colorId, sessionId),
    { status: 'processing', sessionId });
  assert.equal(fixture.productDesign.pending_color_id, colorId);
  assert.equal(fixture.recoveryCalls.length, 0);
  assert.equal(fixture.redoImports, 0);

  assert.deepEqual(await fixture.workflow.redoDesign(fixture.admin, 'master', productId, colorId, sessionId),
    { status: 'processing', sessionId });
  assert.equal(fixture.pagePolls, 2);
  assert.equal(fixture.productDesign.pending_color_id, null);
  assert.equal(fixture.link.page_id, 'P2');
  assert.equal(fixture.redoImports, 1);
});

test('a merge with no recorded job is not abandoned because the external effect is unknown', async () => {
  const fixture = stalePendingRedoFixture({ mergeJobId: null, pageStage: 'merging', beforePageIds: ['P1'] });
  await assert.rejects(fixture.workflow.redoDesign(fixture.admin, 'master', productId, colorId, sessionId),
    /pode ter iniciado/);
  assert.equal(fixture.productDesign.pending_color_id, colorId);
  assert.equal(fixture.recoveryCalls.length, 0);
  assert.equal(fixture.redoImports, 0);
});

test('a failed terminal merge is marked as failed and atomically releases the pending product', async () => {
  const fixture = stalePendingRedoFixture({ mergeJobId: 'OLD_MERGE', mergeStatuses: ['failed'] });
  assert.deepEqual(await fixture.workflow.redoDesign(fixture.admin, 'master', productId, colorId, sessionId),
    { status: 'processing', sessionId });
  assert.equal(fixture.recoveryCalls.length, 1);
  assert.equal(fixture.recoveryCalls[0].p_outcome, 'failed');
  assert.equal(fixture.recoveryCalls[0].p_page_id, null);
  assert.equal(fixture.productDesign.pending_color_id, null);
  assert.equal(fixture.redoImports, 1);
});

test('an unknown merge status is never treated as terminal or allowed to release the product', async () => {
  const fixture = stalePendingRedoFixture({ mergeJobId: 'OLD_MERGE', mergeStatuses: ['queued'] });
  assert.deepEqual(await fixture.workflow.redoDesign(fixture.admin, 'master', productId, colorId, sessionId),
    { status: 'processing', sessionId });
  assert.equal(fixture.recoveryCalls.length, 0);
  assert.equal(fixture.productDesign.pending_color_id, colorId);
  assert.equal(fixture.redoImports, 0);
});

test('an ambiguous terminal merge is released explicitly as ambiguous without inventing a page binding', async () => {
  const existing = { id: 'P1', page_number: 1, dimensions: { width: 540, height: 540 } };
  const fixture = stalePendingRedoFixture({ mergeJobId: 'OLD_MERGE', mergeStatuses: ['success'], pageResponses: [[
    existing,
    { id: 'P2', page_number: 2, dimensions: { width: 1080, height: 1080 } },
    { id: 'P3', page_number: 3, dimensions: { width: 1080, height: 1080 } }
  ]] });
  assert.deepEqual(await fixture.workflow.redoDesign(fixture.admin, 'master', productId, colorId, sessionId),
    { status: 'processing', sessionId });
  assert.equal(fixture.recoveryCalls.length, 1);
  assert.equal(fixture.recoveryCalls[0].p_outcome, 'ambiguous');
  assert.equal(fixture.recoveryCalls[0].p_page_id, null);
  assert.equal(fixture.link.page_id, null);
  assert.equal(fixture.productDesign.pending_color_id, null);
  assert.equal(fixture.redoImports, 1);
});

test('a transient page-list failure after merge success never releases the pending product', async () => {
  const fixture = stalePendingRedoFixture({ mergeJobId: 'OLD_MERGE', mergeStatuses: ['success'],
    pageResponses: [new Error('temporary Canva failure')] });
  await assert.rejects(fixture.workflow.redoDesign(fixture.admin, 'master', productId, colorId, sessionId),
    /temporary Canva failure/);
  assert.equal(fixture.recoveryCalls.length, 0);
  assert.equal(fixture.productDesign.pending_color_id, colorId);
  assert.equal(fixture.redoImports, 0);
});
test('filenames use the existing color SKU and actual physical width', () => {
  assert.equal(layout.photoFilename('GE-AC-003', 2, 113), 'GE-AC-003-C2-113mm.png');
  assert.equal(layout.photoFilename('GE-AC-003', 2, 95), 'GE-AC-003-C2-095mm.png');
  assert.equal(layout.photoFilename('GE-AC-003', 2, 113.5), 'GE-AC-003-C2-113.5mm.png');
  for (const args of [['GE', 0, 113], ['GE', 1, 0], ['GE', 1, NaN]]) assert.throws(() => layout.photoFilename(...args));
});
test('the Canva prompts prioritize the visual format and keep references for refinement', () => {
  assert.equal(prompt.canvaColorLabel({ color_name: 'Retangular em acetato 002 - Cor 5', color_principal: 'Verde-oliva', color_secondary: null }), 'Verde-oliva');
  const text = prompt.buildCanvaEditPrompt({ model_name: 'Retangular em acetato 002', sku_optotica: 'RT-AC-002',
    frame_total_width_mm: 143, lens_width_mm: 50, lens_height_mm: 43, bridge_mm: null,
    lens_diagonal_mm: null, temple_length_mm: null, rim_mm: null, standard_height_mm: null }, 'Preto');
  assert.match(text, /Retangular em acetato 002/);
  assert.match(text, /RT-AC-002/);
  assert.match(text, /cor “Preto”/);
  assert.doesNotMatch(text, /Medidas cadastradas|143 mm|50 mm|43 mm/);
  assert.match(text, /IMAGEM GRANDE NA PARTE SUPERIOR/);
  assert.match(text, /IMAGEM MAIOR NA PARTE INFERIOR/);
  assert.match(text, /desenho limpo do óculos/);
  assert.doesNotMatch(text, /medidas escritas|cotas/);
  assert.match(text, /mantenha na página e sem alterações as duas referências auxiliares/);
  assert.match(text, /não deixe margens laterais/);
  const refine = prompt.buildCanvaRefinementPrompt({ model_name: 'Retangular em acetato 002', sku_optotica: 'RT-AC-002' }, 'Preto');
  assert.match(refine, /Refine a armação gerada/);
  assert.match(refine, /sem alterar as duas imagens de referência/);
  assert.match(refine, /imagem superior/);
  assert.match(refine, /foto inferior/);
});
test('template snapshots compare the actual timestamp and reject missing legacy versions', () => {
  assert.equal(templateModule.sameTemplateSnapshot('2026-09-25T01:00:00.000Z', '2026-09-25 01:00:00+00'), true);
  assert.equal(templateModule.sameTemplateSnapshot('2026-09-25T01:00:00.000Z', '2026-09-25T01:00:00.001Z'), false);
  assert.equal(templateModule.sameTemplateSnapshot(null, '2026-09-25T01:00:00.000Z'), false);
});
async function transparentModel() {
  const raw = Buffer.alloc(540 * 540 * 4);
  for (let y = 185; y < 345; y++) for (let x = 0; x < 540; x++) {
    if (y > 200 && y < 330 && x > 20 && x < 520) continue;
    raw[(y * 540 + x) * 4 + 3] = 255;
  }
  return sharp(raw, { raw: { width: 540, height: 540, channels: 4 } }).png().toBuffer();
}
async function oversizedModel() {
  const width = 540, height = 540, raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const leftOuter = ((x - 135) / 135) ** 2 + ((y - 205) / 125) ** 2 <= 1;
    const leftInner = ((x - 135) / 105) ** 2 + ((y - 205) / 90) ** 2 < 1;
    const rightOuter = ((x - 405) / 135) ** 2 + ((y - 205) / 125) ** 2 <= 1;
    const rightInner = ((x - 405) / 105) ** 2 + ((y - 205) / 90) ** 2 < 1;
    const bridge = x >= 258 && x <= 282 && y >= 190 && y <= 220;
    if ((leftOuter && !leftInner) || (rightOuter && !rightInner) || bridge) {
      const i = (y * width + x) * 4;
      raw[i] = 20; raw[i + 1] = 20; raw[i + 2] = 20; raw[i + 3] = 255;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
test('model validation detects a white PNG even if the file extension is correct', async () => {
  const white = await sharp({ create: { width: 540, height: 540, channels: 3, background: '#fff' } }).png().toBuffer();
  assert.equal((await layout.inspectTemplate(white)).hasTransparency, false);
  assert.equal((await layout.inspectTemplate(await transparentModel())).hasTransparency, true);
  await assert.rejects(layout.inspectTemplate(await sharp(white).resize(1080, 1080).png().toBuffer()));
});
test('page document contains three independent images, exact square geometry and a named page', async () => {
  const model = await transparentModel();
  const original = await sharp({ create: { width: 600, height: 300, channels: 3, background: '#a06020' } }).jpeg().toBuffer();
  const measurements = await sharp({ create: { width: 300, height: 240, channels: 3, background: '#f8f8f8' } }).webp().toBuffer();
  const document = await layout.colorPageDocument(model, original, measurements, 'GE-AC-003-C2-113mm.png');
  const zip = await require('jszip').loadAsync(document);
  assert.equal(await zip.file('mimetype').async('string'), layout.ODP_MIME);
  assert.deepEqual(await zip.file('Pictures/model.png').async('nodebuffer'), model);
  assert.ok(zip.file('Pictures/measurements.png'));
  assert.ok(zip.file('Pictures/color.png'));
  const content = await zip.file('content.xml').async('string');
  assert.equal((content.match(/<draw:frame /g) || []).length, 3);
  assert.match(content, /draw:name="GE-AC-003-C2-113mm.png"/);
  assert.match(content, /Referência visual limpa do formato — manter para refinamento/);
  assert.match(content, /Referência da cor e acabamento — manter para refinamento/);
  assert.equal((content.match(/svg:height="2\.1354166666666665in"/g) || []).length, 2);
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

function manualLinkFixture({ existing = false, pageStage = 'idle', mergeJobId = null, beforePageIds = null,
  mergeStatus = 'success', staleReferences = false, changeStateOnRpc = false,
  pageItems = [{ id: 'P1', page_number: 1, dimensions: { width: 1080, height: 1080 } }] } = {}) {
  const current = { user_id: 'master', canva_user_id: 'cu', canva_team_id: 'ct' };
  const templateUpdatedAt = '2026-09-25T00:00:00.000Z';
  const currentSource = `${productId}/${colorId}.png`;
  const product = { product_id: productId, ...current, design_id: existing ? 'D1' : null,
    pending_color_id: existing ? colorId : null };
  const db = { canva_product_designs: new Map([[productId, product]]), catalog_canva_designs: new Map() };
  if (existing) db.catalog_canva_designs.set(colorId, { color_id: colorId, product_id: productId, ...current,
    design_id: null, page_id: null, page_stage: pageStage, import_job_id: 'I', merge_job_id: mergeJobId,
    before_page_ids: beforePageIds, source_path: staleReferences ? `${productId}/old.png` : currentSource,
    reference_revision: staleReferences ? 1 : 2,
    template_updated_at: staleReferences ? '2026-09-24T00:00:00.000Z' : templateUpdatedAt });
  const remotePaths = [], rpcCalls = [];
  const admin = { rpc: async (name, args) => {
    assert.equal(name, 'bind_canva_page');
    rpcCalls.push(args);
    const link = db.catalog_canva_designs.get(args.p_color_id);
    if (changeStateOnRpc) link.page_stage = 'recovery';
    const unchanged = link.source_path === args.p_expected_source_path &&
      Number(link.reference_revision) === Number(args.p_expected_reference_revision) &&
      link.template_updated_at === args.p_expected_template_updated_at &&
      link.page_stage === args.p_page_stage && link.import_job_id === args.p_import_job_id &&
      link.merge_job_id === args.p_merge_job_id &&
      JSON.stringify(link.before_page_ids) === JSON.stringify(args.p_before_page_ids);
    const referencesCurrent = args.p_source_path === currentSource && args.p_reference_revision === 2 &&
      args.p_template_updated_at === templateUpdatedAt;
    if (!unchanged || !referencesCurrent || args.p_manual_reference_override !== true) {
      return { data: false, error: null };
    }
    Object.assign(link, { source_path: args.p_source_path, reference_revision: args.p_reference_revision,
      template_updated_at: args.p_template_updated_at, design_id: args.p_design_id,
      page_id: args.p_page_id, page_number: args.p_page_number, page_stage: 'ready', creating: false });
    Object.assign(db.canva_product_designs.get(args.p_product_id), { design_id: args.p_design_id, pending_color_id: null });
    return { data: true, error: null };
  }, from: name => {
    const table = db[name], key = name === 'canva_product_designs' ? 'product_id' : 'color_id';
    return {
      upsert: async data => { if (!table.has(data[key])) table.set(data[key], { ...data }); return { error: null }; },
      insert: async data => { table.set(data[key], { page_stage: 'idle', import_job_id: null,
        merge_job_id: null, before_page_ids: null, ...data }); return { error: null }; },
      select: () => ({ eq: (_key, id) => ({ single: async () => ({ data: { ...table.get(id) }, error: null }) }) }),
      update: data => ({ eq: async (_key, id) => { Object.assign(table.get(id), data); return { error: null }; } })
    };
  } };
  const pages = load('../lib/canva/pages.ts', { './security': security, './layout': layout, './template': {
    getTemplate: async () => ({ has_transparency: true, updated_at: templateUpdatedAt }),
    sameTemplateSnapshot: (snapshot, value) => snapshot === value
  },
    './api': {
      access: async () => ({ token: 'token', connection: current }), BUCKET: 'bucket',
      canResumeDesignLink: canvaApi.canResumeDesignLink, dbError: error => { if (error) throw error; },
      getColor: async () => ({ color: { color_variant_number: 1, original_image_path: currentSource },
        product: { sku_optotica: 'GE-AC-003', frame_total_width_mm: 113,
          position_image_path: `${productId}/measurements.png`, canva_reference_revision: 2 } }),
      getLink: async () => { const link = db.catalog_canva_designs.get(colorId); return link ? { ...link } : null; },
      lease: async (_admin, _table, _column, _id, run) => run(), sameAccount: () => {},
      api: async (_token, path) => {
        remotePaths.push(path);
        if (path === '/merges/' + mergeJobId) return { job: { id: mergeJobId, status: mergeStatus,
          result: mergeStatus === 'success' ? { design: { id: 'D1' } } : undefined } };
        if (path === '/designs/D1') return { design: { owner: { user_id: 'cu', team_id: 'ct' } } };
        if (path.startsWith('/designs/D1/pages')) return { items: pageItems };
        throw new Error(`Unexpected Canva path ${path}`);
      }
    }
  });
  return { admin, pages, db, product, remotePaths, rpcCalls };
}

test('manual linking accepts a 1080 square page and stores its stable Canva ID', async () => {
  const fixture = manualLinkFixture();
  await fixture.pages.linkColorPage(fixture.admin, 'master', productId, colorId,
    'https://www.canva.com/design/D1/edit', 1);
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).design_id, 'D1');
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_id, 'P1');
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_stage, 'ready');
});

test('manual linking blocks an active merge but accepts a terminal merge and clears pending atomically', async () => {
  const mergedPages = [
    { id: 'P0', page_number: 1, dimensions: { width: 1080, height: 1080 } },
    { id: 'P1', page_number: 2, dimensions: { width: 1080, height: 1080 } }
  ];
  const active = manualLinkFixture({ existing: true, pageStage: 'merging', mergeJobId: 'M1',
    beforePageIds: ['P0'], mergeStatus: 'in_progress' });
  await assert.rejects(active.pages.linkColorPage(active.admin, 'master', productId, colorId,
    'https://www.canva.com/design/D1/edit', 1), /ainda está sendo processada/);
  assert.deepEqual(active.remotePaths, ['/merges/M1']);
  assert.equal(active.rpcCalls.length, 0);
  assert.equal(active.product.pending_color_id, colorId);

  const terminal = manualLinkFixture({ existing: true, pageStage: 'merging', mergeJobId: 'M1',
    beforePageIds: ['P0'], mergeStatus: 'success', pageItems: mergedPages });
  await terminal.pages.linkColorPage(terminal.admin, 'master', productId, colorId,
    'https://www.canva.com/design/D1/edit', 2);
  assert.equal(terminal.rpcCalls.length, 1);
  assert.equal(terminal.db.catalog_canva_designs.get(colorId).page_id, 'P1');
  assert.equal(terminal.product.pending_color_id, null);
});

test('manual linking resolves a merge with no job and atomically trusts the explicitly selected page for current references', async () => {
  const mergedPages = [
    { id: 'P0', page_number: 1, dimensions: { width: 1080, height: 1080 } },
    { id: 'P1', page_number: 2, dimensions: { width: 1080, height: 1080 } }
  ];
  const fixture = manualLinkFixture({ existing: true, pageStage: 'merging', beforePageIds: ['P0'],
    staleReferences: true, pageItems: mergedPages });
  await fixture.pages.linkColorPage(fixture.admin, 'master', productId, colorId,
    'https://www.canva.com/design/D1/edit', 2);
  const link = fixture.db.catalog_canva_designs.get(colorId);
  assert.equal(fixture.remotePaths.some(path => path.startsWith('/merges/')), false);
  assert.equal(fixture.rpcCalls[0].p_manual_reference_override, true);
  assert.equal(fixture.rpcCalls[0].p_expected_source_path, `${productId}/old.png`);
  assert.equal(link.source_path, `${productId}/${colorId}.png`);
  assert.equal(link.reference_revision, 2);
  assert.equal(link.page_stage, 'ready');
  assert.equal(fixture.product.pending_color_id, null);
});

test('manual linking does not overwrite newer workflow state when the atomic bind comparison loses a race', async () => {
  const mergedPages = [
    { id: 'P0', page_number: 1, dimensions: { width: 1080, height: 1080 } },
    { id: 'P1', page_number: 2, dimensions: { width: 1080, height: 1080 } }
  ];
  const fixture = manualLinkFixture({ existing: true, pageStage: 'merging', beforePageIds: ['P0'],
    staleReferences: true, changeStateOnRpc: true, pageItems: mergedPages });
  await assert.rejects(fixture.pages.linkColorPage(fixture.admin, 'master', productId, colorId,
    'https://www.canva.com/design/D1/edit', 2), /referências ou o andamento/);
  const link = fixture.db.catalog_canva_designs.get(colorId);
  assert.equal(link.page_stage, 'recovery');
  assert.equal(link.page_id, null);
  assert.equal(link.source_path, `${productId}/old.png`);
  assert.equal(fixture.product.pending_color_id, colorId);
});

test('manual linking without a merge job waits for exactly one complete inserted page', async () => {
  const p0 = { id: 'P0', page_number: 1, dimensions: { width: 1080, height: 1080 } };
  const p1 = { id: 'P1', page_number: 2, dimensions: { width: 1080, height: 1080 } };
  const p2 = { id: 'P2', page_number: 3, dimensions: { width: 1080, height: 1080 } };
  const cases = [
    { pages: [p0], selected: 1, message: /ainda não apareceu/ },
    { pages: [p0, { id: 'P1', page_number: 2 }], selected: 2, message: /ainda não apareceu/ },
    { pages: [p0, p1, p2], selected: 2, message: /não é a única página nova/ },
    { pages: [p0, p1], selected: 1, message: /não é a única página nova/ }
  ];
  for (const value of cases) {
    const fixture = manualLinkFixture({ existing: true, pageStage: 'merging', beforePageIds: ['P0'],
      pageItems: value.pages });
    await assert.rejects(fixture.pages.linkColorPage(fixture.admin, 'master', productId, colorId,
      'https://www.canva.com/design/D1/edit', value.selected), value.message);
    assert.equal(fixture.rpcCalls.length, 0);
    assert.equal(fixture.product.pending_color_id, colorId);
  }
});

test('a successful merge requires its unique inserted page, while a failed merge permits explicit manual selection', async () => {
  const existingPage = { id: 'P0', page_number: 1, dimensions: { width: 1080, height: 1080 } };
  const success = manualLinkFixture({ existing: true, pageStage: 'merging', mergeJobId: 'M1',
    beforePageIds: ['P0'], mergeStatus: 'success', pageItems: [existingPage] });
  await assert.rejects(success.pages.linkColorPage(success.admin, 'master', productId, colorId,
    'https://www.canva.com/design/D1/edit', 1), /ainda não apareceu/);
  assert.equal(success.rpcCalls.length, 0);
  assert.equal(success.product.pending_color_id, colorId);

  const failed = manualLinkFixture({ existing: true, pageStage: 'merging', mergeJobId: 'M1',
    beforePageIds: ['P0'], mergeStatus: 'failed', pageItems: [existingPage] });
  await failed.pages.linkColorPage(failed.admin, 'master', productId, colorId,
    'https://www.canva.com/design/D1/edit', 1);
  assert.equal(failed.rpcCalls.length, 1);
  assert.equal(failed.db.catalog_canva_designs.get(colorId).page_id, 'P0');
  assert.equal(failed.product.pending_color_id, null);
});
test('both top and bottom references must be removed before preparing the final PNG', async () => {
  const model = await transparentModel();
  await image.rejectReferencePhoto(model);
  const reference = await sharp({ create: { width: 260, height: 100, channels: 4, background: '#fff' } }).png().toBuffer();
  const top = await sharp(model).composite([{ input: reference, left: 140, top: 10 }]).png().toBuffer();
  const bottom = await sharp(model).composite([{ input: reference, left: 140, top: 430 }]).png().toBuffer();
  await assert.rejects(image.rejectReferencePhoto(top), /partes superior e inferior/);
  await assert.rejects(image.rejectReferencePhoto(bottom), /partes superior e inferior/);
});
test('corner validation accepts a tall oversized frame that legitimately reaches both reference zones', async () => {
  const model = await oversizedModel();
  const { data, info } = await sharp(model).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const visible = (x0, x1) => {
    let count = 0;
    for (let y = 0; y < Math.floor(info.height * 0.27); y++) for (let x = x0; x < x1; x++) {
      if (data[(y * info.width + x) * info.channels + info.channels - 1] > 4) count++;
    }
    return count;
  };
  assert.ok(visible(0, Math.floor(info.width * 0.40)) > 10);
  assert.ok(visible(Math.floor(info.width * 0.60), info.width) > 10);
  await image.rejectReferencePhoto(model);
  const output = await image.prepareTryonPng(model);
  assert.deepEqual(await sharp(output).metadata().then(({ width, height }) => ({ width, height })), { width: 540, height: 540 });
});
test('a transparent detached reference is still rejected without relying on a white rectangle', async () => {
  const model = await oversizedModel();
  const reference = await sharp({
    create: { width: 100, height: 60, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).composite([{ input: Buffer.from('<svg width="100" height="60"><rect x="2" y="2" width="96" height="56" rx="12" fill="none" stroke="black" stroke-width="4"/></svg>') }])
    .png().toBuffer();
  const composite = await sharp(model).composite([{ input: reference, left: 220, top: 12 }]).png().toBuffer();
  await assert.rejects(image.rejectReferencePhoto(composite), /partes superior e inferior/);
});
test('export selects the page ID for this color and uses 540 square transparent output', async () => {
  const session = { id: sessionId, page_id: 'B', export_filename: 'GE-AC-003-C2-113mm.png', design_id: 'D', export_job_id: null };
  const calls = [];
  const admin = { from: () => ({ update: fields => { calls.push(fields); return { eq: async () => ({ error: null }) }; } }) };
  const workflow = load('../lib/canva/workflow.ts', { './security': security, './image': {}, './layout': layout,
    './navigation': navigation, './template': {},
    './pages': { ...pagesModule, listPages: async () => [
      { id: 'A', page_number: 1, dimensions: { width: 540, height: 540 } },
      { id: 'B', page_number: 2, dimensions: { width: 540, height: 540 } }
    ] },
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
test('export rejects a Canva page resized after it was linked', async () => {
  const session = { id: sessionId, page_id: 'B', export_filename: 'GE-AC-003-C2-113mm.png', design_id: 'D', export_job_id: null };
  const workflow = load('../lib/canva/workflow.ts', { './security': security, './image': {}, './layout': layout,
    './navigation': navigation, './template': {},
    './pages': { ...pagesModule, listPages: async () => [
      { id: 'B', page_number: 1, dimensions: { width: 1080, height: 1350 } }
    ] },
    './api': { getSession: async () => session, lease: async (_a, _b, _c, _d, run) => run(),
      access: async () => ({ token: 't', connection: {} }), sameAccount: () => {}, dbError: () => {},
      api: () => { throw Error('unexpected export request'); } }
  });
  await assert.rejects(workflow.exportSession({}, 'master', sessionId), /página precisa ser quadrada/);
});
test('two colors append to one product design, while a pending color blocks concurrent creation', async () => {
  const color2 = '44444444-4444-4444-8444-444444444444';
  const db = { canva_product_designs: new Map(), catalog_canva_designs: new Map() };
  const calls = [], designPages = new Map([['D1', [{ id: 'P1', page_number: 1, dimensions: { width: 540, height: 540 } }]]]);
  const photo = await sharp({ create: { width: 300, height: 150, channels: 3, background: '#654321' } }).png().toBuffer();
  const current = { user_id: 'master', canva_user_id: 'cu', canva_team_id: 'ct' };
  const templateUpdatedAt = '2026-09-23T00:00:00.000Z';
  const admin = {
    rpc: async (name, args) => {
      assert.equal(name, 'bind_canva_page');
      const link = db.catalog_canva_designs.get(args.p_color_id);
      assert.equal(args.p_source_path, link.source_path);
      assert.equal(args.p_reference_revision, link.reference_revision);
      assert.equal(args.p_template_updated_at, link.template_updated_at);
      Object.assign(link, { design_id: args.p_design_id, page_id: args.p_page_id,
        page_number: args.p_page_number, page_stage: 'ready', creating: false });
      Object.assign(db.canva_product_designs.get(args.p_product_id), { design_id: args.p_design_id, pending_color_id: null });
      return { data: true, error: null };
    },
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
    './template': {
      getTemplate: async () => ({ has_transparency: true, updated_at: templateUpdatedAt,
        png_base64: (await transparentModel()).toString('base64') }),
      sameTemplateSnapshot: (snapshot, value) => snapshot === value
    },
    './api': {
      access: async () => ({ token: 'token', connection: current }), sameAccount: () => {}, BUCKET: 'bucket',
      dbError: error => { if (error) throw error; },
      getColor: async (_admin, _productId, id) => ({ color: { id, color_variant_number: id === colorId ? 1 : 2, original_image_path: productId + '/' + id + '.png' }, product: {
        sku_optotica: 'GE-AC-003', frame_total_width_mm: 113, position_image_path: productId + '/measurements.png',
        canva_reference_revision: 1
      } }),
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

function existingCanvaPageWorkflow({ productDesignId, pageStage, pageResponses, beforePageIds = null,
  mergeJobId = pageStage === 'merging' ? 'MERGE' : null, changeReferencesOnPath = null,
  changeReferenceKind = 'both', changeReferencesOnRpc = false, changeTemplateOnRpc = false,
  pageId = null, linkDesignId = null }) {
  const current = { user_id: 'master', canva_user_id: 'cu', canva_team_id: 'ct' };
  const reference = { sourcePath: `${productId}/${colorId}.png`, revision: 1,
    templateUpdatedAt: '2026-09-25T00:00:00.000Z' };
  const product = { product_id: productId, ...current, design_id: productDesignId, pending_color_id: colorId };
  const link = { color_id: colorId, product_id: productId, ...current, design_id: linkDesignId, page_id: pageId,
    page_stage: pageStage, import_job_id: 'IMPORT', merge_job_id: mergeJobId,
    source_design_id: 'SOURCE', before_page_ids: beforePageIds, source_path: reference.sourcePath,
    reference_revision: reference.revision, template_updated_at: reference.templateUpdatedAt };
  const db = { canva_product_designs: new Map([[productId, product]]), catalog_canva_designs: new Map([[colorId, link]]) };
  const calls = [], rpcCalls = [];
  let rpcReferenceChanged = false;
  const admin = { rpc: async (name, args) => {
    assert.equal(name, 'bind_canva_page');
    rpcCalls.push(args);
    if (changeReferencesOnRpc && !rpcReferenceChanged) {
      reference.sourcePath = `${productId}/${colorId}-new.png`;
      reference.revision += 1;
      rpcReferenceChanged = true;
    }
    if (changeTemplateOnRpc && !rpcReferenceChanged) {
      reference.templateUpdatedAt = '2026-09-25T01:00:00.000Z';
      rpcReferenceChanged = true;
    }
    const linkRow = db.catalog_canva_designs.get(colorId);
    const current = args.p_source_path === reference.sourcePath &&
      Number(args.p_reference_revision) === reference.revision &&
      args.p_template_updated_at === reference.templateUpdatedAt &&
      linkRow.source_path === args.p_expected_source_path &&
      Number(linkRow.reference_revision) === Number(args.p_expected_reference_revision) &&
      linkRow.template_updated_at === args.p_expected_template_updated_at &&
      linkRow.page_stage === args.p_page_stage &&
      linkRow.import_job_id === args.p_import_job_id &&
      linkRow.merge_job_id === args.p_merge_job_id &&
      JSON.stringify(linkRow.before_page_ids) === JSON.stringify(args.p_before_page_ids) &&
      args.p_manual_reference_override === false &&
      (!linkRow.page_id || linkRow.page_id === args.p_page_id) &&
      (!linkRow.design_id || linkRow.design_id === args.p_design_id);
    if (!current) return { data: false, error: null };
    Object.assign(linkRow, { design_id: args.p_design_id, page_id: args.p_page_id,
      page_number: args.p_page_number, page_stage: 'ready', creating: false });
    Object.assign(db.canva_product_designs.get(productId), { design_id: args.p_design_id, pending_color_id: null });
    return { data: true, error: null };
  }, from: name => {
    const table = db[name], key = name === 'canva_product_designs' ? 'product_id' : 'color_id';
    return {
      upsert: async data => { if (!table.has(data[key])) table.set(data[key], { ...data }); return { error: null }; },
      select: () => ({ eq: (_key, id) => ({ single: async () => ({ data: { ...table.get(id) }, error: null }) }) }),
      update: data => ({ eq: async (_key, id) => { Object.assign(table.get(id), data); return { error: null }; } })
    };
  } };
  let pageResponse = 0;
  const pages = load('../lib/canva/pages.ts', { './security': security, './layout': layout, './template': {
    getTemplate: async () => ({ has_transparency: true, updated_at: reference.templateUpdatedAt }),
    sameTemplateSnapshot: (snapshot, value) => snapshot === value
  },
    './api': {
      access: async () => ({ token: 'token', connection: current }), sameAccount: () => {},
      canResumeDesignLink: canvaApi.canResumeDesignLink,
      dbError: error => { if (error) throw error; },
      getColor: async () => ({ color: { color_variant_number: 1, original_image_path: reference.sourcePath },
        product: { sku_optotica: 'GE-AC-003', frame_total_width_mm: 113,
          canva_reference_revision: reference.revision } }),
      getLink: async () => ({ ...db.catalog_canva_designs.get(colorId) }),
      lease: async (_admin, _table, _column, _id, run) => run(),
      api: async (_token, path, init) => {
        calls.push([path, init?.method]);
        if (changeReferencesOnPath && path.startsWith(changeReferencesOnPath)) {
          if (changeReferenceKind === 'photo' || changeReferenceKind === 'both') {
            reference.sourcePath = `${productId}/${colorId}-new.png`;
          }
          if (changeReferenceKind === 'revision' || changeReferenceKind === 'both') reference.revision += 1;
        }
        if (path === '/merges/MERGE') return { job: { status: 'success', result: { design: { id: 'D1' } } } };
        if (path.startsWith('/designs/')) {
          const items = pageResponses[Math.min(pageResponse, pageResponses.length - 1)];
          pageResponse += 1;
          return { items };
        }
        throw Error('Unexpected Canva path ' + path);
      }
    }
  });
  return { admin, calls, rpcCalls, db, pages, reference };
}

test('an imported Canva design keeps polling and accepts the 1080 square created by Canva', async () => {
  const fixture = existingCanvaPageWorkflow({ productDesignId: null, pageStage: 'imported', pageResponses: [
    [],
    [{ id: 'P1', page_number: 1 }],
    [{ id: 'P1', page_number: 1, dimensions: { width: 1080, height: 1080 } }]
  ] });
  assert.equal((await fixture.pages.ensureColorPage(fixture.admin, 'master', productId, colorId)).ready, false);
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_stage, 'imported');
  assert.equal((await fixture.pages.ensureColorPage(fixture.admin, 'master', productId, colorId)).ready, false);
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_id, null);
  assert.equal((await fixture.pages.ensureColorPage(fixture.admin, 'master', productId, colorId)).designId, 'SOURCE');
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_id, 'P1');
  assert.equal(fixture.calls.some(([, method]) => method === 'POST'), false);
});

test('a recoverable imported design is rechecked and bound without creating a duplicate', async () => {
  const fixture = existingCanvaPageWorkflow({ productDesignId: null, pageStage: 'recovery', pageResponses: [[
    { id: 'P1', page_number: 1, dimensions: { width: 1080, height: 1080 } }
  ]] });
  const result = await fixture.pages.ensureColorPage(fixture.admin, 'master', productId, colorId);
  assert.equal(result.designId, 'SOURCE');
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_id, 'P1');
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_stage, 'ready');
  assert.equal(fixture.calls.some(([, method]) => method === 'POST'), false);
});

test('a recoverable merged page is rechecked and bound without repeating the merge', async () => {
  const existing = { id: 'P1', page_number: 1, dimensions: { width: 540, height: 540 } };
  const fixture = existingCanvaPageWorkflow({ productDesignId: 'D1', pageStage: 'recovery', mergeJobId: 'MERGE',
    beforePageIds: ['P1'], pageResponses: [[
      existing,
      { id: 'P2', page_number: 2, dimensions: { width: 1080, height: 1080 } }
    ]] });
  const result = await fixture.pages.ensureColorPage(fixture.admin, 'master', productId, colorId);
  assert.equal(result.designId, 'D1');
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_id, 'P2');
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_stage, 'ready');
  assert.equal(fixture.calls.some(([, method]) => method === 'POST'), false);
});

test('a ready page is reopened through the atomic binding check when page and design still match', async () => {
  const fixture = existingCanvaPageWorkflow({ productDesignId: 'D1', pageStage: 'ready',
    pageId: 'P1', linkDesignId: 'D1', pageResponses: [[
      { id: 'P1', page_number: 1, dimensions: { width: 1080, height: 1080 } }
    ]] });
  const result = await fixture.pages.ensureColorPage(fixture.admin, 'master', productId, colorId);
  assert.equal(result.ready, true);
  assert.equal(result.designId, 'D1');
  assert.equal(fixture.rpcCalls.length, 1);
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_id, 'P1');
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).design_id, 'D1');
});

test('an imported page is not bound when its photo or measurement revision changes while Canva is responding', async () => {
  const fixture = existingCanvaPageWorkflow({ productDesignId: null, pageStage: 'imported',
    changeReferencesOnPath: '/designs/SOURCE', changeReferenceKind: 'photo', pageResponses: [[
      { id: 'P1', page_number: 1, dimensions: { width: 1080, height: 1080 } }
    ]] });
  await assert.rejects(fixture.pages.ensureColorPage(fixture.admin, 'master', productId, colorId),
    /mudaram durante a criação/);
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_id, null);
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).design_id, null);
});

test('a merged page is not bound when its photo or measurement revision changes while the merge job is completing', async () => {
  const fixture = existingCanvaPageWorkflow({ productDesignId: 'D1', pageStage: 'merging', beforePageIds: ['P1'],
    changeReferencesOnPath: '/merges/MERGE', changeReferenceKind: 'revision', pageResponses: [[
      { id: 'P1', page_number: 1, dimensions: { width: 540, height: 540 } },
      { id: 'P2', page_number: 2, dimensions: { width: 1080, height: 1080 } }
    ]] });
  await assert.rejects(fixture.pages.ensureColorPage(fixture.admin, 'master', productId, colorId),
    /mudaram durante a criação/);
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_id, null);
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).design_id, null);
});

test('atomic page binding rejects a reference change after the final application-level check', async () => {
  const fixture = existingCanvaPageWorkflow({ productDesignId: null, pageStage: 'imported',
    changeReferencesOnRpc: true, pageResponses: [[
      { id: 'P1', page_number: 1, dimensions: { width: 1080, height: 1080 } }
    ]] });
  await assert.rejects(fixture.pages.ensureColorPage(fixture.admin, 'master', productId, colorId),
    /referências ou o andamento/);
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_id, null);
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).design_id, null);
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_stage, 'imported');
  assert.equal(fixture.rpcCalls.length, 1);
});

test('atomic page binding rejects a large-model change after the final application-level check', async () => {
  const fixture = existingCanvaPageWorkflow({ productDesignId: null, pageStage: 'imported',
    changeTemplateOnRpc: true, pageResponses: [[
      { id: 'P1', page_number: 1, dimensions: { width: 1080, height: 1080 } }
    ]] });
  await assert.rejects(fixture.pages.ensureColorPage(fixture.admin, 'master', productId, colorId),
    /referências ou o andamento/);
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_id, null);
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_stage, 'imported');
  assert.equal(fixture.rpcCalls.length, 1);
});

test('atomic page binding also rejects a late reference change after a successful merge', async () => {
  const fixture = existingCanvaPageWorkflow({ productDesignId: 'D1', pageStage: 'merging', beforePageIds: ['P1'],
    changeReferencesOnRpc: true, pageResponses: [[
      { id: 'P1', page_number: 1, dimensions: { width: 540, height: 540 } },
      { id: 'P2', page_number: 2, dimensions: { width: 1080, height: 1080 } }
    ]] });
  await assert.rejects(fixture.pages.ensureColorPage(fixture.admin, 'master', productId, colorId),
    /referências ou o andamento/);
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_id, null);
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).design_id, null);
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_stage, 'merging');
  assert.equal(fixture.rpcCalls.length, 1);
});

test('complete but inconsistent imported page data enters recovery', async () => {
  const invalidResponses = [
    [{ id: 'P1', page_number: 2, dimensions: { width: 540, height: 540 } }],
    [{ id: 'P1', page_number: 1, dimensions: { width: 600, height: 540 } }],
    [{ id: 'P1', page_number: 1, dimensions: { width: 400, height: 400 } }],
    [
      { id: 'P1', page_number: 1, dimensions: { width: 540, height: 540 } },
      { id: 'P2', page_number: 2, dimensions: { width: 540, height: 540 } }
    ]
  ];
  for (const pageResponse of invalidResponses) {
    const fixture = existingCanvaPageWorkflow({ productDesignId: null, pageStage: 'imported', pageResponses: [pageResponse] });
    await assert.rejects(fixture.pages.ensureColorPage(fixture.admin, 'master', productId, colorId));
    assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_stage, 'recovery');
  }
});

test('a successful merge keeps polling while the inserted page is not visible or lacks metadata', async () => {
  const existing = { id: 'P1', page_number: 1, dimensions: { width: 540, height: 540 } };
  const fixture = existingCanvaPageWorkflow({ productDesignId: 'D1', pageStage: 'merging', beforePageIds: ['P1'], pageResponses: [
    [existing],
    [existing, { id: 'P2', page_number: 2 }],
    [existing, { id: 'P2', page_number: 2, dimensions: { width: 540, height: 540 } }]
  ] });
  assert.equal((await fixture.pages.ensureColorPage(fixture.admin, 'master', productId, colorId)).ready, false);
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_stage, 'merging');
  assert.equal((await fixture.pages.ensureColorPage(fixture.admin, 'master', productId, colorId)).ready, false);
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_id, null);
  assert.equal((await fixture.pages.ensureColorPage(fixture.admin, 'master', productId, colorId)).designId, 'D1');
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_id, 'P2');
  assert.equal(fixture.calls.some(([, method]) => method === 'POST'), false);
});

test('a successful merge still enters recovery when Canva pages changed inconsistently', async () => {
  const fixture = existingCanvaPageWorkflow({ productDesignId: 'D1', pageStage: 'merging', beforePageIds: ['P1'], pageResponses: [[
    { id: 'P1', page_number: 1, dimensions: { width: 540, height: 540 } },
    { id: 'P2', page_number: 2, dimensions: { width: 540, height: 540 } },
    { id: 'P3', page_number: 3, dimensions: { width: 540, height: 540 } }
  ]] });
  await assert.rejects(fixture.pages.ensureColorPage(fixture.admin, 'master', productId, colorId), /páginas do design mudaram/);
  assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_stage, 'recovery');
});

test('merge recovery rejects a missing or ambiguous snapshot of the previous page IDs', async () => {
  for (const beforePageIds of [null, [], ['P1', 'P1']]) {
    const fixture = existingCanvaPageWorkflow({ productDesignId: 'D1', pageStage: 'merging', beforePageIds, pageResponses: [[
      { id: 'P1', page_number: 1, dimensions: { width: 540, height: 540 } },
      { id: 'P2', page_number: 2, dimensions: { width: 540, height: 540 } }
    ]] });
    await assert.rejects(fixture.pages.ensureColorPage(fixture.admin, 'master', productId, colorId), /páginas anteriores/);
    assert.equal(fixture.db.catalog_canva_designs.get(colorId).page_stage, 'recovery');
  }
});
