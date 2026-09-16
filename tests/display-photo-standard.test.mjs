import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const sharp = require('sharp');
const module = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync(new URL('../lib/catalog/display-photo-standard.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText)(require, module, module.exports);
const { standardizeDisplayPhoto } = module.exports;

async function fixture(width, height, padding, background = '#ffffff') {
  const object = await sharp({ create: { width, height, channels: 3, background: '#284e85' } }).png().toBuffer();
  return sharp({ create: { width: width + padding * 2, height: height + padding * 2, channels: 3, background } }).composite([{ input: object, top: padding, left: padding }]).png().toBuffer();
}
async function bounds(buffer) {
  const { info } = await sharp(buffer).trim({ background: '#ffffff', threshold: 12 }).toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height };
}

test('same model/view has equal object size despite different source padding and scale', async () => {
  const reference = await fixture(600, 200, 20);
  const a = await standardizeDisplayPhoto(await fixture(300, 100, 130), reference);
  const b = await standardizeDisplayPhoto(await fixture(900, 300, 12), reference);
  assert.deepEqual(await bounds(a), await bounds(b));
  const meta = await sharp(a).metadata();
  assert.equal(meta.width, 1040); assert.equal(meta.height, 320); assert(a.length <= 200 * 1024);
});
test('neutral gray outer border is removed without resizing the product differently', async () => {
  const reference = await fixture(600, 200, 20);
  const white = await standardizeDisplayPhoto(await fixture(600, 200, 50), reference);
  const gray = await standardizeDisplayPhoto(await fixture(600, 200, 50, '#dddddd'), reference);
  assert.deepEqual(await bounds(white), await bounds(gray));
});
test('different aspect ratio is rejected instead of distorting the frame', async () => {
  await assert.rejects(standardizeDisplayPhoto(await fixture(500, 80, 30), await fixture(600, 200, 20)), /ângulo/);
});
test('without matching view, general layout preserves aspect ratio and safe margins', async () => {
  const output = await standardizeDisplayPhoto(await fixture(600, 100, 40));
  const size = await bounds(output);
  assert(Math.abs(size.width / size.height - 6) < 0.08);
  assert(size.width < 1040); assert(size.height < 320);
});
