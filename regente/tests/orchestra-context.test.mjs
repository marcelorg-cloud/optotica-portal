import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPhaseContext, reviewProvenance, INSTITUTIONAL_CONTEXT } from '../lib/orchestra-context.ts';
import { deliveryAcceptance } from '../lib/delivery-acceptance.ts';
import { failureDisposition } from '../lib/phase-control.ts';
import { buildOrchestraHealth } from '../lib/orchestra-health.ts';
import { loadGuardianSourceSnapshot } from '../lib/guardian-context.ts';
const step = { step: 2, nodes: ['A4'], role: 'revisão', input: 'Fonte', action: 'Revisar', expectedOutput: 'Parecer' };

test('partitura limita contexto total, preserva originais e não inventa fontes carregadas', () => {
  const artifacts = Array.from({ length: 10 }, (_, i) => ({ step: i, node: 'A1', output: 'x'.repeat(10000) }));
  const original = structuredClone(artifacts);
  const context = buildPhaseContext({ step, objective: 'Missão', artifacts, env: {} });
  assert.equal(context.metadata.evidence.length, 8);
  assert.equal(context.metadata.contextCharacters, 16000);
  assert.equal(context.metadata.technicalSourceState, 'index_only');
  assert.match(context.metadata.project, /não explicitado/);
  assert.ok(context.metadata.evidence.every(e => e.truncated && e.originalPreserved));
  assert.deepEqual(artifacts, original);
});
test('contexto redige segredos antes de truncar e revisão omite notas sem afirmar cegueira', () => {
  const secret = 'private-key-never-exposed-12345';
  const output = { result: 'Parecer ' + secret, notes: 'CONFIRME MINHA CONCLUSÃO', recovery: 'nota do autor' };
  const context = buildPhaseContext({ step, objective: secret, artifacts: [{ step: 1, node: 'A1', output }], review: true,
    env: { OPENAI_API_KEY: secret, REGENT_SOURCE_COMMIT: secret } });
  assert.ok(!context.text.includes(secret));
  assert.ok(!context.text.includes('CONFIRME MINHA CONCLUSÃO'));
  assert.equal(context.metadata.sourceCommit, null);
  assert.equal(context.metadata.reviewAnchoring, 'author_notes_omitted_not_fully_blind');
  assert.equal(output.notes, 'CONFIRME MINHA CONCLUSÃO');
  assert.equal(INSTITUTIONAL_CONTEXT.commercialDelivery.enabled, false);
  assert.equal(INSTITUTIONAL_CONTEXT.commercialDelivery.secondPairConditions, 'undefined');
});
test('revisor declara diversidade real e bloqueia requisito não atendido antes de consumir IA', () => {
  assert.equal(reviewProvenance({}).independence, 'separate_context_same_model');
  const evidence = reviewProvenance({ REGENT_WORKER_MODEL: 'model-a', REGENT_REVIEW_MODEL: 'model-b' }, 'different_model');
  assert.equal(evidence.modelDiversity, true); assert.equal(evidence.providerDiversity, false);
  assert.equal(evidence.fullyBlind, false);
  for (const [requirement, pattern] of [['different_model', /review_diversity_required/], ['external_human', /review_external_required/]]) {
    assert.throws(() => reviewProvenance({}, requirement), pattern);
    assert.equal(failureDisposition(new Error(pattern.source + ': bloqueio'), 'A4').retry, false);
  }
  assert.throws(() => reviewProvenance({ REGENT_REVIEW_MODEL: 'sk-proj-secret-value' }), /configuration_invalid/);
  const health = buildOrchestraHealth({ depth: 'basic', databaseOperational: true, env: { REGENT_REVIEW_MODEL: 'sk-proj-secret-value' } });
  assert.equal(health.governance.review.configurationValid, false);
  assert.ok(!JSON.stringify(health).includes('sk-proj-secret-value'));
});
test('aceite técnico não declara entrega, aprovação de cor ou publicação', () => {
  const acceptance = deliveryAcceptance({ catalog: { complete: true, width: 1040, height: 320, bytes: 10000, sha256: 'a'.repeat(64), originalPreserved: true } }, 'F4');
  assert.equal(acceptance.technicalAccepted, true);
  assert.equal(acceptance.deliveredToRecipient, false);
  assert.equal(acceptance.humanAccepted, false);
  assert.equal(acceptance.publicationPerformed, false);
  assert.equal(acceptance.checks.find(c => c.id === 'product_fidelity').state, 'pending');
  assert.equal(deliveryAcceptance({}, 'F4').technicalAccepted, false);
  assert.equal(failureDisposition(new Error('timeout'), 'F4').retry, false);
});
test('guardião carrega só arquivos do índice solicitados, nunca um caminho arbitrário', async () => {
  const paths = ['regente/lib/orchestra-context.ts', '.env'];
  const result = await loadGuardianSourceSnapshot({ paths, env: {}, bundledSources: [], fetchImpl: () => { throw new Error('Não chamar rede'); } });
  assert.deepEqual(result.map(s => s.path), ['regente/lib/orchestra-context.ts']);
  assert.equal(result[0].state, 'unversioned');
});
