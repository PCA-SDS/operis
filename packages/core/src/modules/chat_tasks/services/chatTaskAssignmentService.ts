import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { ChatParticipant } from '@open-mercato/core/modules/chat/data/entities'
import { loadOrganizationMembers } from '@open-mercato/core/modules/chat/lib/scope'
import { filterScopedUserIds } from '@open-mercato/core/modules/tasks/lib/assignment'
import type { ProjectService } from '@open-mercato/core/modules/tasks/services/projectService'
import type { ChatTaskComposerContextDto } from '../data/types'
import { loadChatTasksMessages } from '../lib/messages'
import { callerHasFeatures, scopedWhere, type ChatTasksScope } from '../lib/scope'
import type { ChatTaskReadContext, ChatTaskService } from './chatTaskService'

/**
 * Who a task raised from a conversation is for.
 *
 * The whole point of this service is that chat membership answers *none* of it.
 * Being in a conversation with somebody says they are a colleague; it does not say
 * they can be handed work, that this organization can assign to them, or that the
 * caller is allowed to assign at all. Each of those is asked separately, of the
 * module that owns the answer, and every one of them is asked again at write time
 * — this service only decides what to *offer*.
 */
export interface ChatTaskAssignmentService {
  composerContext(
    ctx: ChatTaskReadContext,
    conversationId: string,
  ): Promise<ChatTaskComposerContextDto>
  /**
   * The assignee list a write should actually use, or a refusal.
   *
   * Called by the command, not just by the UI: a client that omits the assignee in
   * a space, or names somebody who is not assignable, must be refused by the
   * server even though the composer would not have let them.
   */
  resolveAssignees(
    ctx: ChatTaskReadContext,
    input: {
      conversationId: string | null
      requestedAssigneeIds: readonly string[] | undefined
      requestedRoleTargets: number
    },
  ): Promise<string[]>
}

export class DefaultChatTaskAssignmentService implements ChatTaskAssignmentService {
  constructor(private readonly chatTasks: ChatTaskService) {}

  async composerContext(
    ctx: ChatTaskReadContext,
    conversationId: string,
  ): Promise<ChatTaskComposerContextDto> {
    const { conversation } = await this.chatTasks.requireConversationAccess(ctx, conversationId)

    const [canCreate, canAssign] = await Promise.all([
      callerHasFeatures(ctx.container, ctx.userId, ctx.scope, ['tasks.create']),
      callerHasFeatures(ctx.container, ctx.userId, ctx.scope, ['tasks.assign']),
    ])

    const participants = await ctx.em.find(
      ChatParticipant,
      scopedWhere(ctx.scope, { conversationId }),
    )
    const otherIds = participants.map((row) => row.userId).filter((id) => id !== ctx.userId)

    // Two different questions about the same people, and both matter:
    //  - are they still an active member of this organization (chat's predicate)?
    //  - may a task be assigned to them (the tasks module's predicate)?
    // A colleague can pass the first and fail the second, and the message the user
    // sees has to say which.
    const [activeMembers, assignable] = await Promise.all([
      loadOrganizationMembers(ctx.em, ctx.scope, otherIds),
      this.assignableIds(ctx, otherIds),
    ])

    const inbox = await this.inboxProjectId(ctx)

    if (conversation.kind === 'direct') {
      // A direct has exactly two people, so "the other one" is unambiguous — and
      // it is read from the participant rows the server holds, never from a
      // counterpart id the client offered.
      const counterpartId = otherIds[0] ?? null
      const active = counterpartId ? activeMembers.get(counterpartId) : undefined

      if (!counterpartId || !active) {
        return {
          conversationId,
          kind: 'direct',
          defaultAssignee: null,
          defaultAssigneeBlockedReason: counterpartId ? 'inactive' : null,
          requiresExplicitAssignee: true,
          suggestedAssignees: [],
          inboxProjectId: inbox,
          canCreate,
          canAssign,
        }
      }

      if (!assignable.has(counterpartId)) {
        return {
          conversationId,
          kind: 'direct',
          defaultAssignee: null,
          defaultAssigneeBlockedReason: 'not_assignable',
          requiresExplicitAssignee: true,
          suggestedAssignees: [],
          inboxProjectId: inbox,
          canCreate,
          canAssign,
        }
      }

      return {
        conversationId,
        kind: 'direct',
        defaultAssignee: { id: counterpartId, name: active.name },
        defaultAssigneeBlockedReason: null,
        requiresExplicitAssignee: false,
        suggestedAssignees: [{ id: counterpartId, name: active.name }],
        inboxProjectId: inbox,
        canCreate,
        canAssign,
      }
    }

    /**
     * A space has no default, deliberately.
     *
     * "Everyone here" is not an assignee — a task addressed to a room is a task
     * nobody owns, and expanding `@everyone` into a list of assignees would hand
     * the same piece of work to twelve people and notify all of them. The
     * participants who are also assignable are offered as the first suggestions
     * and one of them must be chosen.
     */
    const suggested = otherIds
      .filter((id) => assignable.has(id))
      .map((id) => {
        const person = activeMembers.get(id)
        return person ? { id, name: person.name } : null
      })
      .filter((entry): entry is { id: string; name: string } => entry !== null)

    return {
      conversationId,
      kind: 'space',
      defaultAssignee: null,
      defaultAssigneeBlockedReason: null,
      requiresExplicitAssignee: true,
      suggestedAssignees: suggested,
      inboxProjectId: inbox,
      canCreate,
      canAssign,
    }
  }

  async resolveAssignees(
    ctx: ChatTaskReadContext,
    input: {
      conversationId: string | null
      requestedAssigneeIds: readonly string[] | undefined
      requestedRoleTargets: number
    },
  ): Promise<string[]> {
    const messages = await loadChatTasksMessages()
    const requested = [...new Set(input.requestedAssigneeIds ?? [])]

    // Assigning to somebody else needs the grant, whoever they are and however
    // the composer defaulted. Assigning to yourself does not — that is what makes
    // the personal workspace usable by an employee who may create but not assign.
    const assigningOthers = requested.some((id) => id !== ctx.userId) || input.requestedRoleTargets > 0
    if (assigningOthers) {
      const canAssign = await callerHasFeatures(ctx.container, ctx.userId, ctx.scope, ['tasks.assign'])
      if (!canAssign) throw badRequest(messages.cannotAssignTasks)
    }

    /**
     * No conversation means the personal workspace: the caller is the assignee.
     *
     * The self-assign is a *default*, so it only applies when the request named
     * nobody at all — role targets included. Testing the explicit id list alone
     * assigned the caller alongside a role audience they had deliberately chosen,
     * which is the one thing a default must never do.
     */
    if (input.conversationId === null) {
      if (requested.length > 0 || input.requestedRoleTargets > 0) return requested
      return [ctx.userId]
    }

    const { conversation } = await this.chatTasks.requireConversationAccess(ctx, input.conversationId)

    if (requested.length === 0 && input.requestedRoleTargets === 0) {
      if (conversation.kind === 'space') throw badRequest(messages.assigneeRequired)

      // A direct with no explicit assignee defaults to the counterpart — resolved
      // here, from the server's own participant rows, for the same reason the
      // composer context does: a client-supplied counterpart id would be a way to
      // assign work to anybody by naming them.
      const context = await this.composerContext(ctx, input.conversationId)
      if (!context.defaultAssignee) {
        throw badRequest(
          context.defaultAssigneeBlockedReason === 'not_assignable'
            ? messages.counterpartNotAssignable
            : messages.counterpartInactive,
        )
      }
      // Assigning to the counterpart IS assigning to somebody else, so the grant
      // is required even though the client named nobody.
      const canAssign = await callerHasFeatures(ctx.container, ctx.userId, ctx.scope, ['tasks.assign'])
      if (!canAssign) throw badRequest(messages.cannotAssignTasks)
      return [context.defaultAssignee.id]
    }

    /**
     * An explicitly named assignee is allowed to be someone outside this
     * conversation.
     *
     * The suggestions come from the room because that is what is useful, but the
     * boundary is the tasks module's own assignment policy, not the roster —
     * somebody has to be able to raise a task for a colleague the conversation
     * does not include. The scope check that refuses another tenant's user runs
     * inside `tasks.tasks.create`, which is where it belongs.
     */
    return requested
  }

  /**
   * Which of these candidates the tasks module considers assignable.
   *
   * Asked about the conversation's participants specifically, rather than by
   * listing every assignable user and testing membership: `listScopedUsers` reads
   * and decrypts every user row in the organization, and this only ever needs an
   * answer about the handful of people in the room. Same predicate either way —
   * it is the tasks module's own, shared with the check that runs at write time.
   */
  private async assignableIds(
    ctx: ChatTaskReadContext,
    candidateIds: readonly string[],
  ): Promise<Set<string>> {
    return filterScopedUserIds(ctx.em, ctx.scope, candidateIds)
  }

  /** The scope's Inbox, created on first need exactly as Quick Add does. */
  private async inboxProjectId(ctx: ChatTaskReadContext): Promise<string> {
    const service = ctx.container.resolve('tasksProjectService') as ProjectService
    const inbox = await service.ensureInbox(ctx.em, ctx.scope)
    return inbox.id
  }
}

/** Keeps the EM type referenced so a future signature change is caught here too. */
export type ChatTaskAssignmentEm = EntityManager
/** Same, for the container. */
export type ChatTaskAssignmentContainer = AwilixContainer
/** Same, for the scope. */
export type ChatTaskAssignmentScope = ChatTasksScope
