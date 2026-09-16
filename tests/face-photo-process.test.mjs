import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const sharp = require('sharp');
const testModule = { exports: {} };

new Function(
  'require', 'module', 'exports',
  ts.transpileModule(
    fs.readFileSync(new URL('../lib/tryon/face-photo-process.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }
  ).outputText
)(require, testModule, testModule.exports);

const { normalizeUploadedFacePhoto, parseFaceRotation, standardizeFacePhoto } = testModule.exports;

test('accepts one unambiguous supported face rotation', () => {
  assert.equal(parseFaceRotation('0'), 0);
  assert.equal(parseFaceRotation(['90']), 90);
  assert.equal(parseFaceRotation('180'), 180);
  assert.equal(parseFaceRotation('270'), 270);
  assert.equal(parseFaceRotation('rotate 90 degrees clockwise'), 90);
  assert.equal(parseFaceRotation('choose 0, 90, 180, or 270'), 0);
  assert.equal(parseFaceRotation('45'), 0);
});

test('physically applies phone EXIF orientation before AI processing', async () => {
  const source = await sharp({ create: { width: 300, height: 600, channels: 3, background: '#2255aa' } })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const normalized = await normalizeUploadedFacePhoto(source);
  const metadata = await sharp(normalized).metadata();
  assert.equal(metadata.width, 600);
  assert.equal(metadata.height, 300);
  assert.ok(metadata.orientation === undefined || metadata.orientation === 1);
});

test('removes gray letterbox bars and fills an exact square with the photograph', async () => {
  const photograph = await sharp({ create: { width: 1200, height: 600, channels: 3, background: '#2458a6' } })
    .png()
    .toBuffer();
  const letterboxed = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#d9d9d9' } })
    .composite([{ input: photograph, left: 0, top: 150 }])
    .png()
    .toBuffer();
  const result = await standardizeFacePhoto(letterboxed);
  const { data, info } = await sharp(result).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1024);
  assert.equal(info.height, 1024);
  for (const offset of [0, (info.width - 1) * info.channels, (info.height - 1) * info.width * info.channels]) {
    assert.ok(data[offset + 2] > data[offset], 'corner must contain the blue photograph, not a gray bar');
  }
  assert.ok(result.byteLength <= 400 * 1024);
});

test('uses a geometric center crop on both axes', async () => {
  const source = await sharp({ create: { width: 1200, height: 600, channels: 3, background: '#2458a6' } })
    .composite([
      { input: await sharp({ create: { width: 250, height: 600, channels: 3, background: '#ef4444' } }).png().toBuffer(), left: 0, top: 0 },
      { input: await sharp({ create: { width: 250, height: 600, channels: 3, background: '#22c55e' } }).png().toBuffer(), left: 950, top: 0 }
    ])
    .png()
    .toBuffer();
  const result = await standardizeFacePhoto(source);
  const { data, info } = await sharp(result).raw().toBuffer({ resolveWithObject: true });
  const middle = ((Math.floor(info.height / 2) * info.width) + Math.floor(info.width / 2)) * info.channels;
  assert.ok(data[middle + 2] > data[middle], 'the center of the original image must remain at the center of the square crop');
});
