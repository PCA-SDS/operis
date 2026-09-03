// Server-side copy for everything a chat request can answer with. Each string
// is resolved through the module's locale bundle; the English text alongside the
// key is the fallback the i18n layer uses when a locale has no entry yet.

import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export type ChatMessages = Awaited<ReturnType<typeof loadChatMessages>>

export async function loadChatMessages() {
  const { t } = await resolveTranslations()
  return {
    unauthorized: t('chat.errors.unauthorized', 'Unauthorized'),
    validationFailed: t('chat.errors.validationFailed', 'Validation failed'),
    internal: t('chat.errors.internal', 'Something went wrong. Please try again.'),
    // Deliberately the same string for "no such conversation" and "not yours":
    // telling the two apart would confirm which ids exist.
    conversationNotFound: t('chat.errors.conversationNotFound', 'Conversation not found'),
    recipientNotFound: t(
      'chat.errors.recipientNotFound',
      'That person is not an active member of your organization.',
    ),
    notOrganizationMember: t(
      'chat.errors.notOrganizationMember',
      'You are not a member of the selected organization, so you cannot use chat there.',
    ),
    cannotMessageSelf: t('chat.errors.cannotMessageSelf', 'You cannot start a conversation with yourself.'),
    rateLimited: t('chat.errors.rateLimited', 'You are sending messages too quickly. Please slow down.'),
    rateLimitUnavailable: t(
      'chat.errors.rateLimitUnavailable',
      'Chat is temporarily unavailable. Please try again in a moment.',
    ),
  }
}
