import type { EntityManager } from '@mikro-orm/postgresql'

import { InvoiceCompany } from '../../data/entities'
import type { InvoiceScope } from '../../data/scope'
import { InvoiceScopedPersistenceService } from '../scoped-persistence-service'
import { InvoicePartnerTermsService } from '../partner-terms-service'

const scope: InvoiceScope = { tenantId: 'tenant-1', organizationId: 'org-1' }

function company(overrides: Partial<InvoiceCompany> = {}): InvoiceCompany {
  return {
    id: 'company-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    taxCode: '0100109106',
    countryCode: 'VN',
    name: 'Acme',
    defaultDueDays: 30,
    searchText: '',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as InvoiceCompany
}

function createService() {
  const em = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    flush: jest.fn(),
  } as unknown as EntityManager
  const scopedPersistence = new InvoiceScopedPersistenceService(em)
  const service = new InvoicePartnerTermsService(em, scopedPersistence)

  return { em, service }
}

describe('InvoicePartnerTermsService', () => {
  it('lists live partners inside trusted scope', async () => {
    const { em, service } = createService()
    jest.mocked(em.find).mockResolvedValue([company()])

    await expect(service.listPartners(scope, { page: 2, pageSize: 10 })).resolves.toHaveLength(1)

    expect(em.find).toHaveBeenCalledWith(InvoiceCompany, {
      deletedAt: null,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }, {
      limit: 10,
      offset: 10,
      orderBy: { name: 'asc' },
    })
  })

  it('searches partners with escaped case-insensitive filters', async () => {
    const { em, service } = createService()
    jest.mocked(em.find).mockResolvedValue([])

    await service.listPartners(scope, { search: '50%_off', page: 1, pageSize: 20 })

    expect(em.find).toHaveBeenCalledWith(InvoiceCompany, {
      $or: [
        { name: { $ilike: '%50\\%\\_off%' } },
        { taxCode: { $ilike: '%50\\%\\_off%' } },
      ],
      deletedAt: null,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }, {
      limit: 20,
      offset: 0,
      orderBy: { name: 'asc' },
    })
  })

  it('matches supplied tax code only and does not include name fallback', async () => {
    const { em, service } = createService()
    jest.mocked(em.findOne).mockResolvedValue(null)

    await expect(service.matchPartner(scope, { taxCode: '0100109106', name: 'Acme' })).resolves.toBeNull()

    expect(em.findOne).toHaveBeenCalledTimes(1)
    expect(em.findOne).toHaveBeenCalledWith(InvoiceCompany, {
      taxCode: '0100109106',
      deletedAt: null,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }, undefined)
  })

  it('matches by company name case-insensitively when tax code is absent', async () => {
    const { em, service } = createService()
    const match = company({ name: 'ACME' })
    jest.mocked(em.findOne).mockResolvedValue(match)

    await expect(service.matchPartner(scope, { name: 'acme' })).resolves.toBe(match)

    expect(em.findOne).toHaveBeenCalledWith(InvoiceCompany, {
      name: { $ilike: 'acme' },
      deletedAt: null,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }, undefined)
  })

  it('returns null when match input has no usable name or tax code', async () => {
    const { em, service } = createService()

    await expect(service.matchPartner(scope, { taxCode: '', name: '   ' })).resolves.toBeNull()

    expect(em.findOne).not.toHaveBeenCalled()
  })

  it('updates only defaultDueDays on a scoped partner', async () => {
    const { em, service } = createService()
    const existing = company({ name: 'Original', taxCode: 'TAX-1', defaultDueDays: 30 })
    jest.mocked(em.findOne).mockResolvedValue(existing)

    await expect(service.updateDefaultDueDays(scope, 'company-1', { defaultDueDays: '45' })).resolves.toBe(existing)

    expect(existing).toMatchObject({
      name: 'Original',
      taxCode: 'TAX-1',
      defaultDueDays: 45,
    })
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('allows clearing partner default due days', async () => {
    const { em, service } = createService()
    const existing = company({ defaultDueDays: 30 })
    jest.mocked(em.findOne).mockResolvedValue(existing)

    await service.updateDefaultDueDays(scope, 'company-1', { defaultDueDays: null })

    expect(existing.defaultDueDays).toBeNull()
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid partner due-day values before writing', async () => {
    const { em, service } = createService()

    await expect(service.updateDefaultDueDays(scope, 'company-1', { defaultDueDays: 0 })).rejects.toThrow()
    await expect(service.updateDefaultDueDays(scope, 'company-1', { defaultDueDays: 3651 })).rejects.toThrow()

    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('uses explicit due date before partner terms', async () => {
    const { em, service } = createService()
    const dueDate = new Date('2026-02-01T00:00:00.000Z')

    await expect(service.resolveDefaultDueDate(scope, {
      invoiceDate: new Date('2026-01-01T00:00:00.000Z'),
      dueDate,
      taxCode: '0100109106',
    })).resolves.toBe(dueDate)

    expect(em.findOne).not.toHaveBeenCalled()
  })

  it('uses matched partner default due days when explicit due date is missing', async () => {
    const { em, service } = createService()
    jest.mocked(em.findOne).mockResolvedValue(company({ defaultDueDays: 14 }))

    await expect(service.resolveDefaultDueDate(scope, {
      invoiceDate: new Date('2026-01-01T00:00:00.000Z'),
      taxCode: '0100109106',
    })).resolves.toEqual(new Date('2026-01-15T00:00:00.000Z'))
  })

  it('returns null when neither explicit due date nor partner terms exist', async () => {
    const { em, service } = createService()
    jest.mocked(em.findOne).mockResolvedValue(company({ defaultDueDays: null }))

    await expect(service.resolveDefaultDueDate(scope, {
      invoiceDate: new Date('2026-01-01T00:00:00.000Z'),
      taxCode: '0100109106',
    })).resolves.toBeNull()
  })
})
