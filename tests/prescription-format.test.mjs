import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSignedSphere, formatDiopter, formatAxis, prescriptionNumber, normalizePrescriptionNumber, stepPrescriptionNumber } from '../lib/prescription-format.ts';

test('formats positive and zero spherical values with an explicit plus sign', () => {
  assert.equal(formatSignedSphere(0.75), '+0.75');
  assert.equal(formatSignedSphere('0,5'), '+0.50');
  assert.equal(formatSignedSphere(0), '+0.00');
});

test('keeps negative spherical values negative', () => {
  assert.equal(formatSignedSphere(-0.75), '-0.75');
  assert.equal(formatSignedSphere(-2), '-2.00');
});

test('formats cylinder and addition with two decimals and degrees only on axes', () => {
  assert.equal(formatDiopter('-2'), '-2.00');
  assert.equal(formatDiopter('0'), '0.00');
  assert.equal(formatDiopter('1,5'), '1.50');
  assert.equal(formatAxis('0'), '0°');
  assert.equal(formatAxis('180'), '180°');
});

test('keeps missing values empty instead of showing a zero prescription', () => {
  for (const value of [null, undefined, '', '  ', 'invalid']) {
    assert.equal(formatDiopter(value), '');
    assert.equal(formatAxis(value), '');
    assert.equal(formatSignedSphere(value), '');
  }
});

test('supports the comma separator used in the printable prescription', () => {
  assert.equal(formatSignedSphere(0.75, ','), '+0,75');
});

test('parses prescription values entered with comma or dot', () => {
  assert.equal(prescriptionNumber('+0,75'), 0.75);
  assert.equal(prescriptionNumber('-1.25'), -1.25);
  assert.equal(prescriptionNumber('invalid'), null);
});

test('steps spherical and cylindrical powers by quarters through zero', () => {
  let value = -0.50;
  const sequence = [];
  for (let i = 0; i < 4; i++) {
    value = stepPrescriptionNumber(value, 1, 0.25, -30, 30);
    sequence.push(formatSignedSphere(value));
  }
  assert.deepEqual(sequence, ['-0.25', '+0.00', '+0.25', '+0.50']);
  assert.equal(stepPrescriptionNumber('-2', -1, 0.25, -30, 30), -2.25);
  assert.equal(stepPrescriptionNumber('30', 1, 0.25, -30, 30), 30);
  assert.equal(stepPrescriptionNumber('-30', -1, 0.25, -30, 30), -30);
});

test('axis arrows move by five and stop at zero and 180 degrees', () => {
  assert.equal(stepPrescriptionNumber(0, 1, 5, 0, 180), 5);
  assert.equal(stepPrescriptionNumber(175, 1, 5, 0, 180), 180);
  assert.equal(stepPrescriptionNumber(180, 1, 5, 0, 180), 180);
  assert.equal(stepPrescriptionNumber(180, -1, 5, 0, 180), 175);
  assert.equal(stepPrescriptionNumber(0, -1, 5, 0, 180), 0);
});

test('saves formatted powers as numeric strings, including comma input', () => {
  assert.equal(normalizePrescriptionNumber('+0.25'), '0.25');
  assert.equal(normalizePrescriptionNumber('-2.00'), '-2');
  assert.equal(normalizePrescriptionNumber('-1,75'), '-1.75');
});
