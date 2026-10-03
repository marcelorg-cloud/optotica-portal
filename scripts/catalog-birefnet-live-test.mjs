import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function transpileLoad(filePath, mocks = {}) {
  const module = { exports: {} };
  const source = require('node:fs').readFileSync(filePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText;
  new Function('require', 'module', 'exports', compiled)(
    (name) => mocks[name] ?? require(name),
    module,
    module.exports
  );
  return module.exports;
}

const root = process.cwd();
const display = transpileLoad(path.join(root, 'lib/catalog/display-photo-standard.ts'));
const background = transpileLoad(
  path.join(root, 'lib/catalog/gallery-background-removal.ts'),
  { './display-photo-standard': display }
);

const samples = [
  {
    id: 'qt-ac-004-transparente',
    sku: 'QT-AC-004',
    category: 'transparente',
    url: 'https://ae01.alicdn.com/kf/H155cdfc6cbef4d679ff6f9ab59ad73c0d.jpg'
  },
  {
    id: 'rd-mt-005-dourado',
    sku: 'RD-MT-005',
    category: 'metal-fino-unprocessed-own',
    url: 'https://ae-pic-a1.aliexpress-media.com/kf/Scc895228b913488caf0de0922fd8b1f8n.jpg'
  },
  {
    id: 'ge-ac-003-tartaruga',
    sku: 'GE-AC-003',
    category: 'tartaruga',
    url: 'https://ae-pic-a1.aliexpress-media.com/kf/S99b763a52c814ce3a7be2e3326ec28aaE.jpg'
  },
  {
    id: 'rd-mt-005-gallery-1',
    sku: 'RD-MT-005',
    category: 'gallery-never-processed',
    url: 'https://ae-pic-a1.aliexpress-media.com/kf/Sa57be555fba74dfb8d99aed64c223a2em.jpg'
  },
  {
    id: 'qt-ac-004-gallery-1',
    sku: 'QT-AC-004',
    category: 'gallery-never-processed',
    url: 'https://ae-pic-a1.aliexpress-media.com/kf/HTB1RnyncRKw3KVjSZTEq6AuRpXak.jpg'
  },
  {
    id: 'ge-ac-003-gallery-1',
    sku: 'GE-AC-003',
    category: 'gallery-never-processed',
    url: 'https://ae-pic-a1.aliexpress-media.com/kf/Scc0646083f224d149ea8ee204c194fbeJ.jpg'
  }
];

const outputDir = path.join(root, 'artifacts/catalog-birefnet-live');
await fs.mkdir(outputDir, { recursive: true });

const results = [];
for (const sample of samples) {
  const sourceResponse = await fetch(sample.url);
  if (!sourceResponse.ok) {
    results.push({ ...sample, ok: false, error: `source HTTP ${sourceResponse.status}` });
    continue;
  }

  const sourceBuffer = Buffer.from(await sourceResponse.arrayBuffer());
  await fs.writeFile(path.join(outputDir, `${sample.id}-before.jpg`), sourceBuffer);

  const wallStartedAt = Date.now();
  try {
    const result = await background.processCatalogDisplayPhoto(sample.url);
    await fs.writeFile(path.join(outputDir, `${sample.id}-after.jpg`), result.buffer);
    results.push({
      ...sample,
      ok: true,
      aiDurationMs: result.aiDurationMs,
      totalDurationMs: result.totalDurationMs,
      wallDurationMs: Date.now() - wallStartedAt,
      visibleBoxRatio: Number(result.visibleBoxRatio.toFixed(4)),
      inputBytes: sourceBuffer.length,
      outputBytes: result.buffer.length
    });
  } catch (error) {
    results.push({
      ...sample,
      ok: false,
      wallDurationMs: Date.now() - wallStartedAt,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

await fs.writeFile(
  path.join(outputDir, 'results.json'),
  JSON.stringify(results, null, 2)
);

console.log(JSON.stringify(results, null, 2));
if (!results.some((row) => row.ok)) process.exitCode = 1;
