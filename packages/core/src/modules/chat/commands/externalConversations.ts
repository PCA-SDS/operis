import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { badRequest, forbidden, isUniqueViolation, notFound } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  ChatConversation,
  ChatExternalContact,
  ChatParticipant,
  MAX_SPACE_TITLE_LENGTH,
} from '../data/entities'
import { dbNow } from '../lib/clock'
import { loadChatMessages } from '../lib/messages'
import { loadParticipant, requireIdentityId } from '../lib/participants'
import { loadOrganizationMembers, type ChatScope } from '../lib/scope'
import {
  conversationAudience,
  emitConversationEvent,
  ensureOrganizationScope,
  ensureTenantScope,
  forkEm,
} from './shared'

/**
 * External conversations: the only place an outsider can be a participant.
 *
 * Nothing here is reachable from a browser. An external conversation is born
 * from a room a bridge created — linked by an operator today, adopted by the
 * bridge later — and its outsiders arrive through the transport's projector.
 * So every command below refuses a context with a logged-in user: a route that
 * ever called one would be a way for a person to open a conversation to a
 * customer, which is exactly the decision these conversations take away from
 * the browser.
 */

const NETWORK_PATTERN = /^[a-z][a-z0-9-]{0,31}$/
const MAX_CONTACT_NAME_LENGTH = 200

function requireSystemContext(ctx: CommandRuntimeContext): void {
  if (typeof ctx.auth?.sub === 'string' && ctx.auth.sub.length > 0) {
    throw forbidden('[internal] external conversations are managed by the transport, not by a user')
  }
}

function scopeOf(input: { tenantId: string; organizationId: string }): ChatScope {
  return { tenantId: input.tenantId, organizationId: input.organizationId }
}

export type EnsureExternalContactInput = {
  tenantId: string
  organizationId: string
  /**
   * Supplied by the transport, and deterministic there. Find-or-create is then
   * an insert that converges: two projections of the same newcomer, by push
   * and by poll at once, land on one row instead of racing into two.
   */
  id: string
  /** A label such as `whatsapp` — lowercase, no spaces. */
  network: string
  displayName: string
}

export type EnsureExternalContactResult = { id: string; created: boolean }

/**
 * Record an outsider, or refresh their name. Writes only when something
 * changed, so a projection per message costs a read, not a write.
 */
const ensureExternalContactCommand: CommandHandler<EnsureExternalContactInput, EnsureExternalContactResult> = {
  id: 'chat.externalContacts.ensure',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    requireSystemContext(ctx)

    const id = requireIdentityId(input.id)
    if (!NETWORK_PATTERN.test(input.network)) {
      throw badRequest('[internal] an external contact network is a lowercase label')
    }
    const displayName = input.displayName.trim().slice(0, MAX_CONTACT_NAME_LENGTH)
    if (displayName.length === 0) throw badRequest('[internal] an external contact needs a display name')

    const scope = scopeOf(input)
    const where = { id, tenantId: scope.tenantId, organizationId: scope.organizationId }
    const em = forkEm(ctx)

    const existing = await findOneWithDecryption(em, ChatExternalContact, where, {}, scope)
    if (existing) {
      if (existing.displayName !== displayName || existing.network !== input.network) {
        existing.displayName = displayName
        existing.network = input.network
        await em.flush()
      }
      return { id, created: false }
    }

    try {
      const now = await dbNow(em)
      em.persist(
        em.create(ChatExternalContact, {
          ...where,
          network: input.network,
          displayName,
          createdAt: now,
          updatedAt: now,
        }),
      )
      await em.flush()
      return { id, created: true }
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      // Lost a race to an identical insert — or the id belongs to another
      // organization's contact, which this scope can never read or reuse.
      const winner = await findOneWithDecryption(forkEm(ctx), ChatExternalContact, where, {}, scope)
      if (!winner) throw error
      return { id, created: false }
    }
  },
}

export type CreateExternalConversationInput = {
  tenantId: string
  organizationId: string
  /** A group's name. A one-to-one conversation leaves it empty and is named after its contact. */
  title?: string | null
  externalContactIds: string[]
  /** The colleagues who handle it. At least one: a conversation nobody inside can read is a black hole. */
  memberUserIds: string[]
}

export type CreateExternalConversationResult = { conversationId: string }

const createExternalConversationCommand: CommandHandler<
  CreateExternalConversationInput,
  CreateExternalConversationResult
> = {
  id: 'chat.conversations.createExternal',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    requireSystemContext(ctx)

    const scope = scopeOf(input)
    const contactIds = [...new Set(input.externalContactIds.map((id) => requireIdentityId(id)))]
    const memberUserIds = [...new Set(input.memberUserIds.map((id) => requireIdentityId(id)))]
    if (contactIds.length === 0) throw badRequest('[internal] an external conversation needs an external contact')
    if (memberUserIds.length === 0) throw badRequest('[internal] an external conversation needs a colleague')

    const title = input.title?.trim().slice(0, MAX_SPACE_TITLE_LENGTH) || null
    const em = forkEm(ctx)

    const contacts = await findWithDecryption(
      em,
      ChatExternalContact,
      { id: { $in: contactIds }, tenantId: scope.tenantId, organizationId: scope.organizationId },
      {},
      scope,
    )
    if (contacts.length !== contactIds.length) {
      throw notFound('[internal] an external contact is not known to this organization')
    }
    const members = await loadOrganizationMembers(em, scope, memberUserIds)
    if (members.size !== memberUserIds.length) {
      throw badRequest('[internal] every colleague in an external conversation must be an active organization member')
    }

    const conversationId = await em.transactional(async (tx) => {
      const now = await dbNow(tx)
      const conversation = tx.create(ChatConversation, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        kind: 'external',
        title,
        lastMessageAt: now,
        createdAt: now,
        updatedAt: now,
      })
      tx.persist(conversation)
      await tx.flush()

      for (const userId of memberUserIds) {
        tx.persist(
          tx.create(ChatParticipant, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            conversationId: conversation.id,
            userId,
            createdAt: now,
            updatedAt: now,
          }),
        )
      }
      for (const externalContactId of contactIds) {
        tx.persist(
          tx.create(ChatParticipant, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            conversationId: conversation.id,
            userId: null,
            externalContactId,
            conversationKind: 'external',
            createdAt: now,
            updatedAt: now,
          }),
        )
      }
      await tx.flush()
      return conversation.id
    })

    await emitConversationEvent('chat.conversation.created', scope, memberUserIds, { conversationId })
    return { conversationId }
  },
}

export type AddExternalParticipantInput = {
  tenantId: string
  organizationId: string
  conversationId: string
  externalContactId: string
}

/**
 * Seat an outsider who has just spoken in a group for the first time.
 * Idempotent, and refused for anything but an external conversation — the
 * database would refuse it too.
 */
const addExternalParticipantCommand: CommandHandler<AddExternalParticipantInput, { added: boolean }> = {
  id: 'chat.conversations.addExternalParticipant',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    requireSystemContext(ctx)

    const messages = await loadChatMessages()
    const scope = scopeOf(input)
    const externalContactId = requireIdentityId(input.externalContactId)
    const em = forkEm(ctx)

    const conversation = await em.findOne(ChatConversation, {
      id: requireIdentityId(input.conversationId),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!conversation || conversation.kind !== 'external') throw notFound(messages.conversationNotFound)

    const contact = await findOneWithDecryption(
      em,
      ChatExternalContact,
      { id: externalContactId, tenantId: scope.tenantId, organizationId: scope.organizationId },
      {},
      scope,
    )
    if (!contact) throw notFound('[internal] an external contact is not known to this organization')

    const existing = await loadParticipant(em, scope, conversation.id, { kind: 'external', externalContactId })
    if (existing) return { added: false }

    try {
      const now = await dbNow(em)
      em.persist(
        em.create(ChatParticipant, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          conversationId: conversation.id,
          userId: null,
          externalContactId,
          conversationKind: 'external',
          createdAt: now,
          updatedAt: now,
        }),
      )
      await em.flush()
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      return { added: false }
    }

    const audience = await conversationAudience(forkEm(ctx), scope, conversation.id)
    await emitConversationEvent('chat.conversation.updated', scope, audience, {
      conversationId: conversation.id,
      change: 'external_participant_added',
    })
    return { added: true }
  },
}

export type CloseExternalConversationInput = {
  tenantId: string
  organizationId: string
  conversationId: string
}

/**
 * Close an external conversation: soft-delete it, as a space is when its last
 * member leaves. The room it was linked to is the transport's to let go of;
 * nothing here touches it. Closing twice converges.
 */
const closeExternalConversationCommand: CommandHandler<CloseExternalConversationInput, { closed: boolean }> = {
  id: 'chat.conversations.closeExternal',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    requireSystemContext(ctx)

    const messages = await loadChatMessages()
    const scope = scopeOf(input)
    const em = forkEm(ctx)

    const conversation = await em.findOne(ChatConversation, {
      id: requireIdentityId(input.conversationId),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!conversation) return { closed: false }
    if (conversation.kind !== 'external') throw notFound(messages.conversationNotFound)

    const audience = await conversationAudience(em, scope, conversation.id)
    conversation.deletedAt = await dbNow(em)
    await em.flush()

    await emitConversationEvent('chat.conversation.updated', scope, audience, {
      conversationId: conversation.id,
      change: 'closed',
    })
    return { closed: true }
  },
}

registerCommand(ensureExternalContactCommand)
registerCommand(createExternalConversationCommand)
registerCommand(addExternalParticipantCommand)
registerCommand(closeExternalConversationCommand)
