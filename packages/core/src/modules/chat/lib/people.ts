import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ChatExternalContact, ChatMessagingAccount, ChatParticipant } from '../data/entities'
import type { ChatScope } from './scope'

/**
 * "Who wrote this?" for outsiders — display only.
 *
 * Chat asks two different questions about people, and they must not share an
 * answer. "Is this an organization member" is permission, and stays with
 * `loadOrganizationMembers`, which an outsider can never pass. "What is this
 * author called" is display, and must answer for both kinds of person — or an
 * outsider's message is labelled "Former colleague". This file is the second
 * question's outsider half; colleagues' names keep coming from the member map
 * each caller already holds.
 */
export type ChatContactEntry = {
  name: string
  network: string
  /** An outsider's number, when their network reveals it. */
  handle?: string | null
  /** The CRM record an outsider is linked to. */
  customerEntityId?: string | null
}

export type ChatSenderRef = {
  senderUserId: string | null
  senderExternalContactId?: string | null
  /** Set when the company's phone itself sent it, straight from WhatsApp. */
  senderAccountId?: string | null
}

/**
 * Outsiders' names and networks, keyed by contact id, in one query.
 *
 * A contact's name is personal data and encrypted at rest, so this reads through
 * `findWithDecryption`. Ids are only ever ones the caller already reached
 * through an authorized row — a message, a reaction, a participant — and the
 * scope filter pins them to the caller's organization regardless.
 */
export async function loadExternalContacts(
  em: EntityManager,
  scope: ChatScope,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, ChatContactEntry>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))]
  const result = new Map<string, ChatContactEntry>()
  if (unique.length === 0) return result

  const contacts = await findWithDecryption(
    em,
    ChatExternalContact,
    { id: { $in: unique }, tenantId: scope.tenantId, organizationId: scope.organizationId },
    {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  for (const contact of contacts) {
    result.set(contact.id, {
      name: contact.displayName,
      network: contact.network,
      handle: contact.handle ?? null,
      customerEntityId: contact.customerEntityId ?? null,
    })
  }
  return result
}

/**
 * Everyone behind a page of messages who is not a colleague — outsiders and the
 * messaging accounts that sent from their own phone — in one map. The two kinds
 * are keyed by their own uuids, drawn from two tables, so they cannot collide.
 */
export async function loadSenderDirectory(
  em: EntityManager,
  scope: ChatScope,
  refs: ReadonlyArray<ChatSenderRef>,
): Promise<Map<string, ChatContactEntry>> {
  const entries = await loadExternalContacts(
    em,
    scope,
    refs.map((ref) => ref.senderExternalContactId),
  )
  const accountIds = [
    ...new Set(refs.map((ref) => ref.senderAccountId).filter((id): id is string => typeof id === 'string' && id.length > 0)),
  ]
  if (accountIds.length === 0) return entries
  // Deleted accounts too: a message sent through one keeps its author.
  const accounts = await findWithDecryption(
    em,
    ChatMessagingAccount,
    { id: { $in: accountIds }, tenantId: scope.tenantId, organizationId: scope.organizationId },
    {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  for (const account of accounts) {
    entries.set(account.id, { name: account.displayName, network: account.network })
  }
  return entries
}

/**
 * The name to show for whoever wrote something: a colleague from the member
 * names, an outsider or an account from the directory. Each falls back on its
 * own wording — an outsider is never a "former colleague".
 */
export function senderNameOf(
  ref: ChatSenderRef,
  names: ReadonlyMap<string, string>,
  contacts: ReadonlyMap<string, ChatContactEntry>,
  fallback: { colleague: string; contact: string },
): string {
  if (ref.senderExternalContactId) {
    return contacts.get(ref.senderExternalContactId)?.name ?? fallback.contact
  }
  if (ref.senderAccountId) {
    return contacts.get(ref.senderAccountId)?.name ?? fallback.contact
  }
  return (ref.senderUserId ? names.get(ref.senderUserId) : undefined) ?? fallback.colleague
}

/** An outsider's network label, or null for a colleague — and for the company's own phone. */
export function senderNetworkOf(
  ref: ChatSenderRef,
  contacts: ReadonlyMap<string, ChatContactEntry>,
): string | null {
  if (!ref.senderExternalContactId) return null
  return contacts.get(ref.senderExternalContactId)?.network ?? null
}

export type ChatExternalConversationSummary = {
  /** The conversation's own title (a group's name), or its outsiders' names. */
  title: string
  /** The network its outsiders are on — the first one's, should they differ. */
  network: string
  contacts: Array<{ id: string; name: string; lastReadAt: Date | null }>
}

/**
 * What each external conversation on a page is called, and who is outside in
 * it — two queries for the whole page, never one per row.
 *
 * A one-to-one external conversation stores no title: it is named after its
 * contact at read time, so a contact's name is never copied into a plain-text
 * column. `lastReadAt` rides along because one outsider's cursor is the read
 * receipt for what colleagues sent them.
 */
export async function loadExternalConversationSummaries(
  em: EntityManager,
  scope: ChatScope,
  conversations: ReadonlyArray<{ id: string; title: string | null }>,
  unknownContact: string,
): Promise<Map<string, ChatExternalConversationSummary>> {
  const result = new Map<string, ChatExternalConversationSummary>()
  if (conversations.length === 0) return result

  const outsiders = await em.find(
    ChatParticipant,
    {
      conversationId: { $in: conversations.map((conversation) => conversation.id) },
      externalContactId: { $ne: null },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    { orderBy: { createdAt: 'asc', id: 'asc' } },
  )
  const contacts = await loadExternalContacts(
    em,
    scope,
    outsiders.map((participant) => participant.externalContactId),
  )

  for (const conversation of conversations) {
    const people = outsiders
      .filter((participant) => participant.conversationId === conversation.id)
      .flatMap((participant) => {
        if (!participant.externalContactId) return []
        const contact = contacts.get(participant.externalContactId)
        return [
          {
            id: participant.externalContactId,
            name: contact?.name ?? unknownContact,
            network: contact?.network ?? null,
            lastReadAt: participant.lastReadAt ?? null,
          },
        ]
      })
    const named = people.map((person) => person.name).join(', ')
    result.set(conversation.id, {
      title: conversation.title ?? (named || unknownContact),
      network: people.find((person) => person.network)?.network ?? 'other',
      contacts: people.map(({ id, name, lastReadAt }) => ({ id, name, lastReadAt })),
    })
  }
  return result
}
