import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'invoice.invoice.created', label: 'Invoice Created', entity: 'invoice', category: 'crud' },
  { id: 'invoice.invoice.updated', label: 'Invoice Updated', entity: 'invoice', category: 'crud' },
  { id: 'invoice.invoice.deleted', label: 'Invoice Deleted', entity: 'invoice', category: 'crud' },
  { id: 'invoice.invoice.sent', label: 'Invoice Sent', entity: 'invoice', category: 'lifecycle' },
  { id: 'invoice.invoice.opened', label: 'Invoice Opened', entity: 'invoice', category: 'lifecycle' },
  { id: 'invoice.invoice.settled', label: 'Invoice Settled', entity: 'invoice', category: 'lifecycle' },
  {
    id: 'invoice.payment_confirmation.requested',
    label: 'Payment Confirmation Requested',
    entity: 'payment_confirmation',
    category: 'lifecycle',
  },
  {
    id: 'invoice.payment_confirmation.confirmed',
    label: 'Payment Confirmation Confirmed',
    entity: 'payment_confirmation',
    category: 'lifecycle',
  },
  {
    id: 'invoice.payment_confirmation.rejected',
    label: 'Payment Confirmation Rejected',
    entity: 'payment_confirmation',
    category: 'lifecycle',
  },
  { id: 'invoice.sync.started', label: 'Invoice Sync Started', entity: 'sync', category: 'lifecycle' },
  { id: 'invoice.sync.completed', label: 'Invoice Sync Completed', entity: 'sync', category: 'lifecycle' },
  { id: 'invoice.sync.failed', label: 'Invoice Sync Failed', entity: 'sync', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'invoice',
  events,
})

export const emitInvoiceEvent = eventsConfig.emit
export type InvoiceEventId = typeof events[number]['id']

export default eventsConfig
