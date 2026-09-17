import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSignedSphere, prescriptionNumber } from '../lib/prescription-format.ts';

test('formats positive and zero spherical values with an explicit plus sign', () => {
  assert.equal(formatSignedSphere(0.75), '+0.75');
  assert.equal(formatSignedSphere('0,5'), '+0.50');
  assert.equal(formatSignedSphere(0), '+0.00');
});

test('keeps negative spherical values negative', () => {
  assert.equal(formatSignedSphere(-0.75), '-0.75');
});

test('supports the comma separator used in the printable prescription', () => {
  assert.equal(formatSignedSphere(0.75, ','), '+0,75');
});

test('parses prescription values entered with comma or dot', () => {
  assert.equal(prescriptionNumber('+0,75'), 0.75);
  assert.equal(prescriptionNumber('-1.25'), -1.25);
  assert.equal(prescriptionNumber('invalid'), null);
});
