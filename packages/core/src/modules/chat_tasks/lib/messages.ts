// Server-side copy for everything this module can answer with. Each string is
// resolved through the module's locale bundle; the English text beside the key is
// the fallback the i18n layer uses when a locale has no entry yet.

import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export type ChatTasksMessages = Awaited<ReturnType<typeof loadChatTasksMessages>>

export async function loadChatTasksMessages() {
  const { t } = await resolveTranslations()
  return {
    unauthorized: t('chat_tasks.errors.unauthorized', 'Unauthorized'),
    validationFailed: t('chat_tasks.errors.validationFailed', 'Validation failed'),
    internal: t('chat_tasks.errors.internal', 'Something went wrong. Please try again.'),
    /**
     * One string for "no such conversation", "not yours" and "deleted".
     *
     * The same rule chat follows, for the same reason: three distinguishable
     * answers are three bits of an id-guessing oracle.
     */
    conversationNotFound: t('chat_tasks.errors.conversationNotFound', 'Conversation not found'),
    /** Likewise one string for "no such task", "another tenant's" and "no grant". */
    taskNotFound: t('chat_tasks.errors.taskNotFound', 'Task not found'),
    linkNotFound: t('chat_tasks.errors.linkNotFound', 'That linked task is no longer available.'),
    messageNotFound: t(
      'chat_tasks.errors.messageNotFound',
      'That message is no longer available. Write the task details yourself and try again.',
    ),
    cannotCreateTasks: t('chat_tasks.errors.cannotCreateTasks', 'You do not have permission to create tasks.'),
    cannotAssignTasks: t(
      'chat_tasks.errors.cannotAssignTasks',
      'You do not have permission to assign tasks to other people.',
    ),
    cannotSendToConversation: t(
      'chat_tasks.errors.cannotSendToConversation',
      'You do not have permission to post in this conversation.',
    ),
    assigneeRequired: t(
      'chat_tasks.errors.assigneeRequired',
      'Choose who this task is for. A task in a space has no default assignee.',
    ),
    counterpartInactive: t(
      'chat_tasks.errors.counterpartInactive',
      'That colleague is no longer active in this organization, so a task cannot be assigned to them. Choose someone else.',
    ),
    counterpartNotAssignable: t(
      'chat_tasks.errors.counterpartNotAssignable',
      'That colleague cannot be assigned tasks in this organization. Choose someone else.',
    ),
    tasksModuleUnavailable: t(
      'chat_tasks.errors.tasksModuleUnavailable',
      'Tasks are not switched on for this organization.',
    ),
    chatModuleUnavailable: t(
      'chat_tasks.errors.chatModuleUnavailable',
      'Chat is not switched on for this organization.',
    ),
    idempotencyKeyReused: t(
      'chat_tasks.errors.idempotencyKeyReused',
      'That request id was already used for different task details. Reload and try again.',
    ),
    requestInProgress: t(
      'chat_tasks.errors.requestInProgress',
      'That task is still being created. Give it a moment, then check your task list before trying again.',
    ),
    alreadyLinked: t('chat_tasks.errors.alreadyLinked', 'That task is already linked to this conversation.'),
    cardAlreadyPublished: t(
      'chat_tasks.errors.cardAlreadyPublished',
      'A card for that task is already in this conversation.',
    ),
    inboxUnavailable: t(
      'chat_tasks.errors.inboxUnavailable',
      "The Inbox isn't ready yet — try again in a second.",
    ),
    /**
     * Not an error: the honest half of a partial success. The task is real and
     * the card is not, and the caller is told both.
     */
    cardNotPublished: t(
      'chat_tasks.errors.cardNotPublished',
      'The task was created, but the card could not be posted in this conversation. Try posting it again.',
    ),
  }
}
