import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  ChatMessagingAccount,
  ChatMessagingAccountMember,
  type ChatAccountLoginStep,
  type ChatMessagingAccountOwner,
  type ChatMessagingAccountStatus,
} from '../data/entities'
import type { ChatMessagingAccountDto } from '../data/types'
import { requireIdentityId } from './participants'
import { loadOrganizationMembers, type ChatScope } from './scope'

/**
 * Reading messaging accounts, and who may touch one.
 *
 * A company account is for whoever holds `chat.accounts.manage` in its
 * organization; a personal account is for its owner alone, and only while they
 * hold `chat.accounts.connect_own`. Anyone else gets the same 404 as for an id
 * that does not exist.
 */

export const MANAGE_ACCOUNTS_FEATURE = 'chat.accounts.manage'
export const CONNECT_OWN_ACCOUNT_FEATURE = 'chat.accounts.connect_own'

export type { ChatMessagingAccountDto }

type FeatureChecker = {
  userHasAllFeatures: (
    userId: string,
    features: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

/** Wildcard-aware: `chat.*` and `*` grant both account features. */
export async function callerHasChatFeatures(
  container: unknown,
  userId: string,
  scope: ChatScope,
  features: readonly string[],
): Promise<boolean> {
  if (features.length === 0) return true
  const rbac = (container as { resolve: (name: string) => unknown }).resolve('rbacService') as FeatureChecker
  return rbac.userHasAllFeatures(userId, [...features], {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
}

export async function loadAccount(
  em: EntityManager,
  scope: ChatScope,
  accountId: string,
): Promise<ChatMessagingAccount | null> {
  return findOneWithDecryption(
    em,
    ChatMessagingAccount,
    { id: accountId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    {},
    scope,
  )
}

/** Whether this caller may see and act on this account. */
export async function canAccessAccount(
  container: unknown,
  scope: ChatScope,
  userId: string,
  account: Pick<ChatMessagingAccount, 'ownerType' | 'ownerUserId'>,
): Promise<boolean> {
  if (account.ownerType === 'user') {
    return account.ownerUserId === userId && (await callerHasChatFeatures(container, userId, scope, [CONNECT_OWN_ACCOUNT_FEATURE]))
  }
  return callerHasChatFeatures(container, userId, scope, [MANAGE_ACCOUNTS_FEATURE])
}

export async function loadAccountTeamIds(
  em: EntityManager,
  scope: ChatScope,
  accountId: string,
): Promise<string[]> {
  const rows = await em.find(ChatMessagingAccountMember, {
    accountId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  return rows.map((row) => row.userId)
}

/** Every account this caller may manage: the company's (with the feature) and their own personal ones. */
export async function listAccountsForCaller(
  container: unknown,
  em: EntityManager,
  scope: ChatScope,
  userId: string,
): Promise<ChatMessagingAccount[]> {
  const [manage, connectOwn] = await Promise.all([
    callerHasChatFeatures(container, userId, scope, [MANAGE_ACCOUNTS_FEATURE]),
    callerHasChatFeatures(container, userId, scope, [CONNECT_OWN_ACCOUNT_FEATURE]),
  ])
  if (!manage && !connectOwn) return []
  const ownership: FilterQuery<ChatMessagingAccount>[] = []
  if (manage) ownership.push({ ownerType: 'company' })
  if (connectOwn) ownership.push({ ownerType: 'user', ownerUserId: requireIdentityId(userId) })
  const where: FilterQuery<ChatMessagingAccount> = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
    $or: ownership,
  }
  return findWithDecryption(em, ChatMessagingAccount, where, { orderBy: { createdAt: 'asc', id: 'asc' } }, scope)
}

function publicLoginStep(step: ChatAccountLoginStep): NonNullable<ChatMessagingAccountDto['loginStep']> {
  return {
    flow: step.flow,
    kind: step.kind,
    data: step.data ?? null,
    ...(step.fields ? { fields: step.fields } : {}),
    updatedAt: step.updatedAt,
  }
}

export async function toAccountDtos(
  em: EntityManager,
  scope: ChatScope,
  accounts: readonly ChatMessagingAccount[],
): Promise<ChatMessagingAccountDto[]> {
  if (accounts.length === 0) return []
  const memberRows = await em.find(ChatMessagingAccountMember, {
    accountId: { $in: accounts.map((account) => account.id) },
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  const people = await loadOrganizationMembers(
    em,
    scope,
    memberRows.map((row) => row.userId),
  )
  return accounts.map((account) => ({
    id: account.id,
    network: account.network,
    ownerType: account.ownerType,
    ownerUserId: account.ownerUserId ?? null,
    name: account.displayName,
    remoteHandle: account.remoteHandle ?? null,
    status: account.status,
    statusReason: account.statusReason ?? null,
    showSenderName: account.showSenderName,
    loginStep: account.status === 'connecting' && account.loginStep ? publicLoginStep(account.loginStep) : null,
    connectedAt: account.connectedAt?.toISOString() ?? null,
    disconnectedAt: account.disconnectedAt?.toISOString() ?? null,
    updatedAt: account.updatedAt?.toISOString() ?? null,
    members: memberRows
      .filter((row) => row.accountId === account.id)
      .flatMap((row) => {
        const person = people.get(row.userId)
        // A colleague who left the organization is not on the team any more.
        return person ? [{ id: person.id, name: person.name }] : []
      }),
  }))
}

/**
 * The account a conversation came in through, when a colleague is about to act
 * in it — or null for any other conversation.
 *
 * Refuses when that account is not connected: a reply, an edit or a deletion
 * would land in Operis and never reach the customer, and the two would silently
 * disagree about what was said.
 */
export async function requireConnectedAccountFor(
  em: EntityManager,
  scope: ChatScope,
  conversation: { messagingAccountId?: string | null },
  notConnectedMessage: string,
): Promise<ChatMessagingAccount | null> {
  if (!conversation.messagingAccountId) return null
  const account = await loadAccount(em, scope, conversation.messagingAccountId)
  if (!account || account.status !== 'connected') {
    throw new CrudHttpError(409, { error: notConnectedMessage })
  }
  return account
}

/**
 * What leads a colleague's reply on the customer's side, when the account signs
 * them: the first word of their name. Never an email address — a person with no
 * name set is displayed by their sign-in address, which is not the customer's
 * to see.
 */
export function signatureFor(account: Pick<ChatMessagingAccount, 'showSenderName'>, senderName: string): string | null {
  if (!account.showSenderName) return null
  const first = senderName.trim().split(/\s+/)[0] ?? ''
  if (first.length === 0 || first.includes('@')) return null
  return first
}
