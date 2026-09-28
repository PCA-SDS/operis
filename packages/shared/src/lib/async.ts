/** Small async primitives several packages each carried a copy of. */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Settles with `operation`, or rejects with `Error(timeoutMessage)` once
 * `timeoutMs` passes first. The timer is always cleared, so a finished
 * operation leaves nothing pending.
 */
export async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
  })
  try {
    return await Promise.race([operation, timeoutPromise])
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}

/** True for the error an aborted `fetch` (or `AbortSignal`) rejects with, in browsers and Node alike. */
export function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'signal is aborted without reason')
}
