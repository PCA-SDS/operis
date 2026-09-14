import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import { ChatConversation, ChatMessage, ChatParticipant } from '@open-mercato/core/modules/chat/data/entities'
import {
  chatDisplayName,
  loadOrganizationMembers,
} from '@open-mercato/core/modules/chat/lib/scope'
import { TasksProject, TasksTask, TasksTaskAssignee, TasksTaskAssignmentTarget } from '@open-mercato/core/modules/tasks/data/entities'
import { loadAssignedTaskIds } from '@open-mercato/core/modules/tasks/lib/assignment'
import { TASK_TERMINAL_STATUSES } from '@open-mercato/core/modules/tasks/data/types'
import { isoDate } from '@open-mercato/core/modules/tasks/lib/values'
import type { TaskRecurrenceDto } from '@open-mercato/core/modules/tasks/data/types'
import { ChatTaskLink } from '../data/entities'
import { loadChatTasksMessages } from '../lib/messages'
import type {
  ChatTaskCardDto,
  ChatTaskCardTaskDto,
  ChatTaskLinkListDto,
  ChatTaskSourceDto,
  ChatTaskSourceListDto,
} from '../data/types'
import type { ChatTaskLinkListQuery } from '../data/validators'
import { callerHasFeatures, scopedWhere, type ChatTasksScope } from '../lib/scope'
import { decodeLinkCursor, encodeLinkCursor } from '../lib/cursor'
import { taskHref } from '../lib/routes'

/**
 * Everything a caller needs to be identified by, resolved once per request.
 *
 * `container` is here rather than threaded separately because every read in this
 * service asks the RBAC service a question — the per-viewer authorization that
 * makes a shared card safe is not something a DTO can carry.
 */
export type ChatTaskReadContext = {
  container: AwilixContainer
  em: EntityManager
  scope: ChatTasksScope
  userId: string
}

/** The conversation, once membership is proved. */
export type ChatConversationAccess = {
  conversation: ChatConversation
  participant: ChatParticipant
}

export interface ChatTaskService {
  requireConversationAccess(ctx: ChatTaskReadContext, conversationId: string): Promise<ChatConversationAccess>
  listConversationLinks(
    ctx: ChatTaskReadContext,
    conversationId: string,
    query: ChatTaskLinkListQuery,
  ): Promise<ChatTaskLinkListDto>
  cardsForMessages(
    ctx: ChatTaskReadContext,
    conversationId: string,
    messageIds: readonly string[],
  ): Promise<ChatTaskCardDto[]>
  cardForLink(ctx: ChatTaskReadContext, linkId: string): Promise<ChatTaskCardDto>
  sourcesForTask(ctx: ChatTaskReadContext, taskId: string): Promise<ChatTaskSourceListDto>
  hydrateTasks(
    ctx: ChatTaskReadContext,
    taskIds: readonly string[],
  ): Promise<Map<string, ChatTaskCardTaskDto>>
  requireReadableTask(ctx: ChatTaskReadContext, taskId: string): Promise<ChatTaskCardTaskDto>
}

export class DefaultChatTaskService implements ChatTaskService {
  /**
   * Membership, checked the way chat checks it, answering 404 rather than 403.
   *
   * Deliberately re-implemented against `chat_participants` here instead of
   * calling into chat's own service: this module must prove access for itself on
   * every read, and routing through a shared helper that might one day widen
   * (an admin bypass, a support role) would widen this module with it. The
   * predicate is the one chat documents as load-bearing — the participant row IS
   * the grant — and there is deliberately no branch for an administrator.
   */
  async requireConversationAccess(
    ctx: ChatTaskReadContext,
    conversationId: string,
  ): Promise<ChatConversationAccess> {
    const participant = await ctx.em.findOne(
      ChatParticipant,
      scopedWhere(ctx.scope, { conversationId, userId: ctx.userId }),
    )
    if (!participant) throw notFound((await loadChatTasksMessages()).conversationNotFound)

    const conversation = await ctx.em.findOne(
      ChatConversation,
      scopedWhere(ctx.scope, { id: conversationId, deletedAt: null }),
    )
    if (!conversation) throw notFound((await loadChatTasksMessages()).conversationNotFound)

    return { conversation, participant }
  }

  async listConversationLinks(
    ctx: ChatTaskReadContext,
    conversationId: string,
    query: ChatTaskLinkListQuery,
  ): Promise<ChatTaskLinkListDto> {
    await this.requireConversationAccess(ctx, conversationId)

    /**
     * Only links explicitly recorded for THIS conversation.
     *
     * Never inferred from a shared assignee, a shared project or a text match: an
     * inferred link would show a reader a task nobody connected to their
     * conversation, and would do it because the two happen to name the same
     * person.
     */
    const links = await ctx.em.find(
      ChatTaskLink,
      scopedWhere(ctx.scope, { conversationId, deletedAt: null }),
      { orderBy: { createdAt: 'desc', id: 'desc' } },
    )

    /**
     * Two passes, and the split is what keeps the work bounded.
     *
     * The counts and the filters are about every link in the conversation, but
     * they only need each task's status and whether this reader may read it at
     * all — two columns. Building the full card for every link in order to return
     * twenty of them meant loading each one's project, assignees, role targets and
     * decrypted display names, so a conversation that had accumulated two hundred
     * linked tasks paid for two hundred of them on every panel open.
     *
     * So: statuses for all, cards for the page.
     */
    const statuses = await this.readableTaskStatuses(ctx, links.map((link) => link.taskId))
    const assignedIds = await this.assignedTaskIds(ctx)

    const decorated = links.map((link) => ({ link, status: statuses.get(link.taskId) ?? null }))

    const counts = {
      open: decorated.filter((row) => row.status !== null && !isTerminal(row.status)).length,
      completed: decorated.filter((row) => row.status !== null && isTerminal(row.status)).length,
      assignedToMe: decorated.filter((row) => row.status !== null && assignedIds.has(row.link.taskId))
        .length,
      /**
       * How many links this reader cannot resolve. A number, never a list: it
       * tells an honest "there is more here you cannot see" without saying what,
       * which is what keeps the panel from becoming a way to enumerate tasks.
       */
      unavailable: decorated.filter((row) => row.status === null).length,
    }

    const matches = decorated.filter((row) => {
      if (query.state === 'open' && (row.status === null || isTerminal(row.status))) return false
      if (query.state === 'completed' && (row.status === null || !isTerminal(row.status))) return false
      if (query.assignedToMe && (row.status === null || !assignedIds.has(row.link.taskId))) return false
      return true
    })

    // Keyset over the link rows rather than an offset: links are added while
    // someone is reading, and an offset page would repeat or skip a row when one
    // arrives above it.
    const cursor = decodeLinkCursor(query.cursor)
    const afterCursor = cursor
      ? matches.filter(
          (row) =>
            row.link.createdAt.getTime() < cursor.createdAt.getTime() ||
            (row.link.createdAt.getTime() === cursor.createdAt.getTime() && row.link.id < cursor.id),
        )
      : matches

    const page = afterCursor.slice(0, query.limit)
    const hasMore = afterCursor.length > page.length
    const last = page[page.length - 1]

    // The only hydration in this method, and it is capped by the validated page
    // size rather than by how much the conversation has accumulated.
    const hydrated = await this.hydrateTasks(ctx, page.map((row) => row.link.taskId))

    return {
      items: page.map((row) => toCardDto(row.link, hydrated.get(row.link.taskId) ?? null)),
      nextCursor: hasMore && last ? encodeLinkCursor({ createdAt: last.link.createdAt, id: last.link.id }) : null,
      hasMore,
      counts,
    }
  }

  /**
   * The cards for one page of a transcript.
   *
   * Two batched reads for the whole page — the links, then the tasks — for the
   * same reason chat loads reactions and attachments per page rather than per
   * message. Message ids the caller named that carry no card simply do not appear
   * in the result; the caller's own membership was proved before either read.
   */
  async cardsForMessages(
    ctx: ChatTaskReadContext,
    conversationId: string,
    messageIds: readonly string[],
  ): Promise<ChatTaskCardDto[]> {
    await this.requireConversationAccess(ctx, conversationId)
    if (messageIds.length === 0) return []

    const links = await ctx.em.find(
      ChatTaskLink,
      scopedWhere(ctx.scope, {
        conversationId,
        cardMessageId: { $in: [...new Set(messageIds)] },
        deletedAt: null,
      }),
    )
    if (links.length === 0) return []

    const hydrated = await this.hydrateTasks(ctx, links.map((link) => link.taskId))
    return links.map((link) => toCardDto(link, hydrated.get(link.taskId) ?? null))
  }

  async cardForLink(ctx: ChatTaskReadContext, linkId: string): Promise<ChatTaskCardDto> {
    const link = await ctx.em.findOne(ChatTaskLink, scopedWhere(ctx.scope, { id: linkId, deletedAt: null }))
    if (!link) throw notFound((await loadChatTasksMessages()).linkNotFound)
    await this.requireConversationAccess(ctx, link.conversationId)
    const hydrated = await this.hydrateTasks(ctx, [link.taskId])
    return toCardDto(link, hydrated.get(link.taskId) ?? null)
  }

  /**
   * Where a task was raised from — and only where this viewer may still look.
   *
   * The chat check runs per link and runs *here*, not at the task boundary the
   * caller came through. Somebody with every task grant in the organization sees
   * no sources for a task raised in a conversation they are not in, and is not
   * told that one exists: the rows are omitted, not marked hidden.
   */
  async sourcesForTask(ctx: ChatTaskReadContext, taskId: string): Promise<ChatTaskSourceListDto> {
    // The task itself has to be readable first. Without this, a guessed task id
    // would answer with the conversations it is linked to — which is a way to
    // learn that two people are talking.
    await this.requireReadableTask(ctx, taskId)

    const links = await ctx.em.find(
      ChatTaskLink,
      scopedWhere(ctx.scope, { taskId, deletedAt: null }),
      { orderBy: { createdAt: 'asc' } },
    )
    if (links.length === 0) return { items: [] }

    const conversationIds = [...new Set(links.map((link) => link.conversationId))]

    // One query for the reader's own participant rows across every candidate
    // conversation — membership NOW, not when the link was made.
    const myParticipations = await ctx.em.find(
      ChatParticipant,
      scopedWhere(ctx.scope, { conversationId: { $in: conversationIds }, userId: ctx.userId }),
    )
    const visibleConversationIds = new Set(myParticipations.map((row) => row.conversationId))
    if (visibleConversationIds.size === 0) return { items: [] }

    const conversations = await ctx.em.find(
      ChatConversation,
      scopedWhere(ctx.scope, { id: { $in: [...visibleConversationIds] }, deletedAt: null }),
    )
    const byId = new Map(conversations.map((row) => [row.id, row]))

    // A direct is named by the other person, so the roster is needed to title it.
    const counterparts = await this.counterpartNames(ctx, [...visibleConversationIds])

    // A recorded source message that has since been deleted, or that never
    // belonged to this conversation, is dropped rather than surfaced: a link to a
    // message that cannot be shown is worse than no link.
    const sourceMessageIds = links
      .map((link) => link.sourceMessageId)
      .filter((value): value is string => typeof value === 'string')
    const liveSourceIds = new Set<string>()
    if (sourceMessageIds.length > 0) {
      const rows = await ctx.em.find(
        ChatMessage,
        scopedWhere(ctx.scope, {
          id: { $in: [...new Set(sourceMessageIds)] },
          conversationId: { $in: [...visibleConversationIds] },
          deletedAt: null,
        }),
        { fields: ['id'] },
      )
      for (const row of rows) liveSourceIds.add(row.id)
    }

    const items: ChatTaskSourceDto[] = []
    for (const link of links) {
      const conversation = byId.get(link.conversationId)
      if (!conversation) continue
      items.push({
        linkId: link.id,
        conversationId: conversation.id,
        conversationTitle:
          conversation.kind === 'space'
            ? (conversation.title ?? '')
            : (counterparts.get(conversation.id) ?? ''),
        kind: conversation.kind,
        messageId:
          link.sourceMessageId && liveSourceIds.has(link.sourceMessageId) ? link.sourceMessageId : null,
        href: `/backend/chat/${conversation.id}`,
      })
    }
    return { items }
  }

  /**
   * Tasks this viewer may read, as cards.
   *
   * The grant check comes first and short-circuits the whole batch: a reader
   * without `tasks.view` gets an empty map, so every card and every panel row
   * renders as unavailable without a single task row being read. After that the
   * scope filter is the boundary — a task in another organization or another
   * tenant is simply not found, which is the same answer a guessed id gets.
   */
  async hydrateTasks(
    ctx: ChatTaskReadContext,
    taskIds: readonly string[],
  ): Promise<Map<string, ChatTaskCardTaskDto>> {
    const result = new Map<string, ChatTaskCardTaskDto>()
    const unique = [...new Set(taskIds.filter((id) => typeof id === 'string' && id.length > 0))]
    if (unique.length === 0) return result

    const canView = await callerHasFeatures(ctx.container, ctx.userId, ctx.scope, ['tasks.view'])
    if (!canView) return result
    const canEdit = await callerHasFeatures(ctx.container, ctx.userId, ctx.scope, ['tasks.edit'])

    const tasks = await ctx.em.find(
      TasksTask,
      scopedWhere(ctx.scope, { id: { $in: unique }, deletedAt: null }),
    )
    if (tasks.length === 0) return result

    // An archived project is still readable in the tasks module, so a card for a
    // task inside one stays readable too — what it must not do is claim the
    // project is live. The project row is loaded for its key and name only.
    const projects = await ctx.em.find(
      TasksProject,
      scopedWhere(ctx.scope, { id: { $in: [...new Set(tasks.map((task) => task.projectId))] } }),
    )
    const projectById = new Map(projects.map((project) => [project.id, project]))

    const taskIdList = tasks.map((task) => task.id)
    const [assignees, targets] = await Promise.all([
      ctx.em.find(TasksTaskAssignee, scopedWhere(ctx.scope, { taskId: { $in: taskIdList } })),
      ctx.em.find(TasksTaskAssignmentTarget, scopedWhere(ctx.scope, { taskId: { $in: taskIdList } })),
    ])

    const assigneeIdsByTask = new Map<string, string[]>()
    for (const row of assignees) {
      const list = assigneeIdsByTask.get(row.taskId) ?? []
      list.push(row.userId)
      assigneeIdsByTask.set(row.taskId, list)
    }
    const targetCountByTask = new Map<string, number>()
    for (const row of targets) {
      targetCountByTask.set(row.taskId, (targetCountByTask.get(row.taskId) ?? 0) + 1)
    }

    // Names resolved through the active-member predicate, so a departed
    // colleague's name is not reproduced on a card that outlived their account.
    const people = await loadOrganizationMembers(
      ctx.em,
      ctx.scope,
      [...assigneeIdsByTask.values()].flat(),
    )

    for (const task of tasks) {
      const project = projectById.get(task.projectId)
      const assigneeIds = assigneeIdsByTask.get(task.id) ?? []
      result.set(task.id, {
        id: task.id,
        reference: project ? `${project.key}-${task.number}` : String(task.number),
        title: task.title,
        status: task.status,
        priority: task.priority as ChatTaskCardTaskDto['priority'],
        dueDate: isoDate(task.dueDate),
        dueTime: task.dueTime ?? null,
        recurrence: toRecurrenceDto(task),
        assignees: assigneeIds
          .map((id) => {
            const person = people.get(id)
            return person ? { id, name: person.name } : null
          })
          .filter((entry): entry is { id: string; name: string } => entry !== null),
        assignmentTargetCount: targetCountByTask.get(task.id) ?? 0,
        projectId: task.projectId,
        projectName: project?.name ?? '',
        updatedAt: (task.updatedAt ?? task.createdAt).toISOString(),
        canEdit,
        href: taskHref(task.projectId, task.id),
      })
    }
    return result
  }

  async requireReadableTask(ctx: ChatTaskReadContext, taskId: string): Promise<ChatTaskCardTaskDto> {
    const hydrated = await this.hydrateTasks(ctx, [taskId])
    const task = hydrated.get(taskId)
    // The same 404 for "no such task", "another tenant's task" and "you lack the
    // grant". Distinguishing them tells a prober which of the three it was.
    if (!task) throw notFound((await loadChatTasksMessages()).taskNotFound)
    return task
  }

  /**
   * Status per readable task, for the links in a conversation.
   *
   * The cheap half of `hydrateTasks`: the same grant gate and the same scope
   * boundary, selecting two columns and joining nothing. A task missing from the
   * result is one this reader may not read — which is exactly the signal the
   * counts and the filters need, and all they need.
   */
  private async readableTaskStatuses(
    ctx: ChatTaskReadContext,
    taskIds: readonly string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>()
    const unique = [...new Set(taskIds.filter((id) => typeof id === 'string' && id.length > 0))]
    if (unique.length === 0) return result

    const canView = await callerHasFeatures(ctx.container, ctx.userId, ctx.scope, ['tasks.view'])
    if (!canView) return result

    const rows = await ctx.em.find(
      TasksTask,
      scopedWhere(ctx.scope, { id: { $in: unique }, deletedAt: null }),
      { fields: ['id', 'status'] },
    )
    for (const row of rows) result.set(row.id, row.status)
    return result
  }

  /** Task ids assigned to this viewer, through a person row or one of their roles. */
  private async assignedTaskIds(ctx: ChatTaskReadContext): Promise<Set<string>> {
    // The tasks module's own resolver, so role-based assignment behaves here
    // exactly as it does in "Assigned to me" — including a role someone was added
    // to this morning.
    const ids = await loadAssignedTaskIds(ctx.em, ctx.scope, ctx.userId)
    return new Set(ids)
  }

  /** The other person's display name, per direct conversation. */
  private async counterpartNames(
    ctx: ChatTaskReadContext,
    conversationIds: readonly string[],
  ): Promise<Map<string, string>> {
    const rows = await ctx.em.find(
      ChatParticipant,
      scopedWhere(ctx.scope, { conversationId: { $in: [...conversationIds] } }),
    )
    const others = rows.filter((row) => row.userId !== ctx.userId)
    const people = await loadOrganizationMembers(ctx.em, ctx.scope, others.map((row) => row.userId))
    const byConversation = new Map<string, string>()
    for (const row of others) {
      if (byConversation.has(row.conversationId)) continue
      const person = people.get(row.userId)
      if (person) byConversation.set(row.conversationId, person.name)
    }
    return byConversation
  }
}

function isTerminal(status: string): boolean {
  return (TASK_TERMINAL_STATUSES as readonly string[]).includes(status)
}

/**
 * A card, with the task or without it — and never with half of it.
 *
 * `available: false` carries the link id and nothing else. The link id is the
 * module's own identifier and says only "something is linked here", which the
 * reader can already see from the row being rendered at all.
 */
function toCardDto(link: ChatTaskLink, task: ChatTaskCardTaskDto | null): ChatTaskCardDto {
  return {
    linkId: link.id,
    cardMessageId: link.cardMessageId ?? null,
    available: task !== null,
    task,
  }
}

function toRecurrenceDto(task: TasksTask): TaskRecurrenceDto | null {
  if (!task.recurrenceFreq) return null
  return {
    freq: task.recurrenceFreq,
    weekday: task.recurrenceWeekday ?? null,
    dayOfMonth: task.recurrenceDayOfMonth ?? null,
  }
}
