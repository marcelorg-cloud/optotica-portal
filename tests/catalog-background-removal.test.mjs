import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const sharp = require('sharp');

function loadModule({ ReplicateMock = class {}, standardizeDisplayPhoto = async (buffer) => buffer } = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(
    new URL('../lib/catalog/gallery-background-removal.ts', import.meta.url),
    'utf8'
  );

  new Function(
    'require',
    'module',
    'exports',
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true
      }
    }).outputText
  )(
    (name) => {
      if (name === 'replicate') return ReplicateMock;
      if (name === './display-photo-standard') return { standardizeDisplayPhoto };
      return require(name);
    },
    module,
    module.exports
  );

  return module.exports;
}

async function rgbFixture(width, height) {
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < data.length; i += 3) {
    data[i] = (i * 7) % 251;
    data[i + 1] = (i * 11) % 251;
    data[i + 2] = (i * 13) % 251;
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function maskFixture(width, height, visibleWidth = width, visibleHeight = height, value = 255) {
  const data = Buffer.alloc(width * height, 0);
  for (let y = 0; y < visibleHeight; y += 1) {
    for (let x = 0; x < visibleWidth; x += 1) {
      data[y * width + x] = value;
    }
  }
  return sharp(data, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

test('preserves source RGB and zeros alpha values below 16', async () => {
  const { applyBackgroundMaskToOriginal } = loadModule();

  const sourcePixels = Buffer.from([
    12, 34, 56,
    78, 90, 123,
    210, 180, 140,
    9, 8, 7
  ]);
  const source = await sharp(sourcePixels, {
    raw: { width: 4, height: 1, channels: 3 }
  }).png().toBuffer();

  const mask = await sharp(Buffer.from([255, 15, 255, 0]), {
    raw: { width: 4, height: 1, channels: 1 }
  }).png().toBuffer();

  const result = await applyBackgroundMaskToOriginal(source, mask);
  const { data, info } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });

  assert.equal(info.channels, 4);
  assert.deepEqual([...data.slice(0, 4)], [12, 34, 56, 255]);
  assert.deepEqual([...data.slice(4, 8)], [78, 90, 123, 0]);
  assert.deepEqual([...data.slice(8, 12)], [210, 180, 140, 255]);
  assert.deepEqual([...data.slice(12, 16)], [9, 8, 7, 0]);
});

test('rejects a non-normal EXIF orientation before converting the source', async () => {
  const { applyBackgroundMaskToOriginal } = loadModule();
  const source = await sharp({
    create: { width: 200, height: 80, channels: 3, background: '#123456' }
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const mask = await maskFixture(200, 80);

  await assert.rejects(
    applyBackgroundMaskToOriginal(source, mask),
    /orientação EXIF 6/
  );
});

test('rejects mask aspect ratios that differ by more than one percent', async () => {
  const { applyBackgroundMaskToOriginal } = loadModule();
  const source = await rgbFixture(200, 100);
  const mask = await maskFixture(200, 90);

  await assert.rejects(
    applyBackgroundMaskToOriginal(source, mask),
    /proporção diferente/
  );
});

test('resizes a same-ratio mask without rejecting it', async () => {
  const { applyBackgroundMaskToOriginal } = loadModule();
  const source = await rgbFixture(200, 100);
  const mask = await maskFixture(100, 50);

  const result = await applyBackgroundMaskToOriginal(source, mask);
  assert(Math.abs(result.visibleBoxRatio - 2) < 0.02);

  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.width, 200);
  assert.equal(metadata.height, 100);
});

test('content guard rejects 1.29 and accepts 1.31 width/height', async () => {
  const { applyBackgroundMaskToOriginal, MIN_FRAME_BBOX_RATIO } = loadModule();
  assert.equal(MIN_FRAME_BBOX_RATIO, 1.3);

  const source = await rgbFixture(140, 100);
  const tooTall = await maskFixture(140, 100, 129, 100);
  const frameLike = await maskFixture(140, 100, 131, 100);

  await assert.rejects(
    applyBackgroundMaskToOriginal(source, tooTall),
    /pessoa ou algo além da armação/
  );

  const accepted = await applyBackgroundMaskToOriginal(source, frameLike);
  assert(accepted.visibleBoxRatio >= 1.3);
});

test('processCatalogDisplayPhoto makes exactly one pinned BiRefNet call', async () => {
  let replicateCalls = 0;
  let receivedModel = null;
  let receivedInput = null;

  class ReplicateMock {
    async run(model, options) {
      replicateCalls += 1;
      receivedModel = model;
      receivedInput = options.input;
      return 'https://mask.test/mask.png';
    }
  }

  const source = await rgbFixture(300, 100);
  const mask = await maskFixture(300, 100);

  const previousFetch = global.fetch;
  const previousToken = process.env.REPLICATE_API_TOKEN;
  process.env.REPLICATE_API_TOKEN = 'test-token';

  global.fetch = async (url) => {
    const value = String(url);
    if (value === 'https://candidate.test/frame.png') {
      return new Response(source, { status: 200 });
    }
    if (value === 'https://mask.test/mask.png') {
      return new Response(mask, { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };

  try {
    const { processCatalogDisplayPhoto } = loadModule({ ReplicateMock });
    const result = await processCatalogDisplayPhoto('https://candidate.test/frame.png');

    assert(result.buffer.length > 0);
    assert.equal(replicateCalls, 1);
    assert.equal(
      receivedModel,
      'sprited/birefnet:21f2c4a9159af128ab9b9126401eebe7f8c5310841ed628b74a4c462df00da67'
    );
    assert.deepEqual(receivedInput, {
      image: 'https://candidate.test/frame.png',
      variant: 'general-hr',
      resolution: 0,
      output_format: 'mask',
      mask_blur: 0,
      mask_offset: 0,
      refine_fg: false,
      precision: 'fp32'
    });
  } finally {
    global.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.REPLICATE_API_TOKEN;
    else process.env.REPLICATE_API_TOKEN = previousToken;
  }
});
