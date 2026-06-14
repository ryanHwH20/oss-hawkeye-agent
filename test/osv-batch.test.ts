import { describe, it, expect, vi, afterEach } from 'vitest';
import { queryVulnerabilitiesBatch } from '../src/api/osv.js';

function jsonResponse(data: unknown, init: { ok?: boolean; status?: number } = {}): unknown {
  const { ok = true, status = 200 } = init;
  return { ok, status, json: async () => data };
}

// A CVSS 9.8 vector (CRITICAL) for the hydrated detail records.
const CRITICAL_VECTOR = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('queryVulnerabilitiesBatch (issue #9)', () => {
  it('uses one batch call and hydrates each unique vuln id once, mapped per target', async () => {
    let batchCalls = 0;
    const hydratedIds: string[] = [];

    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url);
      if (u.endsWith('/querybatch')) {
        batchCalls++;
        return jsonResponse({
          results: [
            { vulns: [{ id: 'OSV-1' }] },
            {}, // second target: no vulns
            { vulns: [{ id: 'OSV-1' }, { id: 'OSV-2' }] }, // OSV-1 repeated
          ],
        });
      }
      if (u.includes('/vulns/')) {
        const id = decodeURIComponent(u.split('/vulns/')[1]);
        hydratedIds.push(id);
        return jsonResponse({ id, summary: `summary ${id}`, severity: [{ type: 'CVSS_V3', score: CRITICAL_VECTOR }], affected: [] });
      }
      return jsonResponse({}, { ok: false, status: 404 });
    });

    const res = await queryVulnerabilitiesBatch([
      { ecosystem: 'NPM', name: 'a', version: '1.0.0' },
      { ecosystem: 'NPM', name: 'b', version: '1.0.0' },
      { ecosystem: 'NPM', name: 'c', version: '1.0.0' },
    ]);

    expect(res.status).toBe('ok');
    expect(batchCalls).toBe(1);
    expect(hydratedIds.sort()).toEqual(['OSV-1', 'OSV-2']); // deduped
    expect(res.value[0].map(v => v.id)).toEqual(['OSV-1']);
    expect(res.value[1]).toEqual([]);
    expect(res.value[2].map(v => v.id).sort()).toEqual(['OSV-1', 'OSV-2']);
    expect(res.value[0][0].severity).toBe('CRITICAL');
  });

  it('makes no network call for an empty target list', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await queryVulnerabilitiesBatch([]);
    expect(res).toEqual({ value: [], status: 'ok' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails closed (unavailable) when the batch endpoint is rate-limited', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      String(url).endsWith('/querybatch')
        ? jsonResponse({}, { ok: false, status: 429 })
        : jsonResponse({}, { ok: false, status: 404 })
    );
    const res = await queryVulnerabilitiesBatch([{ ecosystem: 'NPM', name: 'a', version: '1.0.0' }]);
    expect(res.status).toBe('unavailable');
    expect(res.value).toEqual([[]]);
  });

  it('fails closed when a detail hydration is unreachable', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url);
      if (u.endsWith('/querybatch')) return jsonResponse({ results: [{ vulns: [{ id: 'OSV-9' }] }] });
      if (u.includes('/vulns/')) return jsonResponse({}, { ok: false, status: 503 });
      return jsonResponse({}, { ok: false, status: 404 });
    });
    const res = await queryVulnerabilitiesBatch([{ ecosystem: 'NPM', name: 'a', version: '1.0.0' }]);
    expect(res.status).toBe('unavailable');
  });
});
