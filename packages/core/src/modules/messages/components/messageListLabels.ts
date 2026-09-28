import type { MessageFolder } from './useMessagesInboxBulkActions'
import type { TranslateWithRequiredFallbackFn } from '@open-mercato/shared/lib/i18n/translate'
import { normalizeOptionalString } from '@open-mercato/shared/lib/string'

type MessageParticipantSource = {
  senderName?: string | null
  senderEmail?: string | null
  senderUserId: string
  recipientCount?: number | null
}

export function getMessageListParticipantLabel(
  item: MessageParticipantSource,
  folder: MessageFolder,
  t: TranslateWithRequiredFallbackFn,
): string {
  if ((folder === 'sent' || folder === 'drafts') && Number(item.recipientCount ?? 0) <= 0) {
    return t('messages.list.noRecipient', '(No recipient)')
  }

  return normalizeOptionalString(item.senderName)
    ?? normalizeOptionalString(item.senderEmail)
    ?? item.senderUserId
}
