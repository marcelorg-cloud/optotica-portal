import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { planningFailure } from '../lib/planning-failure.ts';
const require = createRequire(import.meta.url);
const { convertAgentOutputTypeToSerializable } = require('../node_modules/@openai/agents-core/dist/utils/tools.js');
const { UserError } = require('../node_modules/@openai/agents-core/dist/errors.js');
function loadPlanner(regression = false) {
  let source = readFileSync(new URL('../lib/regente.ts', import.meta.url), 'utf8');
  if (regression) source = source.replaceAll('.nullable().optional()', '.optional()');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, process: { env: {} }, require: name => {
    if (name === '@openai/agents') return { Agent: class {}, run() { throw new Error('No external APIs in tests'); } };
    if (name === 'zod') return require(name);
    return { CONSTITUTION_TEXT: '', NODE_SUMMARY: '', INSTITUTIONAL_CONTEXT: {}, ORCHESTRA_ROLES: [] };
  } });
  return exports;
}
test('planner SDK emits a strict compatible wire schema, including nullable optional fields', () => {
  const wire = convertAgentOutputTypeToSerializable(loadPlanner().RegentOutput);
  assert.equal(wire.strict, true);
  let objects = 0;
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object') {
      objects++;
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
    }
    Object.values(node).forEach(value => Array.isArray(value) ? value.forEach(walk) : walk(value));
  }
  walk(wire.schema);
  assert.ok(objects >= 5);
  assert.throws(() => convertAgentOutputTypeToSerializable(loadPlanner(true).RegentOutput), /optional.*nullable/s);
});
test('nullable wire fields normalize without erasing humanDecision or real catalog IDs', () => {
  const planner = loadPlanner();
  const normalized = planner.normalizePlannerOutput({ humanDecision: null, pipeline: [{
    step: 2, canvaMode: null, onUnavailable: null, project: 'Optótica', catalogMode: 'standardize',
    catalogProductId: '2a806911-3ce1-4fc7-9de9-19df90767788', catalogColorImageId: null,
  }] });
  assert.equal(normalized.humanDecision, null);
  assert.equal(normalized.pipeline[0].canvaMode, undefined);
  assert.equal(normalized.pipeline[0].catalogMode, 'standardize');
  assert.equal(normalized.pipeline[0].catalogProductId, '2a806911-3ce1-4fc7-9de9-19df90767788');
  assert.ok(!JSON.stringify(normalized.pipeline).includes(':null'));
});
test('planning diagnoses are static, actionable and never disclose provider secrets', () => {
  const errors = [new UserError('Schema field private sk-proj-secret-value'),
    { code: 'invalid_json_schema', message: 'secret' }, { code: 'invalid_api_key', message: 'secret' },
    { code: 'insufficient_quota', message: 'secret' }, { code: 'model_not_found', message: 'secret' },
    { name: 'TimeoutError', message: 'secret' }, { code: 'rate_limit_exceeded', message: 'secret' },
    { code: 'sk-proj-secret-value', message: 'secret' }, null];
  for (const error of errors) {
    const diagnostic = planningFailure(error);
    assert.ok(diagnostic.action.length > 20);
    assert.ok(!JSON.stringify(diagnostic).includes('secret'));
  }
  assert.equal(planningFailure(errors[0]).code, 'planning_schema_invalid');
  assert.equal(planningFailure(errors[0]).retryable, false);
  assert.equal(planningFailure({ name: 'AbortError' }).retryable, true);
});
test('planning failure is persisted and the front restores the server conversation', () => {
  const route = readFileSync(new URL('../app/api/regente/route.ts', import.meta.url), 'utf8');
  const front = readFileSync(new URL('../app/regente-client.tsx', import.meta.url), 'utf8');
  assert.match(route, /user_id: auth.userId, role: "assistant", content: message/);
  assert.match(route, /sessionId: failureSessionId, userMessageSaved, createdTaskId/);
  assert.match(front, /data.sessionId && data.userMessageSaved[\s\S]*await openSession\(data.sessionId\)/);
});
