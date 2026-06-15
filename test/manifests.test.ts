import { describe, it, expect } from 'vitest';
import { parsePackageJson, parseRequirementsTxt } from '../src/scan/manifests.js';

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
