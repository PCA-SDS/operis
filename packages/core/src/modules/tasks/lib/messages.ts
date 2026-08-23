// Server-side error copy. Every message a user can see is resolved through the
// module's locale bundle; the English text passed alongside each key is the
// fallback the i18n layer uses when a locale has no entry yet.

import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export type TasksMessages = Awaited<ReturnType<typeof loadTasksMessages>>

export async function loadTasksMessages() {
  const { t } = await resolveTranslations()
  return {
    projectNotFound: t('tasks.errors.projectNotFound', 'Project not found'),
    projectKeyTaken: (key: string) =>
      t('tasks.errors.projectKeyTaken', 'A project with the key "{key}" already exists.', { key }),
    inboxImmutable: t('tasks.errors.inboxImmutable', "The Inbox project can't be edited."),
    inboxNotArchivable: t('tasks.errors.inboxNotArchivable', "The Inbox project can't be archived."),
    inboxNotDeletable: t('tasks.errors.inboxNotDeletable', "The Inbox project can't be deleted."),
    inboxKeysTaken: t(
      'tasks.errors.inboxKeysTaken',
      "Couldn't create the Inbox project — the INBOX project keys are taken.",
    ),
    taskNotFound: t('tasks.errors.taskNotFound', 'Task not found'),
    milestoneNotFound: t('tasks.errors.milestoneNotFound', 'Milestone not found'),
    milestoneWrongProject: t(
      'tasks.errors.milestoneWrongProject',
      'The selected milestone does not belong to this project.',
    ),
    parentWrongProject: t(
      'tasks.errors.parentWrongProject',
      'The selected parent task does not belong to this project.',
    ),
    parentIsSelf: t('tasks.errors.parentIsSelf', 'A task cannot be its own subtask.'),
    parentIsDescendant: t(
      'tasks.errors.parentIsDescendant',
      'A task cannot be moved under one of its own subtasks.',
    ),
    dueTimeNeedsDate: t('tasks.errors.dueTimeNeedsDate', 'A due time needs a due date.'),
    unknownUsers: t(
      'tasks.errors.unknownUsers',
      'One or more selected people are not active members of your company.',
    ),
    unknownLabels: t('tasks.errors.unknownLabels', "One or more selected labels don't belong to your workspace."),
    unknownRoles: t('tasks.errors.unknownRoles', "One or more selected roles don't belong to your company."),
    tooManyTargets: t(
      'tasks.errors.tooManyTargets',
      'A task can have at most 20 role targets.',
    ),
    targetNeedsRole: t('tasks.errors.targetNeedsRole', 'A role target needs a role.'),
    unknownTargetKind: t('tasks.errors.unknownTargetKind', 'Unknown assignment target kind.'),
    labelNotFound: t('tasks.errors.labelNotFound', 'Label not found'),
    labelNameTaken: (name: string) =>
      t('tasks.errors.labelNameTaken', 'A label called "{name}" already exists.', { name }),
    commentNotFound: t('tasks.errors.commentNotFound', 'Comment not found'),
    commentNotYours: t('tasks.errors.commentNotYours', 'You can only edit your own comments.'),
    docNotFound: t('tasks.errors.docNotFound', 'Page not found'),
    docWrongProject: t('tasks.errors.docWrongProject', 'The selected parent page belongs to another project.'),
    docIsDescendant: t('tasks.errors.docIsDescendant', 'A page cannot be moved under one of its own sub-pages.'),
    calendarRangeInverted: t('tasks.errors.calendarRangeInverted', 'to must be on or after from.'),
    calendarRangeTooWide: (days: number) =>
      t('tasks.errors.calendarRangeTooWide', 'A calendar window may span at most {days} days.', { days }),
    teamMemberForbidden: t(
      'tasks.errors.teamMemberForbidden',
      "You don't have access to this person's tasks.",
    ),
    untitledPage: t('tasks.docs.untitled', 'Untitled page'),
    inboxName: t('tasks.inbox.name', 'Inbox'),
  }
}
