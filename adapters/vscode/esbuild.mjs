import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const production = process.argv.includes('--production');
const outdir = resolve(here, 'dist');

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await esbuild.build({
  entryPoints: {
    extension: resolve(here, 'src/extension.ts'),
    runtime: resolve(here, 'src/runtime.ts'),
  },
  outdir,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  define: {
    'import.meta.url': '__HAWKEYE_BUNDLE_URL__',
  },
  banner: {
    js: 'const __HAWKEYE_BUNDLE_URL__ = require("node:url").pathToFileURL(__filename).href;',
  },
  minify: production,
  sourcemap: production ? false : 'external',
  logLevel: 'info',
});

await Promise.all([
  copyFile(resolve(root, 'LICENSE'), resolve(here, 'LICENSE')),
  copyFile(resolve(root, 'policy.json'), resolve(here, 'policy.json')),
  copyFile(resolve(root, 'assets/favicon/favicon-192.png'), resolve(here, 'icon.png')),
]);
