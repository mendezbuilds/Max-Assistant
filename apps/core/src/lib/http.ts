/**
 * Wraps fetch() with a per-attempt timeout and retry-with-backoff for
 * transient failures — a network blip or rate limit shouldn't turn into a
 * full miss for a source's whole poll cycle. Shared by every job-scout and
 * alpha-scout source instead of each one calling fetch() raw.
 *
 * This exists because of two real failures caught in production (2026-09):
 * - "workingnomads: terminated" — Node's fetch throws exactly this generic
 *   message when a connection hangs/drops mid-request, with no built-in
 *   timeout to turn a hang into a clear, retryable error instead. This
 *   wraps every call in an AbortController-based timeout for that reason.
 * - "mercor/web3career: fetch failed" — the generic message fetch() throws
 *   for any low-level network error, with the actually-useful detail
 *   (DNS failure, connection reset, etc.) buried in `err.cause`, which
 *   wasn't being surfaced anywhere. describeError() below pulls it out.
 */

export interface FetchWithRetryOptions extends RequestInit {
  /** Additional attempts after the first. Default 2 (3 attempts total). */
  retries?: number;
  /** Base backoff delay in ms, doubled each retry. Default 500. */
  backoffMs?: number;
  /** Per-attempt timeout in ms. Default 15000. */
  timeoutMs?: number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeError(err: unknown, url: string): Error {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const causeText =
      cause instanceof Error ? ` (cause: ${cause.message})` : cause ? ` (cause: ${String(cause)})` : "";
    return new Error(`${url}: ${err.message}${causeText}`);
  }
  return new Error(`${url}: ${String(err)}`);
}

/**
 * Like fetch(), but retries on network errors, timeouts, 429, and 5xx —
 * the transient kinds of failure a retry can actually fix. Does NOT retry
 * other 4xx responses (they won't succeed on retry) — those come back as a
 * normal (non-ok) Response for the caller to inspect, same as plain fetch.
 * Throws (with the real underlying cause, not just "fetch failed") only
 * after every attempt has failed at the network/timeout level.
 */
export async function fetchWithRetry(url: string, options: FetchWithRetryOptions = {}): Promise<Response> {
  const { retries = 2, backoffMs = 500, timeoutMs = 15_000, ...fetchOptions } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error(`timed out after ${timeoutMs}ms`)),
      timeoutMs
    );

    try {
      const res = await fetch(url, { ...fetchOptions, signal: controller.signal });
      if (res.ok || (res.status !== 429 && res.status < 500)) {
        return res; // success, or a non-transient error the caller should handle itself
      }
      lastError = new Error(`HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < retries) {
      await sleep(backoffMs * 2 ** attempt);
    }
  }

  throw describeError(lastError, url);
}
