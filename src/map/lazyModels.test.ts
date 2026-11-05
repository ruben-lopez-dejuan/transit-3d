import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;

/** Every module the browser has to download before the app can run. */
function startupModules(entry: string) {
  const seen = new Set<string>(), packages = new Set<string>(), pending = [path.resolve(entry)];
  while (pending.length) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, specifier] of fs.readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      if (!specifier.startsWith('.')) { packages.add(specifier); continue; }
      const target = path.resolve(path.dirname(file), specifier);
      const source = [target, target + '.ts'].find((candidate) => candidate.endsWith('.ts') && fs.existsSync(candidate));
      if (source) pending.push(source);
    }
  }
  return { files: [...seen].map((file) => path.basename(file)), packages: [...packages] };
}

test('the app starts without the 3D engine, so the stops do not wait for its download', () => {
  const { files, packages } = startupModules('src/app.ts');
  assert.ok(files.includes('transitRenderer.ts') && files.includes('vehicleRoles.ts'), 'the walk follows the imports of the app');
  assert.ok(packages.includes('maplibre-gl'), 'the walk sees the packages of the app');
  assert.deepEqual(packages.filter((name) => name === 'three' || name.startsWith('three/')), []);
  assert.deepEqual(files.filter((name) => name === 'vehicleShapes.ts' || name === 'vehicleModels.ts'), []);
});
