import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

import './commands/auto-paid'
import './commands/invoices'
import './commands/payment-confirmations'

export const metadata: ModuleInfo = {
  name: 'invoice',
  title: 'Invoice',
  version: '0.1.0',
  description: 'AP and AR invoice accounting contracts for Operis.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
  defaultEntitlement: 'disabled',
}

export { features } from './acl'
export { createGdtClient } from './services/gdt-client'
export { createInvoiceSyncPersistenceService } from './services/sync-persistence-service'
export {
  buildGdtSourceInvoiceId,
  classifyGdtError,
  fetchGdtRecords,
  GdtProviderError,
  iterateGdtWindows,
  MalformedGdtInvoiceError,
  normalizeGdtInvoice,
} from './services/gdt/index'
export type { GdtClient, GdtAuthResult } from './services/gdt-client'
export type { NormalizedInvoiceLine, NormalizedInvoiceSource } from './services/gdt/index'
