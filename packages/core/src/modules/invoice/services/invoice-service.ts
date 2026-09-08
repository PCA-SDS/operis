import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import { E } from '#generated/entities.ids.generated'

import { Invoice } from '../data/entities'
import {
  mapInvoiceEntityToDetailDto,
  mapInvoiceQueryRowToListDto,
  type InvoiceDetailDto,
  type InvoiceListDto,
} from '../data/mappers'
import {
  buildInvoiceListQueryOptions,
  parseInvoiceListQuery,
} from '../data/queries'
import type { InvoiceScope } from '../data/scope'
import type { InvoiceScopedPersistenceService } from './scoped-persistence-service'

export type InvoiceListResult = {
  items: InvoiceListDto[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export type InvoiceListInput = Record<string, unknown>

export class InvoiceService {
  constructor(
    private readonly queryEngine: QueryEngine,
    private readonly scopedPersistence: InvoiceScopedPersistenceService,
  ) {}

  async listInvoices(scope: InvoiceScope, query: InvoiceListInput = {}): Promise<InvoiceListResult> {
    const parsed = parseInvoiceListQuery(query)
    const options = buildInvoiceListQueryOptions(parsed)
    const result = await this.queryEngine.query<Record<string, unknown>>(E.invoice.invoice, {
      ...options,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })

    return {
      items: result.items.map(mapInvoiceQueryRowToListDto),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: Math.ceil(result.total / parsed.pageSize),
    }
  }

  async getInvoiceDetail(scope: InvoiceScope, id: string): Promise<InvoiceDetailDto> {
    const invoice = await this.scopedPersistence.findById(Invoice, scope, id, {
      populate: ['company', 'lineItems', 'installments'],
      orderBy: {
        lineItems: { lineNumber: 'asc' },
        installments: { sequence: 'asc' },
      },
    })
    if (!invoice) throw notFound('[internal] Invoice not found')

    return mapInvoiceEntityToDetailDto(invoice)
  }
}

export function createInvoiceService(
  queryEngine: QueryEngine,
  scopedPersistence: InvoiceScopedPersistenceService,
): InvoiceService {
  return new InvoiceService(queryEngine, scopedPersistence)
}
