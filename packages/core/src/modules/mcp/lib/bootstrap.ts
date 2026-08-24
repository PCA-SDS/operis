import { createRequestContainer } from '@open-mercato/shared/lib/di/container'

let registration: Promise<void> | null = null

/**
 * Guarantee that every enabled module has had a chance to publish its MCP scopes.
 *
 * Scopes are registered as an import side effect of each module's `di.ts` (see
 * `tasks/mcp-scopes.ts`). Building a container is what pulls the generated DI
 * graph in, so one container build per process is enough — subsequent calls are
 * memoized and free.
 *
 * Routes that only read the registry (the discovery endpoints) need this because
 * they would otherwise be able to answer before any module has been loaded, and
 * would advertise an empty `scopes_supported`.
 */
export function ensureMcpScopesRegistered(): Promise<void> {
  if (!registration) {
    registration = createRequestContainer()
      .then(() => undefined)
      .catch((error) => {
        registration = null
        throw error
      })
  }
  return registration
}

/** @__internal Test-only hook — reset the memoized bootstrap. */
export function resetMcpBootstrapForTests(): void {
  registration = null
}
