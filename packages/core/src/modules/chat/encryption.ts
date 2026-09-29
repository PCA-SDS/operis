import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

/**
 * An outsider's name is personal data that chat stores on its own row, unlike a
 * colleague's, which lives on `auth`'s user. Message bodies stay plain text for
 * everyone — full-text search reads them.
 */
export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'chat:chat_external_contact',
    fields: [{ field: 'display_name' }],
  },
]

export default defaultEncryptionMaps
