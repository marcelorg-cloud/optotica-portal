import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePrescriptionEye } from '../lib/prescription-values.ts';
import { formatSignedSphere, stepPrescriptionNumber } from '../lib/prescription-format.ts';
const valid = { esferico: -2, cilindrico: -1.75, eixo: 180, adicao: 1.75 };
test('accepts negative cylinder, nonnegative addition and both sphere signs', () => {
  assert.deepEqual(parsePrescriptionEye(valid), valid);
  assert.deepEqual(parsePrescriptionEye({ ...valid, esferico: '+2.00', cilindrico: '0.00', adicao: '+0.00' }), { ...valid, esferico: 2, cilindrico: 0, adicao: 0 });
});
test('rejects positive cylinders and negative additions in save requests', () => {
  assert.equal(parsePrescriptionEye({ ...valid, cilindrico: 0.25 }), null);
  assert.equal(parsePrescriptionEye({ ...valid, adicao: -0.25 }), null);
});
test('rejects missing fields and preserves axis and power bounds', () => {
  for (const change of [{ eixo:181 }, { eixo:-5 }, { adicao:6.25 }, { cilindrico:-30.25 }, { adicao:null }, { cilindrico:'' }, { esferico:Infinity }]) {
    assert.equal(parsePrescriptionEye({ ...valid, ...change }), null);
  }
});
test('cylinder arrows stop at zero and addition is displayed with a plus sign', () => {
  assert.equal(stepPrescriptionNumber(0, 1, 0.25, -30, 0), 0);
  assert.equal(stepPrescriptionNumber(0, -1, 0.25, -30, 0), -0.25);
  assert.equal(stepPrescriptionNumber(0, -1, 0.25, 0, 6), 0);
  assert.equal(formatSignedSphere(1.75), '+1.75');
  assert.equal(formatSignedSphere(0), '+0.00');
});
