/**
 * Resolve a registration that may be absent — an optional peer module's
 * service — answering `null` instead of throwing, so the caller can degrade
 * gracefully rather than hard-require the peer.
 */
export function tryResolve<T>(container: { resolve: (name: string) => unknown }, name: string): T | null {
  try {
    return container.resolve(name) as T
  } catch {
    return null
  }
}
