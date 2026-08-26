import type { EntityManager } from '@mikro-orm/postgresql'

import { Invoice, InvoiceCompany, InvoiceCompanyEmail } from '../data/entities'
import { InvoiceScopedPersistenceService } from '../services/scoped-persistence-service'

const scope = { tenantId: 'tenant-trusted', organizationId: 'org-trusted' }

function createService() {
  const em = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((entity: unknown, payload: unknown) => payload),
  } as unknown as EntityManager

  return { em, service: new InvoiceScopedPersistenceService(em) }
}

describe('InvoiceScopedPersistenceService', () => {
  it('findOne applies trusted tenant and organization after caller filters', async () => {
    const { em, service } = createService()

    await service.findOne(InvoiceCompany, scope, {
      taxCode: '0100109106',
      tenantId: 'tenant-forged',
      organizationId: 'org-forged',
    })

    expect(em.findOne).toHaveBeenCalledWith(InvoiceCompany, {
      taxCode: '0100109106',
      tenantId: 'tenant-trusted',
      organizationId: 'org-trusted',
    }, undefined)
  })

  it('findById filters soft-deletable detail reads by deletedAt null', async () => {
    const { em, service } = createService()

    await service.findById(Invoice, scope, 'invoice-1')

    expect(em.findOne).toHaveBeenCalledWith(Invoice, {
      id: 'invoice-1',
      deletedAt: null,
      tenantId: 'tenant-trusted',
      organizationId: 'org-trusted',
    }, undefined)
  })

  it('findById does not add deletedAt for entities without soft delete', async () => {
    const { em, service } = createService()

    await service.findById(InvoiceCompanyEmail, scope, 'email-1')

    expect(em.findOne).toHaveBeenCalledWith(InvoiceCompanyEmail, {
      id: 'email-1',
      tenantId: 'tenant-trusted',
      organizationId: 'org-trusted',
    }, undefined)
  })

  it('findMany applies trusted scope to repository reads', async () => {
    const { em, service } = createService()

    await service.findMany(InvoiceCompany, scope, { name: 'ACME', tenantId: 'tenant-forged' })

    expect(em.find).toHaveBeenCalledWith(InvoiceCompany, {
      name: 'ACME',
      tenantId: 'tenant-trusted',
      organizationId: 'org-trusted',
    }, undefined)
  })

  it('createScoped stamps trusted scope and ignores forged payload ownership', () => {
    const { em, service } = createService()

    const record = service.createScoped(InvoiceCompany, scope, {
      name: 'ACME',
      taxCode: '0100109106',
      tenantId: 'tenant-forged',
      organizationId: 'org-forged',
    })

    expect(em.create).toHaveBeenCalledWith(InvoiceCompany, {
      name: 'ACME',
      taxCode: '0100109106',
      tenantId: 'tenant-trusted',
      organizationId: 'org-trusted',
    })
    expect(record).toMatchObject({ tenantId: 'tenant-trusted', organizationId: 'org-trusted' })
  })

  it('requireById fails closed when cross-scope rows are not returned', async () => {
    const { em, service } = createService()
    jest.mocked(em.findOne).mockResolvedValue(null)

    await expect(service.requireById(InvoiceCompany, scope, 'company-1')).rejects.toMatchObject({ status: 404 })
  })
})
