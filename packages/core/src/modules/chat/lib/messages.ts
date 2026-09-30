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
    tooManyMediaAttachments: t(
      'chat.errors.tooManyMediaAttachments',
      'A message can carry up to 20 images or videos.',
    ),
    tooManyFileAttachments: t(
      'chat.errors.tooManyFileAttachments',
      'A message can carry one file. Send the others separately.',
    ),
    attachmentNotAvailable: t(
      'chat.errors.attachmentNotAvailable',
      'That attachment is no longer available. Remove it and try again.',
    ),
    attachmentNotReady: t(
      'chat.errors.attachmentNotReady',
      'That attachment is still being checked. Try again in a moment.',
    ),
    attachmentRejected: t(
      'chat.errors.attachmentRejected',
      "That attachment didn't pass our security check and can't be sent.",
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
    lastColleagueCannotLeave: t(
      'chat.errors.lastColleagueCannotLeave',
      'Someone has to stay with this client. Add a colleague before you leave.',
    ),
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
    // The same fallback for an outsider, who is never a "former colleague".
    unknownContact: t('chat.external.unknownContact', 'Unknown contact'),
    /** How `<@everyone>` reads once resolved out of a stored body. */
    everyoneLabel: t('chat.mentions.everyone', 'everyone'),
    mentionNotAllowed: t(
      'chat.errors.mentionNotAllowed',
      'You can only mention people who are in this conversation.',
    ),
    everyoneNotAllowed: t(
      'chat.errors.everyoneNotAllowed',
      '@everyone can only be used in a space.',
    ),
    messageNotFound: t('chat.errors.messageNotFound', 'That message is no longer available.'),
    notPinPermitted: t('chat.errors.notPinPermitted', 'Only a space owner can pin messages.'),
    replyTargetNotFound: t(
      'chat.errors.replyTargetNotFound',
      'The message you replied to is no longer available.',
    ),
    notEditPermitted: t('chat.errors.notEditPermitted', 'You can only edit your own messages.'),
    notDeletePermitted: t(
      'chat.errors.notDeletePermitted',
      'Only the person who wrote a message, or a space owner, can delete it.',
    ),
    // Membership events are the transcript's record of what happened to the
    // conversation, not something anybody typed. Rewriting or removing one
    // would be editing history rather than editing a message.
    systemMessageNotEditable: t(
      'chat.errors.systemMessageNotEditable',
      "That's a record of a change to the conversation, so it can't be edited or deleted.",
    ),
    // Same string for "no such account" and "not one you may manage", so
    // account ids cannot be probed.
    accountNotFound: t('chat.accounts.errors.notFound', 'Account not found'),
    accountNetworkUnavailable: t(
      'chat.accounts.errors.networkUnavailable',
      "That network isn't available on this server.",
    ),
    accountPersonalUnavailable: t(
      'chat.accounts.errors.personalUnavailable',
      "Personal accounts aren't available on this server.",
    ),
    accountPersonalExists: t(
      'chat.accounts.errors.personalExists',
      'You already have a personal account on that network.',
    ),
    accountTeamRequired: t(
      'chat.accounts.errors.teamRequired',
      "Choose at least one colleague to handle this account's chats.",
    ),
    accountAlreadyConnected: t(
      'chat.accounts.errors.alreadyConnected',
      'This account is already connected. Disconnect it first.',
    ),
    accountPhoneRequired: t(
      'chat.accounts.errors.phoneRequired',
      'Enter the phone number in international format, e.g. +49 151 23456789.',
    ),
    accessViewerCannotReply: t(
      'chat.errors.accessViewerCannotReply',
      'You can read this chat and write internal notes, but not answer the client. Ask a manager of the chat to make you a participant.',
    ),
    accessManagerRequired: t(
      'chat.errors.accessManagerRequired',
      'Only a manager of this chat can change who is in it.',
    ),
    lastManagerCannotLeave: t(
      'chat.errors.lastManagerCannotLeave',
      'This chat needs a manager. Make someone else a manager before you leave or step down.',
    ),
    internalNoteNotAllowed: t(
      'chat.errors.internalNoteNotAllowed',
      'Internal notes are for client conversations, where the client could otherwise read what you write.',
    ),
    accountNotConnected: t(
      'chat.accounts.errors.notConnected',
      "This chat's WhatsApp account is disconnected, so nothing can be sent. Reconnect it first.",
    ),
    accountUnreachable: t(
      'chat.accounts.errors.unreachable',
      "WhatsApp can't be reached right now. Try again in a moment.",
    ),
    accountChatNotFound: t(
      'chat.accounts.errors.chatNotFound',
      "That chat isn't on this WhatsApp any more.",
    ),
    crmUnavailable: t('chat.errors.crmUnavailable', "The CRM isn't available here."),
    crmRecordNotFound: t(
      'chat.errors.crmRecordNotFound',
      "That CRM record doesn't exist, or you can't open it.",
    ),
    crmLinkNotAllowed: t(
      'chat.errors.crmLinkNotAllowed',
      'Only colleagues who can answer the client can link them to the CRM.',
    ),
    contactNotInConversation: t(
      'chat.errors.contactNotInConversation',
      "That person isn't in this conversation.",
    ),
  }
}
