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
import { createInvoiceCompanyEmailsService } from './services/company-emails-service'
import { createInvoiceExchangeRatesService } from './services/exchange-rates-service'
import { createInvoiceCompanyLookupService } from './services/company-lookup-service'
import { createInvoiceAutoPaidService } from './services/auto-paid-service'
import { createInvoiceService } from './services/invoice-service'
import { createInvoiceTrackingService } from './services/invoice-tracking-service'
import { createInvoicePaymentConfirmationsService } from './services/payment-confirmations-service'
import { createInvoiceSyncService } from './services/sync-service'
import { createGdtClient } from './services/gdt-client'
import { createInvoiceSyncPersistenceService } from './services/sync-persistence-service'
import { createGdtFetcherService, InvoiceNormalizer } from './services/gdt/index'

export function register(container: AppContainer) {
  container.register({
    gdtClient: asFunction(() => createGdtClient()).singleton(),
    gdtFetcherService: asFunction(({ gdtClient }) => createGdtFetcherService(gdtClient)).scoped().proxy(),
    invoiceNormalizer: asFunction(() => new InvoiceNormalizer()).singleton(),
    invoiceScopedPersistenceService: asFunction(({ em }) => createInvoiceScopedPersistenceService(em)).scoped().proxy(),
    invoicePartnerTermsService: asFunction(({ em, invoiceScopedPersistenceService }) =>
      createInvoicePartnerTermsService(em, invoiceScopedPersistenceService),
    ).scoped().proxy(),
    invoiceCompanyEmailsService: asFunction(({ em, invoiceScopedPersistenceService }) =>
      createInvoiceCompanyEmailsService(em, invoiceScopedPersistenceService),
    ).scoped().proxy(),
    invoiceExchangeRatesService: asFunction(() => createInvoiceExchangeRatesService()).singleton().proxy(),
    invoiceCompanyLookupService: asFunction(({ em }) => createInvoiceCompanyLookupService(em)).scoped().proxy(),
    invoiceAutoPaidService: asFunction(({ em, invoiceScopedPersistenceService }) =>
      createInvoiceAutoPaidService(em, invoiceScopedPersistenceService),
    ).scoped().proxy(),
    invoiceTrackingService: asFunction(({ em }) => createInvoiceTrackingService(em)).scoped().proxy(),
    invoicePaymentConfirmationsService: asFunction(({ em, invoiceCompanyEmailsService, invoiceService }) =>
      createInvoicePaymentConfirmationsService(em, invoiceCompanyEmailsService, invoiceService),
    ).scoped().proxy(),
    invoiceService: asFunction(({
      em,
      queryEngine,
      invoiceScopedPersistenceService,
      invoiceExchangeRatesService,
      invoiceCompanyEmailsService,
    }) =>
      createInvoiceService(
        em,
        queryEngine,
        invoiceScopedPersistenceService,
        invoiceExchangeRatesService,
        invoiceCompanyEmailsService,
      ),
    ).scoped().proxy(),
    invoiceSyncService: asFunction(({ em, cache, progressService, gdtClient, tenantEncryptionService }) =>
      createInvoiceSyncService(em, cache, progressService, gdtClient, tenantEncryptionService),
    ).scoped().proxy(),
    invoiceSyncPersistenceService: asFunction(({ em, invoiceScopedPersistenceService, invoicePartnerTermsService }) =>
      createInvoiceSyncPersistenceService(em, invoiceScopedPersistenceService, invoicePartnerTermsService),
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
