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
    notASpace: t('chat.errors.notASpace', 'That conversation is not a space.'),
    notSpaceOwner: t('chat.errors.notSpaceOwner', 'Only a space owner can do that.'),
    // Same string as `recipientNotFound` would be, but reached from the member
    // picker rather than from starting a chat — and deliberately identical for
    // "no such user", "user in another organization" and "user deactivated", so
    // adding a member cannot be used to probe who exists elsewhere.
    memberNotFound: t(
      'chat.errors.memberNotFound',
      'One or more of those people are not active members of your organization.',
    ),
    memberNotInSpace: t('chat.errors.memberNotInSpace', 'That person is not in this space.'),
    lastOwnerCannotLeave: t(
      'chat.errors.lastOwnerCannotLeave',
      'You are the only owner. Make someone else an owner before you leave.',
    ),
    lastOwnerCannotStepDown: t(
      'chat.errors.lastOwnerCannotStepDown',
      'A space needs at least one owner. Make someone else an owner first.',
    ),
    // The label the read model uses when a conversation's other person is no
    // longer an active member. Resolved server-side because the title is
    // computed there, so every surface renders the same words.
    formerColleague: t('chat.list.unknownPerson', 'Former colleague'),
    replyTargetNotFound: t(
      'chat.errors.replyTargetNotFound',
      'The message you replied to is no longer available.',
    ),
  }
}
