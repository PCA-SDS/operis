import { asValue, createContainer, InjectionMode } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

import '../payment-confirmations'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const invoiceId = '11111111-1111-4111-8111-111111111111'
const confirmationId = '22222222-2222-4222-8222-222222222222'

function createContext(service: Record<string, jest.Mock>): CommandRuntimeContext {
  const container = createContainer<Record<string, unknown>>({
    injectionMode: InjectionMode.PROXY,
  }) as unknown as AppContainer
  container.register({ invoicePaymentConfirmationsService: asValue(service) })

  return {
    container,
    auth: {
      sub: 'user-1',
      tenantId: scope.tenantId,
      orgId: scope.organizationId,
      roles: [],
      isSuperAdmin: false,
    },
    selectedOrganizationId: scope.organizationId,
    organizationScope: null,
    organizationIds: [scope.organizationId],
  }
}

describe('invoice payment confirmation commands', () => {
  it('registers the request command at import time', () => {
    expect(commandRegistry.has('invoice.payment_confirmations.request')).toBe(true)
  })

  it('requests confirmation using trusted command scope', async () => {
    const result = {
      confirmationId,
      invoiceId,
      installmentId: null,
      status: 'PENDING' as const,
      expiresAt: '2026-09-24T00:00:00.000Z',
    }
    const service = { request: jest.fn(async () => result) }
    const handler = commandRegistry.get('invoice.payment_confirmations.request')

    await expect(handler?.execute({
      invoiceId,
      recipientEmail: 'supplier@example.com',
    }, createContext(service))).resolves.toEqual(result)
    expect(service.request).toHaveBeenCalledWith(scope, {
      invoiceId,
      recipientEmail: 'supplier@example.com',
    })
  })

  it('rejects request-body scope instead of trusting it', async () => {
    const service = { request: jest.fn() }
    const handler = commandRegistry.get('invoice.payment_confirmations.request')

    await expect(handler?.execute({
      invoiceId,
      recipientEmail: 'supplier@example.com',
      tenantId: 'forged-tenant',
      organizationId: 'forged-organization',
    }, createContext(service))).rejects.toBeDefined()
    expect(service.request).not.toHaveBeenCalled()
  })
})
