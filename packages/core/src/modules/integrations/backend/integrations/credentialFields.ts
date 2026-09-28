import type { IntegrationCredentialField, CredentialFieldType } from '@open-mercato/shared/modules/integrations/types'

export type CredentialField = IntegrationCredentialField

export const UNSUPPORTED_CREDENTIAL_FIELD_TYPES = new Set<CredentialFieldType>(['oauth', 'ssh_keypair'])

export function isEditableCredentialField(field: CredentialField): boolean {
  return !UNSUPPORTED_CREDENTIAL_FIELD_TYPES.has(field.type)
}
