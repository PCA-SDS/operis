import {
  INVOICE_COMPANY_REGISTRY_ENTITY_ID,
  INVOICE_COMPANY_REGISTRY_PAYLOAD_FIELD,
  assertInvoiceCompanyRegistryPayloadEncryptionConfigured,
  defaultEncryptionMaps,
} from '../encryption'

describe('invoice defaultEncryptionMaps', () => {
  it('encrypts provider payloads in the company registry cache', () => {
    const entry = defaultEncryptionMaps.find((map) => map.entityId === INVOICE_COMPANY_REGISTRY_ENTITY_ID)

    expect(entry).toBeTruthy()
    expect(entry?.fields).toEqual([
      { field: INVOICE_COMPANY_REGISTRY_PAYLOAD_FIELD },
    ])
    expect(() => assertInvoiceCompanyRegistryPayloadEncryptionConfigured()).not.toThrow()
  })
})
