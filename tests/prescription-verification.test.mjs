import test from 'node:test';
import assert from 'node:assert/strict';
import { maskPatientName, verificationCodePattern, formatPrescriptionDate } from '../lib/prescription-verification.ts';
test('public name masks every word including a single-name patient', () => {
  assert.equal(maskPatientName('  Maria da Silva '), 'M*** d*** S***');
  assert.equal(maskPatientName('Ana'), 'A***');
  assert.equal(maskPatientName('Érica'), 'É***');
  assert.equal(maskPatientName(''), '');
});
test('public lookup accepts only a full random code', () => {
  assert.ok(verificationCodePattern.test('a'.repeat(64)));
  for (const value of ['12345', 'a'.repeat(63), 'a'.repeat(65), '../private', 'x'.repeat(64)]) assert.equal(verificationCodePattern.test(value), false);
});
test('date-only values do not move to the previous day in Brazil', () => {
  assert.equal(formatPrescriptionDate('2026-09-16'), '16/09/2026');
  assert.equal(formatPrescriptionDate('invalid'), '—');
});
