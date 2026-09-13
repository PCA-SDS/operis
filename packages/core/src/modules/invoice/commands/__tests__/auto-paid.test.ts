import { asValue, createContainer, InjectionMode } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

import { addAutoPaidRuleCommand } from '../auto-paid'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const ruleId = '11111111-1111-4111-8111-111111111111'
const invoiceId = '22222222-2222-4222-8222-222222222222'

const currentUpdatedAt = new Date('2026-06-01T10:00:00.000Z')

function createContext(
  service: Record<string, jest.Mock>,
  options: { em?: { findOne: jest.Mock }; request?: Request } = {},
): CommandRuntimeContext {
  const container = createContainer<Record<string, unknown>>({
    injectionMode: InjectionMode.PROXY,
  }) as unknown as AppContainer
  const em = options.em ?? {
    findOne: jest.fn(async () => ({ id: invoiceId, updatedAt: currentUpdatedAt })),
  }
  container.register({
    invoiceAutoPaidService: asValue(service),
    em: asValue(em),
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
    request: options.request,
  }
}

describe('invoice auto-paid commands', () => {
  it('registers command ids at import time', () => {
    expect(commandRegistry.has('invoice.auto_paid.add')).toBe(true)
    expect(commandRegistry.has('invoice.auto_paid.remove')).toBe(true)
    expect(commandRegistry.has('invoice.auto_paid.apply_all')).toBe(true)
    expect(commandRegistry.has('invoice.auto_paid.reverse')).toBe(true)
  })

  it('adds a rule through trusted command scope', async () => {
    const service = {
      upsertRule: jest.fn(async () => ({
        rule: { id: ruleId, taxCode: '0100109106' },
        settledCount: 2,
      })),
    }
    const ctx = createContext(service)
    const handler = commandRegistry.get('invoice.auto_paid.add')

    await expect(handler?.execute({ taxCode: ' 0100109106 ' }, ctx)).resolves.toEqual({
      ruleId,
      taxCode: '0100109106',
      settledCount: 2,
    })
    expect(service.upsertRule).toHaveBeenCalledWith(scope, { taxCode: '0100109106' })
  })

  it('removes a rule through trusted command scope', async () => {
    const service = {
      removeRule: jest.fn(async () => ({
        ruleId,
        taxCode: '0100109106',
        revertedCount: 1,
      })),
    }
    const ctx = createContext(service)
    const handler = commandRegistry.get('invoice.auto_paid.remove')

    await expect(handler?.execute({ id: ruleId }, ctx)).resolves.toEqual({
      ruleId,
      taxCode: '0100109106',
      revertedCount: 1,
    })
    expect(service.removeRule).toHaveBeenCalledWith(scope, { id: ruleId })
  })

  it('applies all rules through trusted command scope', async () => {
    const service = {
      applyAll: jest.fn(async () => ({ ruleCount: 2, settledCount: 5 })),
    }
    const ctx = createContext(service)
    const handler = commandRegistry.get('invoice.auto_paid.apply_all')

    await expect(handler?.execute({}, ctx)).resolves.toEqual({ ruleCount: 2, settledCount: 5 })
    expect(service.applyAll).toHaveBeenCalledWith(scope)
  })

  it('reverses one invoice through trusted command scope', async () => {
    const service = {
      reverseInvoice: jest.fn(async () => ({ invoice: { id: invoiceId } })),
    }
    const ctx = createContext(service)
    const handler = commandRegistry.get('invoice.auto_paid.reverse')

    await expect(handler?.execute({ invoiceId }, ctx)).resolves.toEqual({
      invoiceId,
      reversed: true,
    })
    expect(service.reverseInvoice).toHaveBeenCalledWith(scope, { invoiceId })
  })

  /**
   * Reverse writes settlement state and the sticky `autoPayExcluded` flag onto
   * `invoice.invoice`, which the record-locks ledger marks `enabled` — so it has
   * to honour the same `updated_at` floor as every sibling invoice command.
   */
  it('rejects a reverse whose optimistic-lock header is stale', async () => {
    const service = { reverseInvoice: jest.fn() }
    const em = { findOne: jest.fn(async () => ({ id: invoiceId, updatedAt: currentUpdatedAt })) }
    const ctx = createContext(service, {
      em,
      request: new Request('http://localhost/api/invoice/invoices/x/reverse-auto-paid', {
        method: 'PATCH',
        headers: { 'x-om-ext-optimistic-lock-expected-updated-at': '2026-05-01T08:00:00.000Z' },
      }),
    })
    const handler = commandRegistry.get('invoice.auto_paid.reverse')

    await expect(handler?.execute({ invoiceId }, ctx))
      .rejects.toMatchObject({ status: 409, body: { code: 'optimistic_lock_conflict' } })
    expect(service.reverseInvoice).not.toHaveBeenCalled()
    expect(em.findOne).toHaveBeenCalledWith(expect.anything(), {
      id: invoiceId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
  })

  it('allows a reverse whose optimistic-lock header matches', async () => {
    const service = {
      reverseInvoice: jest.fn(async () => ({ invoice: { id: invoiceId } })),
    }
    const ctx = createContext(service, {
      request: new Request('http://localhost/api/invoice/invoices/x/reverse-auto-paid', {
        method: 'PATCH',
        headers: { 'x-om-ext-optimistic-lock-expected-updated-at': currentUpdatedAt.toISOString() },
      }),
    })
    const handler = commandRegistry.get('invoice.auto_paid.reverse')

    await expect(handler?.execute({ invoiceId }, ctx)).resolves.toEqual({ invoiceId, reversed: true })
  })

  it('builds audit metadata with trusted scope and counts', () => {
    const ctx = createContext({})
    const metadata = addAutoPaidRuleCommand.buildLog?.({
      input: { taxCode: '0100109106' },
      result: { ruleId, taxCode: '0100109106', settledCount: 2 },
      ctx,
      snapshots: {},
    })

    expect(metadata).toMatchObject({
      actionLabel: 'Add invoice auto-paid rule',
      resourceKind: 'invoice.auto_paid_tax_code',
      resourceId: ruleId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      context: {
        taxCode: '0100109106',
        settledCount: 2,
      },
    })
  })
})
