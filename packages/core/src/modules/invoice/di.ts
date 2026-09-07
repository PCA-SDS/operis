import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

import {
  Invoice,
  InvoiceAutoPaidTaxCode,
  InvoiceCompany,
  InvoiceCompanyEmail,
  InvoiceCompanyRegistry,
  InvoiceInstallment,
  InvoiceLineItem,
  InvoicePaymentConfirmation,
  InvoiceSyncJob,
} from './data/entities'
import { createInvoiceScopedPersistenceService } from './services/scoped-persistence-service'
import { createInvoicePartnerTermsService } from './services/partner-terms-service'

export function register(container: AppContainer) {
  container.register({
    invoiceScopedPersistenceService: asFunction(({ em }) => createInvoiceScopedPersistenceService(em)).scoped().proxy(),
    invoicePartnerTermsService: asFunction(({ em, invoiceScopedPersistenceService }) =>
      createInvoicePartnerTermsService(em, invoiceScopedPersistenceService),
    ).scoped().proxy(),
    Invoice: asValue(Invoice),
    InvoiceAutoPaidTaxCode: asValue(InvoiceAutoPaidTaxCode),
    InvoiceCompany: asValue(InvoiceCompany),
    InvoiceCompanyEmail: asValue(InvoiceCompanyEmail),
    InvoiceCompanyRegistry: asValue(InvoiceCompanyRegistry),
    InvoiceInstallment: asValue(InvoiceInstallment),
    InvoiceLineItem: asValue(InvoiceLineItem),
    InvoicePaymentConfirmation: asValue(InvoicePaymentConfirmation),
    InvoiceSyncJob: asValue(InvoiceSyncJob),
  })
}
