import type { EntityManager } from '@mikro-orm/postgresql'

import { InvoiceCompany, InvoiceCompanyEmail } from '../../data/entities'
import type { InvoiceScope } from '../../data/scope'
import { InvoiceScopedPersistenceService } from '../scoped-persistence-service'
import { InvoiceCompanyEmailsService } from '../company-emails-service'

const scope: InvoiceScope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const companyId = '11111111-1111-4111-8111-111111111111'
const emailId = '22222222-2222-4222-8222-222222222222'

function company(overrides: Partial<InvoiceCompany> = {}): InvoiceCompany {
  return {
    id: companyId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
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

function companyEmail(overrides: Partial<InvoiceCompanyEmail> = {}): InvoiceCompanyEmail {
  return {
    id: emailId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    company: company(),
    email: 'billing@example.com',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  } as InvoiceCompanyEmail
}

function createService() {
  const em = {
    findOne: jest.fn(),
    find: jest.fn(),
    upsert: jest.fn(),
    nativeDelete: jest.fn(),
  } as unknown as EntityManager
  const scopedPersistence = new InvoiceScopedPersistenceService(em)
  const service = new InvoiceCompanyEmailsService(em, scopedPersistence)

  return { em, service }
}

describe('InvoiceCompanyEmailsService', () => {
  it('lists company emails in MRU order inside trusted scope', async () => {
    const { em, service } = createService()
    const partner = company()
    jest.mocked(em.findOne).mockResolvedValue(partner)
    jest.mocked(em.find).mockResolvedValue([companyEmail({ company: partner })])

    await expect(service.listByCompany(scope, companyId)).resolves.toHaveLength(1)

    expect(em.findOne).toHaveBeenCalledWith(InvoiceCompany, {
      id: companyId,
      deletedAt: null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }, undefined)
    expect(em.find).toHaveBeenCalledWith(InvoiceCompanyEmail, {
      company: partner,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }, {
      orderBy: { updatedAt: 'desc' },
    })
  })

  it('returns 404 when listing a foreign or missing company', async () => {
    const { em, service } = createService()
    jest.mocked(em.findOne).mockResolvedValue(null)

    await expect(service.listByCompany(scope, companyId)).rejects.toMatchObject({ status: 404 })
    expect(em.find).not.toHaveBeenCalled()
  })

  it('ignores empty record input before loading the company', async () => {
    const { em, service } = createService()

    await expect(service.record(scope, { companyId, email: '   ' })).resolves.toBeNull()

    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.upsert).not.toHaveBeenCalled()
  })

  it('trims email and upserts without forcing lower-case', async () => {
    const { em, service } = createService()
    const partner = company()
    const saved = companyEmail({ company: partner, email: 'Billing@Example.com' })
    jest.mocked(em.findOne).mockResolvedValue(partner)
    jest.mocked(em.upsert).mockResolvedValue(saved)

    await expect(service.record(scope, { companyId, email: '  Billing@Example.com  ' })).resolves.toBe(saved)

    expect(em.upsert).toHaveBeenCalledWith(InvoiceCompanyEmail, expect.objectContaining({
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      company: partner,
      email: 'Billing@Example.com',
    }), {
      onConflictFields: ['company', 'email'],
      onConflictMergeFields: ['updatedAt'],
    })
  })

  it('makes repeated record calls idempotent through the unique upsert target', async () => {
    const { em, service } = createService()
    const partner = company()
    jest.mocked(em.findOne).mockResolvedValue(partner)
    jest.mocked(em.upsert).mockResolvedValue(companyEmail({ company: partner }))

    await service.record(scope, { companyId, email: 'billing@example.com' })
    await service.record(scope, { companyId, email: 'billing@example.com' })

    expect(em.upsert).toHaveBeenCalledTimes(2)
    for (const call of jest.mocked(em.upsert).mock.calls) {
      expect(call[2]).toEqual({
        onConflictFields: ['company', 'email'],
        onConflictMergeFields: ['updatedAt'],
      })
    }
  })

  it('touches updatedAt when recording an existing email again', async () => {
    const { em, service } = createService()
    const partner = company()
    jest.mocked(em.findOne).mockResolvedValue(partner)
    jest.mocked(em.upsert).mockResolvedValue(companyEmail({ company: partner }))

    await service.record(scope, { companyId, email: 'billing@example.com' })

    const payload = jest.mocked(em.upsert).mock.calls[0]?.[1] as Partial<InvoiceCompanyEmail>
    expect(payload.updatedAt).toBeInstanceOf(Date)
  })

  it('removes only matching scope and company rows', async () => {
    const { em, service } = createService()
    const partner = company()
    jest.mocked(em.findOne).mockResolvedValue(partner)
    jest.mocked(em.nativeDelete).mockResolvedValue(1)

    await service.remove(scope, { companyId, id: emailId })

    expect(em.nativeDelete).toHaveBeenCalledWith(InvoiceCompanyEmail, {
      id: emailId,
      company: partner,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
  })

  it('keeps repeated remove safe', async () => {
    const { em, service } = createService()
    jest.mocked(em.findOne).mockResolvedValue(company())
    jest.mocked(em.nativeDelete).mockResolvedValue(0)

    await expect(service.remove(scope, { companyId, id: emailId })).resolves.toBeUndefined()
  })
})
