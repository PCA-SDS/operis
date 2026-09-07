import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { badRequest, isUniqueViolation, notFound } from '@open-mercato/shared/lib/crud/errors'
import { ChatConversation, ChatMessage, ChatMessageTranslation, ChatParticipant } from '../data/entities'
import type { ChatParticipantRole, ChatSystemEvent } from '../data/entities'
import { dbNow } from '../lib/clock'
import { loadChatMessages } from '../lib/messages'
import { loadOrganizationMember, loadOrganizationMembers, type ChatScope } from '../lib/scope'
import { countOwners, loadSpaceForMember, loadSpaceForOwner } from '../lib/spaces'
import {
  actingUserId,
  conversationAudience,
  emitConversationEvent,
  ensureOrganizationScope,
  ensureTenantScope,
  forkEm,
} from './shared'

export type CreateSpaceInput = {
  tenantId: string
  organizationId: string
  title: string
  memberIds?: string[]
}

export type RenameSpaceInput = {
  tenantId: string
  organizationId: string
  conversationId: string
  title: string
}

export type AddSpaceMembersInput = {
  tenantId: string
  organizationId: string
  conversationId: string
  memberIds: string[]
}

export type RemoveSpaceMemberInput = {
  tenantId: string
  organizationId: string
  conversationId: string
  userId: string
}

export type SetSpaceMemberRoleInput = {
  tenantId: string
  organizationId: string
  conversationId: string
  userId: string
  role: ChatParticipantRole
}

/**
 * Append a membership event to the transcript.
 *
 * A real row with `kind: 'system'`, not a message posted as the actor — so it
 * cannot be mistaken for something they typed, it is excluded from unread
 * counting, and the sentence is assembled from translations and current display
 * names at render time rather than frozen into English text at write time.
 *
 * It shares the conversation's `last_message_at` bump, because "Alice added Bob"
 * is exactly the kind of change that should raise a space in the list.
 */
async function appendSystemMessage(
  tx: EntityManager,
  scope: ChatScope,
  options: {
    conversationId: string
    actorUserId: string
    event: ChatSystemEvent
    targetUserId?: string | null
    body?: string
    now: Date
  },
): Promise<ChatMessage> {
  const message = tx.create(ChatMessage, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    conversationId: options.conversationId,
    senderUserId: options.actorUserId,
    kind: 'system',
    systemEvent: options.event,
    systemTargetUserId: options.targetUserId ?? null,
    // Empty for membership events: their sentence is rendered, not stored. A
    // rename keeps the new title here, because that IS content.
    body: options.body ?? '',
    createdAt: options.now,
    updatedAt: options.now,
  })
  tx.persist(message)
  return message
}

/** The denormalized "latest" columns, kept in step with whatever was just appended. */
function bumpConversation(
  conversation: ChatConversation,
  now: Date,
  preview: string,
  senderUserId: string,
): void {
  conversation.lastMessageAt = now
  conversation.lastMessagePreview = preview
  conversation.lastMessageSenderUserId = senderUserId
}

/**
 * Create a space and seat its first members.
 *
 * The creator becomes `owner`, and is added whether or not they appear in
 * `memberIds` — a space with no owner would have nobody able to manage it, and
 * one the creator cannot see would be created into the void.
 *
 * Every id in `memberIds` is checked against the same active-organization-member
 * predicate direct conversations use, and the check is applied to the creator
 * too: an operator scoped into an organization they do not belong to cannot
 * create a space inside it. Unknown ids are refused as a batch rather than
 * silently dropped, so "add these four" never quietly means "added three".
 */
const createSpaceCommand: CommandHandler<CreateSpaceInput, { conversationId: string }> = {
  id: 'chat.spaces.create',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const messages = await loadChatMessages()
    const scope: ChatScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const creatorUserId = await actingUserId(ctx)
    const em = forkEm(ctx)

    const creator = await loadOrganizationMember(em, scope, creatorUserId)
    if (!creator) throw badRequest(messages.notOrganizationMember)

    const requested = [...new Set(input.memberIds ?? [])].filter((id) => id !== creatorUserId)
    const members = await loadOrganizationMembers(em, scope, requested)
    // One id that is not an active colleague fails the whole request. The
    // message is the same whether the user does not exist, belongs to another
    // organization or has been deactivated — so this cannot be used to find out
    // which.
    if (members.size !== requested.length) throw badRequest(messages.memberNotFound)

    const conversationId = await em.transactional(async (tx) => {
      const now = await dbNow(tx)
      const conversation = tx.create(ChatConversation, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        kind: 'space',
        title: input.title,
        createdByUserId: creatorUserId,
        lastMessageAt: now,
        createdAt: now,
        updatedAt: now,
      })
      tx.persist(conversation)
      await tx.flush()

      tx.persist(
        tx.create(ChatParticipant, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          conversationId: conversation.id,
          userId: creatorUserId,
          role: 'owner',
          createdAt: now,
          updatedAt: now,
        }),
      )
      for (const userId of requested) {
        tx.persist(
          tx.create(ChatParticipant, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            conversationId: conversation.id,
            userId,
            role: 'member',
            createdAt: now,
            updatedAt: now,
          }),
        )
      }
      await tx.flush()
      return conversation.id
    })

    await emitConversationEvent(
      'chat.conversation.created',
      scope,
      [creatorUserId, ...requested],
      { conversationId },
    )

    return { conversationId }
  },
}

/**
 * Rename a space.
 *
 * Owners only, and a no-op rename returns without writing — so pressing Save on
 * an unchanged field does not post a system message or bump the space to the top
 * of everyone's list.
 */
const renameSpaceCommand: CommandHandler<RenameSpaceInput, { title: string }> = {
  id: 'chat.spaces.rename',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const scope: ChatScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const actorUserId = await actingUserId(ctx)
    const em = forkEm(ctx)

    const { conversation } = await loadSpaceForOwner(em, scope, input.conversationId, actorUserId)
    if (conversation.title === input.title) return { title: input.title }

    await em.transactional(async (tx) => {
      const now = await dbNow(tx)
      const target = await tx.findOne(ChatConversation, {
        id: input.conversationId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
      if (!target) throw notFound((await loadChatMessages()).conversationNotFound)

      target.title = input.title
      await appendSystemMessage(tx, scope, {
        conversationId: target.id,
        actorUserId,
        event: 'space_renamed',
        body: input.title,
        now,
      })
      bumpConversation(target, now, input.title, actorUserId)
      await tx.flush()
    })

    const recipients = await conversationAudience(forkEm(ctx), scope, input.conversationId)
    await emitConversationEvent('chat.conversation.updated', scope, recipients, {
      conversationId: input.conversationId,
      change: 'renamed',
    })

    return { title: input.title }
  },
}

/**
 * Add people to a space.
 *
 * Owners only. Ids already in the space are dropped rather than refused: two
 * owners adding the same person at once, or a double-clicked button, should
 * converge on "they are in" instead of one of them erroring. Everything that
 * actually gets added is validated against the organization first, so a forged
 * id from another tenant is refused before any row is written.
 */
const addSpaceMembersCommand: CommandHandler<AddSpaceMembersInput, { added: string[] }> = {
  id: 'chat.spaces.addMembers',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const messages = await loadChatMessages()
    const scope: ChatScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const actorUserId = await actingUserId(ctx)
    const em = forkEm(ctx)

    await loadSpaceForOwner(em, scope, input.conversationId, actorUserId)

    const requested = [...new Set(input.memberIds)]
    const members = await loadOrganizationMembers(em, scope, requested)
    if (members.size !== requested.length) throw badRequest(messages.memberNotFound)

    /** Which of the requested people are not in the space yet, read fresh. */
    const stillMissing = async (candidates: readonly string[]): Promise<string[]> => {
      if (candidates.length === 0) return []
      const rows = await forkEm(ctx).find(ChatParticipant, {
        conversationId: input.conversationId,
        userId: { $in: [...candidates] },
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      const present = new Set(rows.map((participant) => participant.userId))
      return candidates.filter((userId) => !present.has(userId))
    }

    /** Seat these people and record it. One transaction, all or nothing. */
    const seat = async (userIds: readonly string[]): Promise<void> => {
      await forkEm(ctx).transactional(async (tx) => {
        const now = await dbNow(tx)
        const target = await tx.findOne(ChatConversation, {
          id: input.conversationId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        })
        if (!target) throw notFound(messages.conversationNotFound)

        for (const userId of userIds) {
          tx.persist(
            tx.create(ChatParticipant, {
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
              conversationId: target.id,
              userId,
              role: 'member',
              createdAt: now,
              updatedAt: now,
            }),
          )
          await appendSystemMessage(tx, scope, {
            conversationId: target.id,
            actorUserId,
            event: 'member_added',
            targetUserId: userId,
            now,
          })
        }
        // The preview is a display name rather than a rendered sentence: the list
        // row has no room for one, and the name is the useful half.
        const lastName = members.get(userIds[userIds.length - 1]!)?.name ?? ''
        bumpConversation(target, now, lastName, actorUserId)
        await tx.flush()
      })
    }

    /**
     * Adding is idempotent under concurrency, and the unique index is what makes
     * that safe rather than the read above.
     *
     * Two owners pressing "Add" on the same person at the same moment both see
     * them missing, and both insert. `chat_participants_conversation_user_uq`
     * rejects the loser with a 23505 — which, unhandled, surfaced as a 500 to
     * one of two people who each did something perfectly reasonable. Measured:
     * six parallel adds of one person produced 500s while the membership stayed
     * correct at one row, so the database was right and only the response was
     * wrong.
     *
     * On a violation the state is re-read and whatever is genuinely still
     * missing is seated. A second violation means the other writer finished the
     * job in between, which is success — the requested people are members, and
     * this call simply added none of them.
     */
    let added = await stillMissing(requested)
    if (added.length === 0) return { added: [] }

    try {
      await seat(added)
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      added = await stillMissing(added)
      if (added.length > 0) {
        try {
          await seat(added)
        } catch (retryError) {
          if (!isUniqueViolation(retryError)) throw retryError
          added = []
        }
      }
    }

    // Recomputed after the write, so the people just added are in it and receive
    // the frame that tells their client to pick the space up. Emitted even when
    // this call added nobody: the concurrent winner's own emit may have raced
    // ahead of its own commit, and a second pointer costs one refetch.
    const recipients = await conversationAudience(forkEm(ctx), scope, input.conversationId)
    await emitConversationEvent('chat.conversation.updated', scope, recipients, {
      conversationId: input.conversationId,
      change: 'members_added',
    })

    return { added }
  },
}

/**
 * Remove someone from a space, or leave it yourself.
 *
 * One command for both, because they are the same write with different
 * authorization: removing another person needs ownership, removing yourself
 * never does. Splitting them would have duplicated the last-owner rule and the
 * event fan-out.
 *
 * Deleting the participant row is the whole revocation — read access, unread
 * state and realtime delivery all hang off it, and the SSE audience is
 * recomputed from these rows on every emit, so there is no interval during which
 * a removed member still receives messages. Their own messages stay: they are
 * rows in `chat_messages` that no membership check touches.
 */
const removeSpaceMemberCommand: CommandHandler<
  RemoveSpaceMemberInput,
  { removed: string; spaceDeleted: boolean }
> = {
  id: 'chat.spaces.removeMember',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const messages = await loadChatMessages()
    const scope: ChatScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const actorUserId = await actingUserId(ctx)
    const em = forkEm(ctx)

    const leaving = input.userId === actorUserId
    const { conversation } = leaving
      ? await loadSpaceForMember(em, scope, input.conversationId, actorUserId)
      : await loadSpaceForOwner(em, scope, input.conversationId, actorUserId)

    const target = await em.findOne(ChatParticipant, {
      conversationId: conversation.id,
      userId: input.userId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    if (!target) throw notFound(messages.memberNotInSpace)

    const memberCount = await em.count(ChatParticipant, {
      conversationId: conversation.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    const lastPersonInSpace = memberCount === 1

    // A space must never be left without an owner. The exception is the owner
    // who is also the last person in it — there is nobody to promote, and
    // refusing would strand them in a space they cannot leave, which is the dead
    // end this rule exists to avoid. That case takes the space with them.
    if (target.role === 'owner' && !lastPersonInSpace) {
      const owners = await countOwners(em, scope, conversation.id)
      if (owners <= 1) {
        throw badRequest(leaving ? messages.lastOwnerCannotLeave : messages.lastOwnerCannotStepDown)
      }
    }

    // Captured before the delete: the removed person must receive the frame that
    // tells their client to drop the space, and after the write they are no
    // longer in the audience.
    const recipients = await conversationAudience(em, scope, conversation.id)

    await em.transactional(async (tx) => {
      const now = await dbNow(tx)
      const row = await tx.findOne(ChatParticipant, {
        conversationId: conversation.id,
        userId: input.userId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      if (!row) throw notFound(messages.memberNotInSpace)
      tx.remove(row)

      const space = await tx.findOne(ChatConversation, {
        id: conversation.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
      if (!space) throw notFound(messages.conversationNotFound)

      if (lastPersonInSpace) {
        // Nobody is left to read it. Soft-deleted rather than dropped, so the
        // message rows stay addressable for audit and the transcript is not
        // rewritten by someone walking out of it.
        space.deletedAt = now
        // The cache does not survive it. A translation is a second, plainer
        // copy of a message body, and the foreign key's ON DELETE CASCADE only
        // fires on a hard delete — so without this every translated message in
        // a closed conversation stays readable text in a table no erasure path
        // knows about, for messages nobody can reach any more.
        await tx.nativeDelete(ChatMessageTranslation, {
          conversationId: space.id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        })
      } else {
        await appendSystemMessage(tx, scope, {
          conversationId: space.id,
          actorUserId,
          event: leaving ? 'member_left' : 'member_removed',
          targetUserId: input.userId,
          now,
        })
        bumpConversation(space, now, '', actorUserId)
      }
      await tx.flush()
    })

    await emitConversationEvent('chat.conversation.updated', scope, recipients, {
      conversationId: conversation.id,
      change: leaving ? 'member_left' : 'member_removed',
    })

    return { removed: input.userId, spaceDeleted: lastPersonInSpace }
  },
}

/**
 * Promote a member to owner, or step one back down.
 *
 * The promotion half is what keeps "the last owner cannot leave" from being a
 * dead end: there is always a way to create the second owner the rule asks for.
 * The demotion half is guarded by the same owner count, so a space cannot be
 * left ownerless through the back door of everyone demoting themselves.
 */
const setSpaceMemberRoleCommand: CommandHandler<
  SetSpaceMemberRoleInput,
  { userId: string; role: ChatParticipantRole }
> = {
  id: 'chat.spaces.setMemberRole',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const messages = await loadChatMessages()
    const scope: ChatScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const actorUserId = await actingUserId(ctx)
    const em = forkEm(ctx)

    const { conversation } = await loadSpaceForOwner(em, scope, input.conversationId, actorUserId)

    const target = await em.findOne(ChatParticipant, {
      conversationId: conversation.id,
      userId: input.userId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    if (!target) throw notFound(messages.memberNotInSpace)
    if (target.role === input.role) return { userId: input.userId, role: input.role }

    if (input.role === 'member') {
      const owners = await countOwners(em, scope, conversation.id)
      if (owners <= 1) throw badRequest(messages.lastOwnerCannotStepDown)
    }

    target.role = input.role
    await em.flush()

    const recipients = await conversationAudience(em, scope, conversation.id)
    await emitConversationEvent('chat.conversation.updated', scope, recipients, {
      conversationId: conversation.id,
      change: 'role_changed',
    })

    return { userId: input.userId, role: input.role }
  },
}

registerCommand(createSpaceCommand)
registerCommand(renameSpaceCommand)
registerCommand(addSpaceMembersCommand)
registerCommand(removeSpaceMemberCommand)
registerCommand(setSpaceMemberRoleCommand)
