import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'

import { Invoice } from '../data/entities'
import { hashInvoicePublicToken, invoicePublicTokenSchema, type InvoicePublicToken } from '../data/validators'
import { emitInvoiceEvent } from '../events'

const logger = createLogger('invoice').child({ component: 'tracking-service' })

export class InvoiceTrackingService {
  constructor(private readonly em: EntityManager) {}

  async recordOpen(rawToken: InvoicePublicToken): Promise<'matched' | 'repeated' | 'not-matched'> {
    const token = invoicePublicTokenSchema.parse(rawToken)
    const tokenHash = hashInvoicePublicToken(token)
    const invoice = await this.em.findOne(Invoice, {
      emailTrackingTokenHash: tokenHash,
      deletedAt: null,
    }, { fields: ['id', 'tenantId', 'organizationId', 'openedAt'] })
    if (!invoice) {
      logger.info('Invoice tracking token not matched')
      return 'not-matched'
    }
    if (invoice.openedAt) {
      logger.info('Invoice tracking open repeated', { invoiceId: invoice.id })
      return 'repeated'
    }

    const openedAt = new Date()
    const changed = await this.em.nativeUpdate(Invoice, {
      id: invoice.id,
      tenantId: invoice.tenantId,
      organizationId: invoice.organizationId,
      emailTrackingTokenHash: tokenHash,
      openedAt: null,
      deletedAt: null,
    }, { openedAt })
    if (changed > 0) {
      logger.info('Invoice tracking first open matched', { invoiceId: invoice.id })
      await emitInvoiceEvent('invoice.invoice.opened', {
        id: invoice.id,
        tenantId: invoice.tenantId,
        organizationId: invoice.organizationId,
      })
      return 'matched'
    }

    logger.info('Invoice tracking open repeated', { invoiceId: invoice.id })
    return 'repeated'
  }
}

export function createInvoiceTrackingService(em: EntityManager): InvoiceTrackingService {
  return new InvoiceTrackingService(em)
}
