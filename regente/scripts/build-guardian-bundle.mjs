import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = await readFile(resolve(root, 'regente/lib/guardian-context.ts'), 'utf8');
const section = manifest.split('export const GUARDIAN_SOURCE_MANIFEST = [')[1]?.split('] as const;')[0];
if (!section) throw new Error('Manifesto não encontrado');
const paths = [...section.matchAll(/path: "([^"]+)"/g)].map(match => match[1]);
const sources = await Promise.all(paths.map(async path => {
  if (path.includes('..') || !/^(regente\/|lib\/catalog\/|app\/api\/internal\/regente\/|supabase\/migrations\/)/.test(path) || !/\.(ts|md|sql)$/.test(path)) throw new Error('Fonte fora do manifesto permitido');
  const content = await readFile(resolve(root, path), 'utf8');
  return { path, content, sha256: createHash('sha256').update(content).digest('hex') };
}));
await writeFile(resolve(root, 'regente/lib/guardian-source-bundle.ts'), '// Generated from the explicit guardian manifest. Do not include credentials.\nexport const GUARDIAN_BUNDLED_SOURCES: Array<{ path: string; content: string; sha256: string }> = ' + JSON.stringify(sources) + ';\n');
process.stdout.write(`Guardian bundle: ${sources.length} files\n`);
