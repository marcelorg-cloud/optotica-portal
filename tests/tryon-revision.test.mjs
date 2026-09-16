import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tryonRevision, isCurrentTryon } from '../lib/tryon/revision.ts';
import { computeOverlayGeometry } from '../lib/tryon/geometry.ts';

const source = { dnp_od: 31, dnp_oe: 29, dnp_measured_at: '2026-09-16T12:00:00.000Z', tryon_face_validated_at: '2026-09-15T12:00:00Z' };

test('every save invalidates old images even with unchanged DNP', () => {
  const revision = tryonRevision(source);
  const path = `org/client/display/product-color-${revision}.png`;
  assert.ok(isCurrentTryon(path, revision));
  assert.equal(isCurrentTryon(path, tryonRevision({ ...source, dnp_measured_at: '2026-09-16T12:01:00Z' })), false);
});

test('DNP edits and official photo validation invalidate old images', () => {
  const revision = tryonRevision(source);
  assert.notEqual(revision, tryonRevision({ ...source, dnp_od: 32 }));
  assert.notEqual(revision, tryonRevision({ ...source, dnp_oe: 30 }));
  assert.notEqual(revision, tryonRevision({ ...source, tryon_face_validated_at: '2026-09-16T12:02:00Z' }));
  assert.equal(isCurrentTryon('org/client/display/product-color.png', revision), false);
  assert.equal(isCurrentTryon(null, revision), false);
});

test('numeric DB strings and equivalent timestamps produce stable revision', () => {
  assert.equal(tryonRevision(source), tryonRevision({ ...source, dnp_od: '31', dnp_oe: '29', dnp_measured_at: '2026-09-16T09:00:00-03:00' }));
});

test('frame proportions use total DNP: 31+29=60 vs 40+40=80', () => {
  const input = { pupilA: { x: 100, y: 100 }, pupilB: { x: 400, y: 100 }, frameWidthMm: 140, frameAspectRatio: 0.4 };
  const at60 = computeOverlayGeometry({ ...input, dnpTotalMm: 31 + 29 });
  const at80 = computeOverlayGeometry({ ...input, dnpTotalMm: 40 + 40 });
  assert.equal(at60.widthPx, 700);
  assert.equal(at80.widthPx, 525);
  assert.equal(at60.heightPx / at60.widthPx, at80.heightPx / at80.widthPx);
  assert.equal(computeOverlayGeometry({ ...input, dnpTotalMm: 0 }), null);
});
