import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function load(file, mocks = {}) {
  const loadedModule = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  new Function('require', 'module', 'exports', output)(name => mocks[name] ?? require(name), loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const phone = load('../lib/phone.ts');
const login = load('../lib/auth/whatsapp-login.ts', {
  '@/lib/env': { serverEnv: { supabaseSecretKey: () => 'test-secret-with-enough-entropy' } },
  '@/lib/phone': phone
});

test('WhatsApp login normalizes Brazilian numbers with or without the extra ninth digit', () => {
  assert.equal(login.normalizeLoginPhone('(44) 99999-9999'), '+554499999999');
  assert.equal(login.normalizeLoginPhone('+55 44 9999-9999'), '+554499999999');
  assert.equal(login.normalizeLoginPhone('123'), '');
});

test('one-time code hashes are bound to challenge, phone and code', () => {
  const hash = login.challengeHash('challenge-a', '+554499999999', '123456');
  assert.equal(login.safeHashEqual(hash, login.challengeHash('challenge-a', '+554499999999', '123456')), true);
  assert.equal(login.safeHashEqual(hash, login.challengeHash('challenge-b', '+554499999999', '123456')), false);
  assert.equal(login.safeHashEqual(hash, login.challengeHash('challenge-a', '+554499999999', '654321')), false);
});

test('WhatsApp login mutations require the portal origin', () => {
  assert.equal(login.isSameOrigin(new Request('https://portal.test/api', { headers: { origin: 'https://portal.test' } })), true);
  assert.equal(login.isSameOrigin(new Request('https://portal.test/api', { headers: { origin: 'https://evil.test' } })), false);
  assert.equal(login.isSameOrigin(new Request('https://portal.test/api')), false);
});

test('stored account choices accept only complete known shapes', () => {
  const valid = { key: 'choice', userId: 'user', label: 'Conta — Profissional', kind: 'professional', redirectTo: '/profissional' };
  assert.deepEqual(login.parseStoredCandidates([valid, { ...valid, redirectTo: '/admin' }, null]), [valid]);
});

test('WhatsApp challenge migration keeps codes server-only and resets Canva atomically', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20260930015247_whatsapp_login_challenges.sql', import.meta.url), 'utf8');
  assert.match(sql, /alter table public\.whatsapp_login_challenges enable row level security/);
  assert.match(sql, /revoke all on table public\.whatsapp_login_challenges from anon, authenticated/);
  assert.match(sql, /attempts smallint not null default 0 check \(attempts between 0 and 5\)/);
  assert.match(sql, /where product_id = p_product_id and saved_at is null and expires_at > now\(\)/);
  assert.match(sql, /delete from public\.catalog_canva_designs where product_id = p_product_id/);
  assert.match(sql, /delete from public\.canva_product_designs where product_id = p_product_id/);
});
