import { asValue, createContainer, InjectionMode } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

import '../payment-confirmations'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const invoiceId = '11111111-1111-4111-8111-111111111111'
const confirmationId = '22222222-2222-4222-8222-222222222222'

function createEm(): Record<string, jest.Mock> {
  return {
    findOne: jest.fn(async () => ({ id: invoiceId, updatedAt: new Date('2026-01-01T00:00:00.000Z') })),
  }
}

function createContext(
  service: Record<string, jest.Mock>,
  em: Record<string, jest.Mock> = createEm(),
): CommandRuntimeContext {
  const container = createContainer<Record<string, unknown>>({
    injectionMode: InjectionMode.PROXY,
  }) as unknown as AppContainer
  container.register({
    em: asValue(em),
    invoicePaymentConfirmationsService: asValue(service),
  })

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
    expect(commandRegistry.has('invoice.payment_confirmations.accept-incoming')).toBe(true)
    expect(commandRegistry.has('invoice.payment_confirmations.reject-incoming')).toBe(true)
  })

  it.each([
    ['accept', 'invoice.payment_confirmations.accept-incoming', 'acceptIncoming', 'CONFIRMED'],
    ['reject', 'invoice.payment_confirmations.reject-incoming', 'rejectIncoming', 'REJECTED'],
  ])('routes incoming %s through trusted command scope', async (_label, commandId, method, status) => {
    const result = {
      confirmationId,
      status,
      invoice: { id: invoiceId },
    }
    const serviceMethod = jest.fn(async () => result)
    const service: Record<string, jest.Mock> = { [method]: serviceMethod }
    const handler = commandRegistry.get(commandId)

    await expect(handler?.execute({ invoiceId }, createContext(service))).resolves.toEqual(result)
    expect(serviceMethod).toHaveBeenCalledWith(scope, invoiceId)
  })

  it.each([
    ['accept-incoming', 'invoice.payment_confirmations.accept-incoming', 'acceptIncoming'],
    ['reject-incoming', 'invoice.payment_confirmations.reject-incoming', 'rejectIncoming'],
    ['request', 'invoice.payment_confirmations.request', 'request'],
  ])('enforces the invoice optimistic lock before %s mutates settlement state', async (_label, commandId, method) => {
    const service: Record<string, jest.Mock> = { [method]: jest.fn(async () => ({ confirmationId, invoiceId, status: 'PENDING' })) }
    const em = createEm()
    const handler = commandRegistry.get(commandId)
    // Both incoming schemas are `.strict()`, so only the request command accepts a recipient.
    const input = method === 'request' ? { invoiceId, recipientEmail: 'supplier@example.com' } : { invoiceId }

    await handler?.execute(input, createContext(service, em))

    // `invoice:Invoice` is enabled in the record-locks ledger, so every write surface has to
    // read the current `updated_at` under the caller's scope before mutating.
    expect(em.findOne).toHaveBeenCalledWith(expect.any(Function), {
      id: invoiceId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
  })

  it('rejects forged scope on incoming actions', async () => {
    const service = { acceptIncoming: jest.fn() }
    const handler = commandRegistry.get('invoice.payment_confirmations.accept-incoming')

    await expect(handler?.execute({
      invoiceId,
      tenantId: 'forged-tenant',
      organizationId: 'forged-organization',
    }, createContext(service))).rejects.toBeDefined()
    expect(service.acceptIncoming).not.toHaveBeenCalled()
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
