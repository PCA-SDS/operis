import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

/**
 * An outsider's name and number are personal data that chat stores on its own
 * row, unlike a colleague's, which live on `auth`'s user. Message bodies stay
 * plain text for everyone — full-text search reads them.
 */
export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'chat:chat_external_contact',
    fields: [{ field: 'display_name' }, { field: 'handle' }],
  },
  /**
   * A connected account's name and phone number — for a personal account, an
   * employee's own number.
   */
  {
    entityId: 'chat:chat_messaging_account',
    fields: [{ field: 'display_name' }, { field: 'remote_handle' }],
  },
]

export default defaultEncryptionMaps
