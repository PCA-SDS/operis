import type { AwilixContainer } from 'awilix'
import { resolveGrantedFeatures } from '@open-mercato/shared/lib/auth/grantedFeatures'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuard,
  type MutationGuardInput,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'

type GuardAfterCallback = {
  guard: MutationGuard
  metadata: Record<string, unknown> | null
}

/**
 * `userFeatures` is resolved from `rbacService` when the caller omits it. It
 * used to be a required argument that every route filled from `auth.features` —
 * a field the JWT never carries, so it was always `[]` and feature-gated guards
 * could never match.
 */
export async function runPaymentGatewayMutationGuards(
  container: AwilixContainer,
  input: MutationGuardInput,
  userFeatures?: string[],
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

  const grantedFeatures = userFeatures ?? await resolveGrantedFeatures(
    container,
    { sub: input.userId, tenantId: input.tenantId, orgId: input.organizationId },
    input.organizationId,
  )
  return runMutationGuards([legacyGuard], input, { userFeatures: grantedFeatures })
}

export async function runPaymentGatewayMutationGuardAfterSuccess(
  callbacks: GuardAfterCallback[],
  input: {
    tenantId: string
    organizationId: string | null
    userId: string
    resourceKind: string
    resourceId: string
    operation: 'create' | 'update' | 'delete'
    requestMethod: string
    requestHeaders: Headers
  },
): Promise<void> {
  for (const callback of callbacks) {
    if (!callback.guard.afterSuccess) continue
    await callback.guard.afterSuccess({
      ...input,
      metadata: callback.metadata ?? null,
    })
  }
}
