/** @jest-environment node */
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

const runRouteMutationGuardsMock = jest.fn()

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuardsMock(...args),
}))

import { runClaimActionGuard, runClaimLineActionGuard } from '../actionContext'

const container = { resolve: jest.fn() }

function makeContext(sub: string | undefined) {
  return {
    ctx: { container, auth: sub ? { sub, tenantId: 'tenant-1' } : null } as unknown as CommandRuntimeContext,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }
}

const request = new Request('http://localhost/api/warranty_claims/assign', { method: 'POST' })

describe('warranty claim action guards', () => {
  beforeEach(() => {
    runRouteMutationGuardsMock.mockReset()
    runRouteMutationGuardsMock.mockResolvedValue({ ok: true, runAfterSuccess: jest.fn() })
  })

  it.each([
    ['claim', runClaimActionGuard, 'warranty_claims.claim'],
    ['claim line', runClaimLineActionGuard, 'warranty_claims.claim_line'],
  ] as const)('guards a %s action as a custom write on that record', async (_label, guard, resourceKind) => {
    const payload = { id: 'record-1', note: 'x' }

    await guard(request, makeContext('user-1'), 'record-1', payload)

    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith({
      container,
      req: request,
      auth: { userId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' },
      input: { resourceKind, resourceId: 'record-1', operation: 'custom', mutationPayload: payload },
    })
  })

  it.each([runClaimActionGuard, runClaimLineActionGuard])('answers a translated 401 without an actor subject', async (guard) => {
    await expect(guard(request, makeContext(undefined), 'record-1', {})).rejects.toMatchObject({
      status: 401,
      body: { error: 'Unauthorized' },
    })
    expect(runRouteMutationGuardsMock).not.toHaveBeenCalled()
  })
})
