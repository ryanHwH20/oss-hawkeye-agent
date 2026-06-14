import { describe, it, expect } from 'vitest';
import { mapLimit } from '../src/util/concurrency.js';

describe('mapLimit (issue #9)', () => {
  it('preserves input order regardless of completion order', async () => {
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      await new Promise(r => setTimeout(r, (6 - n) * 2)); // later items finish sooner
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 25 }, (_, i) => i), 4, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 3));
      active--;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // sanity: it actually ran in parallel
  });

  it('returns an empty array for empty input', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
});
