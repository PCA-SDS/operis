import { asValue, createContainer, InjectionMode } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

import '../invoices'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const invoiceId = '11111111-1111-4111-8111-111111111111'

const manualInput = {
  partnerName: 'Foreign Seller',
  partnerCountryCode: 'SG',
  partnerTaxCode: 'SG-123',
  invoiceNumber: 'INV-1',
  invoiceDate: '2026-01-10',
  lineItems: [{ name: 'Line', quantity: '1', unitPrice: '100' }],
}

function createContext(service: Record<string, jest.Mock>, em: Record<string, jest.Mock> = {}): CommandRuntimeContext {
  const container = createContainer<Record<string, unknown>>({
    injectionMode: InjectionMode.PROXY,
  }) as unknown as AppContainer
  container.register({
    em: asValue(em),
    invoiceService: asValue(service),
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

describe('invoice manual invoice commands', () => {
  it('registers command ids at import time', () => {
    expect(commandRegistry.has('invoice.invoices.create')).toBe(true)
    expect(commandRegistry.has('invoice.invoices.update')).toBe(true)
    expect(commandRegistry.has('invoice.invoices.delete')).toBe(true)
  })

  it('creates manual invoices through trusted command scope', async () => {
    const invoice = { id: invoiceId, direction: 'AP', invoiceNumber: 'INV-1', autoSettled: false }
    const service = {
      createManualInvoice: jest.fn(async () => ({ invoice })),
    }
    const ctx = createContext(service)
    const handler = commandRegistry.get('invoice.invoices.create')

    await expect(handler?.execute({ ...manualInput, tenantId: 'forged' }, ctx)).resolves.toEqual({
      invoiceId,
      invoice,
    })
    expect(service.createManualInvoice).toHaveBeenCalledWith(scope, expect.objectContaining({
      partnerName: manualInput.partnerName,
      partnerCountryCode: manualInput.partnerCountryCode,
      partnerTaxCode: manualInput.partnerTaxCode,
      invoiceNumber: manualInput.invoiceNumber,
      lineItems: manualInput.lineItems,
    }))
  })

  it('updates manual invoices after checking current version', async () => {
    const invoice = { id: invoiceId, direction: 'AP', invoiceNumber: 'INV-1', autoSettled: true }
    const service = {
      updateManualInvoice: jest.fn(async () => ({ invoice })),
    }
    const em = {
      findOne: jest.fn(async () => ({ id: invoiceId, updatedAt: new Date('2026-01-01T00:00:00.000Z') })),
    }
    const ctx = createContext(service, em)
    const handler = commandRegistry.get('invoice.invoices.update')

    await expect(handler?.execute({ id: invoiceId, input: manualInput }, ctx)).resolves.toEqual({
      invoiceId,
      invoice,
    })
    expect(em.findOne).toHaveBeenCalledWith(expect.any(Function), {
      id: invoiceId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    expect(service.updateManualInvoice).toHaveBeenCalledWith(scope, invoiceId, expect.objectContaining({
      partnerName: manualInput.partnerName,
      partnerCountryCode: manualInput.partnerCountryCode,
      partnerTaxCode: manualInput.partnerTaxCode,
      invoiceNumber: manualInput.invoiceNumber,
      lineItems: manualInput.lineItems,
    }))
  })

  it('deletes manual invoices through trusted command scope', async () => {
    const service = {
      deleteManualInvoice: jest.fn(async () => ({ invoiceId, deleted: true })),
    }
    const em = {
      findOne: jest.fn(async () => ({ id: invoiceId, updatedAt: new Date('2026-01-01T00:00:00.000Z') })),
    }
    const ctx = createContext(service, em)
    const handler = commandRegistry.get('invoice.invoices.delete')

    await expect(handler?.execute({ id: invoiceId, tenantId: 'forged' }, ctx)).resolves.toEqual({
      invoiceId,
      deleted: true,
    })
    expect(service.deleteManualInvoice).toHaveBeenCalledWith(scope, invoiceId)
  })
})
