// Serve the pinned Python runtime and NumPy from our own site. Dataset contents
// never need to be sent to a runtime CDN. Build downloads are hash-checked.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const source = new URL('../node_modules/pyodide/', import.meta.url);
const lock = JSON.parse(await readFile(new URL('pyodide-lock.json', source), 'utf8'));
const version = lock.info.version;
const target = new URL(`../public/research-runtime/${version}/`, import.meta.url);
await mkdir(target, { recursive: true });
for (const name of ['pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) {
  await copyFile(new URL(name, source), new URL(name, target));
}
const copied = new Set();
async function wheel(name) {
  if (copied.has(name)) return;
  copied.add(name);
  const pkg = lock.packages[name];
  if (!pkg) throw new Error(`Missing runtime package: ${name}`);
  for (const dependency of pkg.depends) await wheel(dependency);
  const destination = new URL(pkg.file_name, target);
  const hash = data => createHash('sha256').update(data).digest('hex');
  try { if (hash(await readFile(destination)) === pkg.sha256) return; } catch { /* first build */ }
  const response = await fetch(`https://cdn.jsdelivr.net/pyodide/v${version}/full/${pkg.file_name}`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Runtime package download failed: ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (hash(data) !== pkg.sha256) throw new Error(`Runtime package checksum mismatch: ${name}`);
  await writeFile(destination, data);
}
await wheel('numpy');
console.log(`Prepared self-hosted research runtime ${version} with NumPy.`);
