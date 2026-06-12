/**
 * Resilient HTTP layer: every outbound request gets a hard timeout and
 * exponential-backoff retry on transient failures (network error, timeout,
 * HTTP 429, HTTP 5xx). This keeps a single hung or flaky endpoint from either
 * hanging the whole audit or being misread as an authoritative answer.
 */

export interface ResilientFetchOptions {
  /** Per-attempt timeout in milliseconds. */
  timeoutMs?: number;
  /** Number of retries after the first attempt (so total attempts = retries + 1). */
  retries?: number;
  /** Base backoff delay; doubles each attempt. */
  baseDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 3;
// Overridable so tests (and impatient environments) can shrink the backoff.
const DEFAULT_BASE_DELAY_MS = Number(process.env.HAWKEYE_RETRY_BASE_MS ?? 300);

/** 429 and 5xx are transient — worth retrying. */
function isRetriableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function backoffDelay(baseDelayMs: number, attempt: number): number {
  const exponential = baseDelayMs * 2 ** attempt;
  // Small jitter avoids synchronized retries across many parallel dependencies.
  const jitter = exponential * 0.25 * Math.random();
  return exponential + jitter;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * `fetch` with a timeout and bounded retries.
 *
 * Returns the final `Response` — including a retriable status once retries are
 * exhausted, so callers keep full control over how to interpret it. Throws only
 * when every attempt failed with a network/timeout error; callers should treat
 * a thrown error (or a lingering 429/5xx) as "source unavailable".
 */
export async function resilientFetch(
  url: string,
  init?: RequestInit,
  opts?: ResilientFetchOptions
): Promise<Response> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts?.retries ?? DEFAULT_RETRIES;
  const baseDelayMs = opts?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (isRetriableStatus(res.status) && attempt < retries) {
        await sleep(backoffDelay(baseDelayMs, attempt));
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < retries) {
        await sleep(backoffDelay(baseDelayMs, attempt));
        continue;
      }
      throw err;
    }
  }

  // Unreachable in practice (the loop either returns or throws), but satisfies
  // the type checker and guards against a misconfigured retry count.
  throw lastError ?? new Error('resilientFetch: exhausted retries');
}
