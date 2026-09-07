import type { AwilixContainer } from 'awilix'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuard,
  type MutationGuardAfterInput,
  type MutationGuardInput,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'

type GuardAfterCallback = {
  guard: MutationGuard
  metadata: Record<string, unknown> | null
}

export function resolveUserFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown })?.features
  if (!Array.isArray(features)) return []
  return features.filter((value): value is string => typeof value === 'string')
}

/**
 * Mutation-guard wiring for the catalog write routes that do not go through
 * `makeCrudRoute` (the option-tree and constraints sync endpoints). The factory
 * runs the registry itself; hand-written handlers have to call it.
 */
export async function runCatalogMutationGuards(
  container: AwilixContainer,
  input: MutationGuardInput,
  userFeatures: string[],
): Promise<{
  ok: boolean
  errorBody?: Record<string, unknown>
  errorStatus?: number
  modifiedPayload?: Record<string, unknown>
  afterSuccessCallbacks: GuardAfterCallback[]
}> {
  const legacyGuard = bridgeLegacyGuard(container)
  if (!legacyGuard) {
    return { ok: true, afterSuccessCallbacks: [] }
  }

  return runMutationGuards([legacyGuard], input, { userFeatures })
}

export async function runCatalogMutationGuardAfterSuccess(
  callbacks: GuardAfterCallback[],
  input: Omit<MutationGuardAfterInput, 'metadata'>,
): Promise<void> {
  for (const callback of callbacks) {
    if (!callback.guard.afterSuccess) continue
    await callback.guard.afterSuccess({
      ...input,
      metadata: callback.metadata ?? null,
    })
  }
}
