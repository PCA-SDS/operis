import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { badRequest, forbidden, notFound } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ChatExternalContact, ChatParticipant } from '../data/entities'
import { hasAccess } from '../lib/access'
import { dbNow } from '../lib/clock'
import { crmAvailable, loadCustomers, viewableCustomerKinds } from '../lib/crm'
import { loadChatMessages } from '../lib/messages'
import { requireIdentityId } from '../lib/participants'
import type { ChatScope } from '../lib/scope'
import { loadSpaceContext } from '../lib/spaces'
import {
  actingUserId,
  conversationAudience,
  emitConversationEvent,
  ensureOrganizationScope,
  ensureTenantScope,
  forkEm,
} from './shared'

export type LinkContactCustomerInput = {
  tenantId: string
  organizationId: string
  /** The client conversation the colleague is linking from — their authority to do it. */
  conversationId: string
  externalContactId: string
  /** The CRM person or company, or null to unlink. */
  customerEntityId: string | null
}

/**
 * Link an outsider to the CRM record they are, or unlink them.
 *
 * Done from a client conversation, by a colleague who may answer the client
 * there; the contact must be one of its outsiders. The record must be a live
 * one in this organization that the colleague may open in the CRM — the same
 * answer, "not found", whether it does not exist or they may not see it. The
 * link is on the contact, so every conversation with them shows it.
 */
const linkContactCustomerCommand: CommandHandler<
  LinkContactCustomerInput,
  { externalContactId: string; customerEntityId: string | null }
> = {
  id: 'chat.externalContacts.linkCustomer',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const messages = await loadChatMessages()
    const scope: ChatScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const actorUserId = await actingUserId(ctx)
    const em = forkEm(ctx)

    if (!crmAvailable(ctx.container)) throw badRequest(messages.crmUnavailable)

    const { conversation, participant } = await loadSpaceContext(em, scope, input.conversationId, actorUserId)
    if (conversation.kind !== 'external') throw badRequest(messages.notASpace)
    if (!hasAccess(participant, 'participant')) throw forbidden(messages.crmLinkNotAllowed)

    const externalContactId = requireIdentityId(input.externalContactId)
    const seated = await em.findOne(ChatParticipant, {
      conversationId: conversation.id,
      externalContactId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    if (!seated) throw notFound(messages.contactNotInConversation)
    const contact = await findOneWithDecryption(
      em,
      ChatExternalContact,
      { id: externalContactId, tenantId: scope.tenantId, organizationId: scope.organizationId },
      {},
      scope,
    )
    if (!contact) throw notFound(messages.contactNotInConversation)

    const kinds = await viewableCustomerKinds(ctx.container, actorUserId, scope)
    if (kinds.size === 0) throw forbidden(messages.crmLinkNotAllowed)
    if (input.customerEntityId) {
      const record = (await loadCustomers(em, ctx.container, scope, [input.customerEntityId])).get(input.customerEntityId)
      if (!record || !kinds.has(record.kind)) throw notFound(messages.crmRecordNotFound)
    }

    const next = input.customerEntityId ?? null
    if ((contact.customerEntityId ?? null) !== next) {
      contact.customerEntityId = next
      contact.customerLinkedByUserId = next ? actorUserId : null
      contact.customerLinkedAt = next ? await dbNow(em) : null
      await em.flush()

      const recipients = await conversationAudience(em, scope, conversation.id)
      await emitConversationEvent('chat.conversation.updated', scope, recipients, {
        conversationId: conversation.id,
        change: 'contact_linked',
      })
    }
    return { externalContactId, customerEntityId: next }
  },
}

registerCommand(linkContactCustomerCommand)
