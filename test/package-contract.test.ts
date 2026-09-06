import { describe, expect, it } from 'vitest';
import {
  assertPackageFiles,
  missingPackageFiles,
  REQUIRED_PACKAGE_FILES,
} from '../scripts/lib/package-contract.mjs';

describe('npm package artifact contract', () => {
  it('accepts a manifest containing every required Agent-Native artifact', () => {
    const files = REQUIRED_PACKAGE_FILES.map(path => ({ path, size: 1 }));
    expect(missingPackageFiles(files)).toEqual([]);
    expect(() => assertPackageFiles(files)).not.toThrow();
  });

  it('reports every missing artifact instead of stopping at the first one', () => {
    const files = REQUIRED_PACKAGE_FILES
      .filter(path => !['adapters/claude-code.mjs', 'skills/oss-hawkeye/SKILL.md'].includes(path))
      .map(path => ({ path }));

    expect(missingPackageFiles(files)).toEqual([
      'adapters/claude-code.mjs',
      'skills/oss-hawkeye/SKILL.md',
    ]);
    expect(() => assertPackageFiles(files)).toThrow([
      'npm package is missing required artifacts:',
      '- adapters/claude-code.mjs',
      '- skills/oss-hawkeye/SKILL.md',
    ].join('\n'));
  });
});
