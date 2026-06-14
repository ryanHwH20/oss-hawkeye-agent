import { describe, it, expect, vi, afterEach } from 'vitest';
import { getVersionInfo } from '../src/api/deps-dev.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('in-flight request de-duplication (issue #9)', () => {
  it('collapses concurrent identical requests into a single fetch', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      await new Promise(r => setTimeout(r, 10));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          versionKey: { system: 'NPM', name: 'dedup-pkg', version: '9.9.9' },
          licenses: ['MIT'],
        }),
      };
    });

    const [a, b] = await Promise.all([
      getVersionInfo('NPM', 'dedup-pkg', '9.9.9'),
      getVersionInfo('NPM', 'dedup-pkg', '9.9.9'),
    ]);

    expect(calls).toBe(1);
    expect(a.value?.licenses).toEqual(['MIT']);
    expect(b.value?.licenses).toEqual(['MIT']);
  });
});
