import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertReleaseTag, expectedReleaseTag } from '../scripts/lib/release-version.mjs';

describe('release version contract', () => {
  it('maps a package version to its exact release tag', () => {
    expect(expectedReleaseTag('1.4.0')).toBe('v1.4.0');
    expect(() => assertReleaseTag('1.4.0', 'v1.4.0')).not.toThrow();
  });

  it.each(['1.4.0', 'v1.4', 'v1.4.1', 'release-1.4.0'])('rejects mismatched tag %s', tag => {
    expect(() => assertReleaseTag('1.4.0', tag)).toThrow('does not match package version');
  });

  it('keeps MCP server metadata aligned with the npm package version', () => {
    const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    const serverSource = readFileSync(resolve('adapters/mcp/src/server.ts'), 'utf8');
    expect(serverSource).toContain(`{ name: 'oss-hawkeye', version: '${packageJson.version}' }`);
  });
});
