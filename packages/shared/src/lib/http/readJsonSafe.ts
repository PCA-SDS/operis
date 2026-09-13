/**
 * Read a JSON body defensively.
 *
 * The reader the root `AGENTS.md` mandates over `.json().catch(() => …)`: an
 * empty body or malformed JSON yields the fallback instead of throwing, and
 * unlike a bare `.catch()` it does not also swallow a programming error thrown
 * further up.
 *
 * The body read itself is deliberately OUTSIDE the try, so a transport-level
 * failure (a client that disconnected mid-body) still rejects rather than being
 * reported as a successfully-parsed empty payload. Callers that want a fallback
 * for that case too handle it themselves — see `apiCall`.
 */
export async function readJsonSafe<T>(source: Request | Response | string, fallback: T): Promise<T>
export async function readJsonSafe<T>(source: Request | Response | string): Promise<T | null>
export async function readJsonSafe<T>(
  source: Request | Response | string,
  fallback?: T | null,
): Promise<T | null>
export async function readJsonSafe<T>(
  source: Request | Response | string,
  fallback: T | null = null,
): Promise<T | null> {
  const raw = typeof source === 'string' ? source : await source.text()
  if (!raw) return fallback

  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
