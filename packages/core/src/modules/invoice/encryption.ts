import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const INVOICE_COMPANY_REGISTRY_ENTITY_ID = 'invoice:invoice_company_registry'
export const INVOICE_COMPANY_REGISTRY_PAYLOAD_FIELD = 'payload'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: INVOICE_COMPANY_REGISTRY_ENTITY_ID,
    fields: [{ field: INVOICE_COMPANY_REGISTRY_PAYLOAD_FIELD }],
  },
]

export function assertInvoiceCompanyRegistryPayloadEncryptionConfigured(): void {
  const map = defaultEncryptionMaps.find((entry) => entry.entityId === INVOICE_COMPANY_REGISTRY_ENTITY_ID)
  const encrypted = map?.fields.some((field) => field.field === INVOICE_COMPANY_REGISTRY_PAYLOAD_FIELD) ?? false
  if (!encrypted) {
    throw new Error('[internal] invoice company registry payload encryption is not configured')
  }
}

export default defaultEncryptionMaps
