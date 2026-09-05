import { addDays } from 'date-fns'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'

import { InvoiceCompany } from '../data/entities'
import type { InvoiceScope } from '../data/scope'
import {
  invoicePartnerListQuerySchema,
  invoicePartnerMatchQuerySchema,
  invoicePartnerTermsUpdateSchema,
} from '../data/validators'
import type { InvoiceScopedPersistenceService } from './scoped-persistence-service'

export type InvoicePartnerListQuery = {
  page?: number | string
  pageSize?: number | string
  search?: string
}

export type InvoicePartnerMatchQuery = {
  taxCode?: string | null
  name?: string | null
}

export type InvoicePartnerTermsUpdateInput = {
  defaultDueDays: number | string | null
}

export type InvoicePartnerDueDateInput = InvoicePartnerMatchQuery & {
  invoiceDate: Date
  dueDate?: Date | null
}

export type InvoicePartnerListResult = {
  items: InvoiceCompany[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export class InvoicePartnerTermsService {
  constructor(
    private readonly em: EntityManager,
    private readonly scopedPersistence: InvoiceScopedPersistenceService,
  ) {}

  private buildListWhere(query: InvoicePartnerListQuery): {
    where: FilterQuery<InvoiceCompany>
    page: number
    pageSize: number
  } {
    const parsed = invoicePartnerListQuerySchema.parse(query)
    const where: FilterQuery<InvoiceCompany> = {}
    const search = parsed.search?.trim()

    if (search) {
      const term = buildIlikeTerm(search)
      where.$or = [
        { name: { $ilike: term } },
        { taxCode: { $ilike: term } },
      ] as FilterQuery<InvoiceCompany>[]
    }

    return { where, page: parsed.page, pageSize: parsed.pageSize }
  }

  async listPartners(scope: InvoiceScope, query: InvoicePartnerListQuery = {}): Promise<InvoiceCompany[]> {
    const { where, page, pageSize } = this.buildListWhere(query)

    return this.scopedPersistence.findMany(InvoiceCompany, scope, where, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: { name: 'asc' },
    })
  }

  async listPartnersPage(scope: InvoiceScope, query: InvoicePartnerListQuery = {}): Promise<InvoicePartnerListResult> {
    const { where, page, pageSize } = this.buildListWhere(query)
    const [items, total] = await Promise.all([
      this.scopedPersistence.findMany(InvoiceCompany, scope, where, {
        limit: pageSize,
        offset: (page - 1) * pageSize,
        orderBy: { name: 'asc' },
      }),
      this.scopedPersistence.countMany(InvoiceCompany, scope, where),
    ])

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  }

  async getPartner(scope: InvoiceScope, companyId: string): Promise<InvoiceCompany | null> {
    return this.scopedPersistence.findById(InvoiceCompany, scope, companyId)
  }

  async matchPartner(scope: InvoiceScope, query: InvoicePartnerMatchQuery): Promise<InvoiceCompany | null> {
    const parsed = invoicePartnerMatchQuerySchema.parse({
      taxCode: query.taxCode ?? undefined,
      name: query.name ?? undefined,
    })

    if (parsed.taxCode) {
      return this.scopedPersistence.findOne(InvoiceCompany, scope, { taxCode: parsed.taxCode })
    }

    if (!parsed.name) return null

    return this.scopedPersistence.findOne(InvoiceCompany, scope, {
      name: { $ilike: escapeLikePattern(parsed.name) },
    } as FilterQuery<InvoiceCompany>)
  }

  async updateDefaultDueDays(
    scope: InvoiceScope,
    companyId: string,
    input: InvoicePartnerTermsUpdateInput,
  ): Promise<InvoiceCompany> {
    const parsed = invoicePartnerTermsUpdateSchema.parse(input)
    const company = await this.scopedPersistence.requireById(InvoiceCompany, scope, companyId)

    company.defaultDueDays = parsed.defaultDueDays
    await this.em.flush()

    return company
  }

  async resolveDefaultDueDate(scope: InvoiceScope, input: InvoicePartnerDueDateInput): Promise<Date | null> {
    if (input.dueDate) return input.dueDate

    const partner = await this.matchPartner(scope, input)
    if (typeof partner?.defaultDueDays !== 'number') return null

    return addDays(input.invoiceDate, partner.defaultDueDays)
  }
}

export function createInvoicePartnerTermsService(
  em: EntityManager,
  scopedPersistence: InvoiceScopedPersistenceService,
): InvoicePartnerTermsService {
  return new InvoicePartnerTermsService(em, scopedPersistence)
}
