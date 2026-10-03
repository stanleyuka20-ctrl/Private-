// Production build: bundles the TypeScript sources with esbuild and assembles
// an unpacked Manifest V3 extension in dist/ (manifest.json at its root).
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const at = (...parts) => resolve(root, ...parts);

const pkg = JSON.parse(await readFile(at('package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(at('src/manifest.json'), 'utf8'));
if (manifest.version !== pkg.version) {
  throw new Error(`Version mismatch: package.json ${pkg.version} vs src/manifest.json ${manifest.version}`);
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: {
    'content/polymarket-us': 'src/content/entries/polymarket-us.ts',
    'content/kalshi': 'src/content/entries/kalshi.ts',
    'content/prophetx': 'src/content/entries/prophetx.ts',
    'content/novig': 'src/content/entries/novig.ts',
    'popup/popup': 'src/popup/popup.ts',
  },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: ['chrome111', 'edge111'],
  // Kept readable on purpose so the shipped code can be reviewed; tree-shaken and bundled.
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
});

await cp(at('src/popup/popup.html'), resolve(dist, 'popup/popup.html'));
await cp(at('src/popup/popup.css'), resolve(dist, 'popup/popup.css'));
await cp(at('public/icons'), resolve(dist, 'icons'), { recursive: true });
await cp(at('LICENSE'), resolve(dist, 'LICENSE'));
await writeFile(resolve(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Built American Odds Converter ${manifest.version} → dist/`);
