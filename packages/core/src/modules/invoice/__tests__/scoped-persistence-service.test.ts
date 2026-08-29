import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EntityManager } from '@mikro-orm/postgresql'

import { Invoice, InvoiceCompany, InvoiceCompanyEmail } from '../data/entities'
import {
  INVOICE_SOFT_DELETABLE_ENTITIES,
  InvoiceScopedPersistenceService,
} from '../services/scoped-persistence-service'

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
      deletedAt: null,
      tenantId: 'tenant-trusted',
      organizationId: 'org-trusted',
    }, undefined)
  })

  it('findOne filters soft-deletable reads by deletedAt null', async () => {
    const { em, service } = createService()

    await service.findOne(Invoice, scope, { sourceInvoiceId: 'source-1' })

    expect(em.findOne).toHaveBeenCalledWith(Invoice, {
      sourceInvoiceId: 'source-1',
      deletedAt: null,
      tenantId: 'tenant-trusted',
      organizationId: 'org-trusted',
    }, undefined)
  })

  it('findOne can include soft-deleted records when explicitly requested', async () => {
    const { em, service } = createService()

    await service.findOne(Invoice, scope, { sourceInvoiceId: 'source-1' }, { includeDeleted: true })

    expect(em.findOne).toHaveBeenCalledWith(Invoice, {
      sourceInvoiceId: 'source-1',
      tenantId: 'tenant-trusted',
      organizationId: 'org-trusted',
    }, {})
  })

  it('findOne does not pass includeDeleted to MikroORM options', async () => {
    const { em, service } = createService()

    await service.findOne(
      InvoiceCompany,
      scope,
      { taxCode: '0100109106' },
      { includeDeleted: true, populate: ['emails'] },
    )

    expect(em.findOne).toHaveBeenCalledWith(InvoiceCompany, {
      taxCode: '0100109106',
      tenantId: 'tenant-trusted',
      organizationId: 'org-trusted',
    }, { populate: ['emails'] })
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
      deletedAt: null,
      tenantId: 'tenant-trusted',
      organizationId: 'org-trusted',
    }, undefined)
  })

  it('findMany filters soft-deletable collection reads by deletedAt null', async () => {
    const { em, service } = createService()

    await service.findMany(Invoice, scope, { direction: 'AP' })

    expect(em.find).toHaveBeenCalledWith(Invoice, {
      direction: 'AP',
      deletedAt: null,
      tenantId: 'tenant-trusted',
      organizationId: 'org-trusted',
    }, undefined)
  })

  it('findMany can include soft-deleted records when explicitly requested', async () => {
    const { em, service } = createService()

    await service.findMany(
      InvoiceCompany,
      scope,
      { name: 'ACME' },
      { includeDeleted: true, orderBy: { name: 'asc' } },
    )

    expect(em.find).toHaveBeenCalledWith(InvoiceCompany, {
      name: 'ACME',
      tenantId: 'tenant-trusted',
      organizationId: 'org-trusted',
    }, { orderBy: { name: 'asc' } })
  })

  it('findMany does not add deletedAt for entities without soft delete', async () => {
    const { em, service } = createService()

    await service.findMany(InvoiceCompanyEmail, scope, { email: 'billing@example.com' })

    expect(em.find).toHaveBeenCalledWith(InvoiceCompanyEmail, {
      email: 'billing@example.com',
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

describe('invoice soft-delete registry', () => {
  it('covers every entity class that declares deleted_at', () => {
    const source = readFileSync(join(__dirname, '..', 'data', 'entities.ts'), 'utf8')
    const declaringSoftDelete = source
      .split(/^export class /m)
      .slice(1)
      .filter((block) => block.includes("name: 'deleted_at'"))
      .map((block) => block.split(/[\s{]/)[0])
      .sort()

    expect(declaringSoftDelete.length).toBeGreaterThan(0)
    expect(INVOICE_SOFT_DELETABLE_ENTITIES.map((entity) => entity.name).sort()).toEqual(declaringSoftDelete)
  })
})
