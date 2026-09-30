import type { EntityExtension } from '@open-mercato/shared/modules/entities'

/**
 * A chat contact can be a CRM record — a person or a company in `customers`.
 *
 * Declared here, by the module that holds the link, so `customers` never has to
 * know chat exists. Chat reads the record through DI (`lib/crm.ts`) and shows
 * no CRM at all when `customers` is not installed.
 */
const entityExtensions: EntityExtension[] = [
  {
    base: 'customers:customer_entity',
    extension: 'chat:chat_external_contact',
    join: { baseKey: 'id', extensionKey: 'customer_entity_id' },
    cardinality: 'one-to-many',
    description: 'Chat contacts — a WhatsApp number, say — linked to a CRM person or company',
  },
]

export const extensions = entityExtensions
export default entityExtensions
