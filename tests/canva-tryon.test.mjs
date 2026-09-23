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
  assert.equal(metadata.width, 1080); assert.equal(metadata.height, 1080); assert.equal(metadata.hasAlpha, true);
  const pixels = await sharp(output).ensureAlpha().raw().toBuffer();
  const pixel = (x, y) => [...pixels.subarray((y * 1080 + x) * 4, (y * 1080 + x) * 4 + 4)];
  assert.deepEqual(pixel(650, 540), [30, 40, 80, 255]);
  assert.equal(pixel(270, 540)[3], 0); assert.equal(pixel(540, 10)[3], 0);
  assert.equal(pixel(0, 540)[3], 255); assert.equal(pixel(1079, 540)[3], 255);
});
test('a completed preview is reused without issuing another paid export', async () => {
  const session = { id: sessionId, staged_path: 'prepared.png', saved_at: null };
  const workflow = load('../lib/canva/workflow.ts', { './security': security, './image': {},
    './api': { getSession: async () => session, lease: async (_a, _t, _c, _id, fn) => fn(),
      signedPreview: async () => 'https://preview.test/prepared.png',
      access: () => { throw Error('unexpected Canva request'); } } });
  const result = await workflow.exportSession({}, 'master', sessionId);
  assert.equal(result.status, 'ready'); assert.equal(result.previewUrl, 'https://preview.test/prepared.png');
});
test('saving requires a prepared preview and reports stale-photo conflicts', async () => {
  let session = { id: sessionId, staged_path: null, product_id: productId, color_id: colorId };
  const workflow = load('../lib/canva/workflow.ts', { './security': security, './image': {},
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
    '@/lib/canva/security': security,
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
