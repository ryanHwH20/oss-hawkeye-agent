import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePackageJson, parseRequirementsTxt, parsePackageLock, detectManifests } from '../src/scan/manifests.js';
import { lockfileWeakIntegrity } from '../src/scan/scan.js';

describe('parsePackageJson (issue #23)', () => {
  it('extracts dependencies + devDependencies and reduces ranges to concrete versions', () => {
    const deps = parsePackageJson(JSON.stringify({
      dependencies: { express: '^4.17.1', lodash: '4.17.21' },
      devDependencies: { vitest: '~1.2.0' },
    }));
    expect(deps).toContainEqual({ ecosystem: 'NPM', name: 'express', version: '4.17.1' });
    expect(deps).toContainEqual({ ecosystem: 'NPM', name: 'lodash', version: '4.17.21' });
    expect(deps).toContainEqual({ ecosystem: 'NPM', name: 'vitest', version: '1.2.0' });
  });

  it('leaves the version undefined for non-registry / wildcard specs', () => {
    const deps = parsePackageJson(JSON.stringify({
      dependencies: { a: '*', b: 'workspace:*', c: 'git+https://x/y.git', d: 'file:../local' },
    }));
    for (const d of deps) expect(d.version).toBeUndefined();
  });
});

describe('parseRequirementsTxt (issue #23)', () => {
  it('parses == pins, skips comments and options, leaves ranges unversioned', () => {
    const deps = parseRequirementsTxt(
      ['# a comment', 'requests==2.31.0', 'flask>=2.0', '-r other.txt', 'numpy', ''].join('\n')
    );
    expect(deps).toContainEqual({ ecosystem: 'PYPI', name: 'requests', version: '2.31.0' });
    expect(deps).toContainEqual({ ecosystem: 'PYPI', name: 'flask', version: undefined });
    expect(deps).toContainEqual({ ecosystem: 'PYPI', name: 'numpy', version: undefined });
    expect(deps.some(d => d.name === 'other.txt')).toBe(false); // -r option skipped
  });
});

describe('parsePackageLock — resolved versions (Staff review #3)', () => {
  it('reads direct deps at their RESOLVED versions from a v3 lockfile', () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { express: '^4.17.1' }, devDependencies: { vitest: '~1.2.0' } },
        'node_modules/express': { version: '4.21.2' }, // resolved, not the ^4.17.1 floor
        'node_modules/vitest': { version: '1.2.9' },
        'node_modules/transitive-dep': { version: '9.9.9' }, // not a direct dep → excluded
      },
    });
    const deps = parsePackageLock(lock);
    expect(deps).toContainEqual({ ecosystem: 'NPM', name: 'express', version: '4.21.2' });
    expect(deps).toContainEqual({ ecosystem: 'NPM', name: 'vitest', version: '1.2.9' });
    expect(deps.some(d => d.name === 'transitive-dep')).toBe(false);
  });

  it('reads a v1 lockfile flat dependencies map', () => {
    const lock = JSON.stringify({
      lockfileVersion: 1,
      dependencies: { lodash: { version: '4.17.21' }, chalk: { version: '4.1.2' } },
    });
    const deps = parsePackageLock(lock);
    expect(deps).toContainEqual({ ecosystem: 'NPM', name: 'lodash', version: '4.17.21', integrity: undefined });
    expect(deps).toContainEqual({ ecosystem: 'NPM', name: 'chalk', version: '4.1.2', integrity: undefined });
  });

  it('captures the integrity hash when present, undefined when absent', () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { signed: '^1.0.0', unsigned: '^1.0.0' } },
        'node_modules/signed': { version: '1.0.0', integrity: 'sha512-abc' },
        'node_modules/unsigned': { version: '1.0.0' },
      },
    });
    const deps = parsePackageLock(lock);
    expect(deps.find(d => d.name === 'signed')?.integrity).toBe('sha512-abc');
    expect(deps.find(d => d.name === 'unsigned')?.integrity).toBeUndefined();
  });
});

describe('lockfileWeakIntegrity', () => {
  it('flags only resolved lockfile deps that lack an integrity hash', () => {
    const weak = lockfileWeakIntegrity([
      { file: 'package-lock.json', dependencies: [
        { ecosystem: 'NPM', name: 'signed', version: '1.0.0', integrity: 'sha512-x' },
        { ecosystem: 'NPM', name: 'unsigned', version: '2.0.0' },
        { ecosystem: 'NPM', name: 'noversion' }, // unresolved (git/file) — not flagged
      ] },
      { file: 'package.json', dependencies: [{ ecosystem: 'NPM', name: 'fromjson', version: '1.0.0' }] }, // not a lockfile
    ]);
    expect(weak).toEqual(['unsigned@2.0.0']);
  });
});

describe('detectManifests — prefers the lockfile over package.json', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'hawkeye-manifests-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { express: '^4.17.1' } }));
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: { '': { dependencies: { express: '^4.17.1' } }, 'node_modules/express': { version: '4.21.2' } },
    }));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('audits the lockfile (resolved version), not the manifest range floor', () => {
    const found = detectManifests(dir);
    expect(found).toHaveLength(1);
    expect(found[0].file).toBe('package-lock.json');
    expect(found[0].dependencies).toContainEqual({ ecosystem: 'NPM', name: 'express', version: '4.21.2' });
  });
});
