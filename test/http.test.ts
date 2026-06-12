import { describe, it, expect, vi, afterEach } from 'vitest';
import { resilientFetch } from '../src/api/http.js';

function okResponse(): Response {
  return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
}

function statusResponse(status: number): Response {
  return { ok: status < 400, status, json: async () => ({}) } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resilientFetch (issue #8)', () => {
  it('retries on network errors and resolves once a later attempt succeeds', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      if (calls < 3) throw new TypeError('network down');
      return okResponse();
    });

    const res = await resilientFetch('https://example.test', undefined, { baseDelayMs: 0 });
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
  });

  it('retries on 5xx and returns the final response when retries are exhausted', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return statusResponse(503);
    });

    const res = await resilientFetch('https://example.test', undefined, { retries: 2, baseDelayMs: 0 });
    expect(res.status).toBe(503);
    expect(calls).toBe(3); // 1 initial + 2 retries
  });

  it('does not retry a non-retriable 4xx response', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return statusResponse(404);
    });

    const res = await resilientFetch('https://example.test', undefined, { retries: 3, baseDelayMs: 0 });
    expect(res.status).toBe(404);
    expect(calls).toBe(1);
  });

  it('aborts a hung request via the timeout and throws after retries', async () => {
    // A fetch that never resolves on its own — only the abort signal ends it.
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });

    await expect(
      resilientFetch('https://example.test', undefined, { timeoutMs: 10, retries: 1, baseDelayMs: 0 })
    ).rejects.toThrow();
  });
});
