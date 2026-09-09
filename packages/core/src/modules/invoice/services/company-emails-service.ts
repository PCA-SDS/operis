import type { EntityManager } from '@mikro-orm/postgresql'

import { InvoiceCompany, InvoiceCompanyEmail } from '../data/entities'
import type { InvoiceScope } from '../data/scope'
import {
  invoiceCompanyEmailIdSchema,
  invoiceCompanyEmailRecordSchema,
  invoiceCompanyIdSchema,
} from '../data/validators'
import type { InvoiceScopedPersistenceService } from './scoped-persistence-service'

export type InvoiceCompanyEmailRecordInput = {
  companyId: string
  email?: string | null
}

export type InvoiceCompanyEmailRemoveInput = {
  companyId: string
  id: string
}

export class InvoiceCompanyEmailsService {
  constructor(
    private readonly em: EntityManager,
    private readonly scopedPersistence: InvoiceScopedPersistenceService,
  ) {}

  async listByCompany(scope: InvoiceScope, companyId: string): Promise<InvoiceCompanyEmail[]> {
    const parsedCompanyId = invoiceCompanyIdSchema.parse(companyId)
    const company = await this.scopedPersistence.requireById(InvoiceCompany, scope, parsedCompanyId)

    return this.scopedPersistence.findMany(InvoiceCompanyEmail, scope, { company }, {
      orderBy: { updatedAt: 'desc' },
    })
  }

  async record(scope: InvoiceScope, input: InvoiceCompanyEmailRecordInput): Promise<InvoiceCompanyEmail | null> {
    const email = input.email?.trim()
    if (!email) return null

    const parsed = invoiceCompanyEmailRecordSchema.parse({
      companyId: input.companyId,
      email,
    })
    const company = await this.scopedPersistence.requireById(InvoiceCompany, scope, parsed.companyId)
    const now = new Date()

    return this.em.upsert(InvoiceCompanyEmail, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      company,
      email: parsed.email,
      updatedAt: now,
      createdAt: now,
    }, {
      onConflictFields: ['company', 'email'],
      onConflictMergeFields: ['updatedAt'],
    })
  }

  async remove(scope: InvoiceScope, input: InvoiceCompanyEmailRemoveInput): Promise<void> {
    const companyId = invoiceCompanyIdSchema.parse(input.companyId)
    const id = invoiceCompanyEmailIdSchema.parse(input.id)
    const company = await this.scopedPersistence.requireById(InvoiceCompany, scope, companyId)

    await this.em.nativeDelete(InvoiceCompanyEmail, {
      id,
      company,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
  }
}

export function createInvoiceCompanyEmailsService(
  em: EntityManager,
  scopedPersistence: InvoiceScopedPersistenceService,
): InvoiceCompanyEmailsService {
  return new InvoiceCompanyEmailsService(em, scopedPersistence)
}
