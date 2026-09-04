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
  entryPoints: { server: resolve(here, 'src/main.ts') },
  outdir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: {
    js: "import { createRequire as __hawkeyeCreateRequire } from 'node:module'; const require = __hawkeyeCreateRequire(import.meta.url);",
  },
  minify: production,
  sourcemap: production ? false : 'external',
  logLevel: 'info',
});

await copyFile(resolve(root, 'policy.json'), resolve(here, 'policy.json'));
