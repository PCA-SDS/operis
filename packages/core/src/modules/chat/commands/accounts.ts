import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { badRequest, conflict, CrudHttpError, forbidden, isUniqueViolation, notFound } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import {
  buildFeatureNotificationFromType,
  buildNotificationFromType,
} from '../../notifications/lib/notificationBuilder'
import {
  ChatMessagingAccount,
  ChatMessagingAccountMember,
  MAX_ACCOUNT_NAME_LENGTH,
  type ChatAccountLoginFlow,
  type ChatAccountLoginStep,
  type ChatMessagingAccountOwner,
} from '../data/entities'
import { notificationTypes } from '../notifications'
import {
  resolveChatAccountConnector,
  type ChatAccountConnector,
  type ChatAccountFailureReason,
  type ConnectorAccount,
} from '../lib/accountConnector'
import {
  callerHasChatFeatures,
  canAccessAccount,
  CONNECT_OWN_ACCOUNT_FEATURE,
  loadAccount,
  MANAGE_ACCOUNTS_FEATURE,
} from '../lib/accounts'
import { dbNow } from '../lib/clock'
import { loadChatMessages } from '../lib/messages'
import { requireIdentityId } from '../lib/participants'
import { loadOrganizationMember, loadOrganizationMembers, type ChatScope } from '../lib/scope'
import { actingUserId, ensureOrganizationScope, ensureTenantScope, forkEm } from './shared'

const logger = createLogger('chat').child({ component: 'accounts' })

/**
 * Messaging accounts: connecting a company's (or an employee's own) WhatsApp.
 *
 * Two kinds of command live here. The ones a person runs — create, change,
 * connect, cancel, disconnect, delete — act on an account the caller may manage
 * (`lib/accounts.ts`), and answer 404 for one they may not. The ones the
 * connector runs — a new login step, a changed connection state — refuse any
 * context with a logged-in user, so no browser can claim an account connected.
 */

export const ACCOUNT_RESOURCE_KIND = 'chat.messaging_account'

const NETWORK_PATTERN = /^[a-z][a-z0-9-]{0,31}$/
const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/
const MAX_REMOTE_TEXT_LENGTH = 200

function scopeOf(input: { tenantId: string; organizationId: string }): ChatScope {
  return { tenantId: input.tenantId, organizationId: input.organizationId }
}

function requireSystemContext(ctx: CommandRuntimeContext): void {
  if (typeof ctx.auth?.sub === 'string' && ctx.auth.sub.length > 0) {
    throw forbidden('[internal] account state is reported by the connector, not by a user')
  }
}

function toConnectorAccount(account: ChatMessagingAccount): ConnectorAccount {
  return {
    id: account.id,
    network: account.network,
    ownerType: account.ownerType,
    ownerUserId: account.ownerUserId ?? null,
    scope: { tenantId: account.tenantId, organizationId: account.organizationId },
  }
}

/** `+49 (151) 234-567 89` → `+4915123456789`, or null when it is not a phone number. */
export function normalizePhoneNumber(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const compact = raw.replace(/[\s().-]/g, '').replace(/^00/, '+')
  return PHONE_PATTERN.test(compact) ? compact : null
}

function trimmedName(raw: string, messages: Awaited<ReturnType<typeof loadChatMessages>>): string {
  const name = raw.trim().slice(0, MAX_ACCOUNT_NAME_LENGTH)
  if (name.length === 0) throw badRequest(messages.validationFailed)
  return name
}

function remoteText(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim().slice(0, MAX_REMOTE_TEXT_LENGTH) : ''
  return trimmed.length > 0 ? trimmed : null
}

/**
 * The account, when this caller may act on it — otherwise the same 404 as for an
 * id that does not exist.
 */
async function requireAccessibleAccount(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  scope: ChatScope,
  userId: string,
  accountId: string,
): Promise<ChatMessagingAccount> {
  const messages = await loadChatMessages()
  const account = await loadAccount(em, scope, requireIdentityId(accountId))
  if (!account || !(await canAccessAccount(ctx.container, scope, userId, account))) {
    throw notFound(messages.accountNotFound)
  }
  return account
}

/**
 * The account row for a connection-state change, locked until the transaction
 * ends. Every such change is check-then-write — "still connecting, still this
 * attempt?" — and the connector's reports arrive from another process at the
 * very moment a person acts: without the lock, the slower writer wins with an
 * answer the faster one already made stale.
 */
async function lockAccount(tx: EntityManager, scope: ChatScope, accountId: string): Promise<ChatMessagingAccount | null> {
  return findOneWithDecryption(
    tx,
    ChatMessagingAccount,
    { id: requireIdentityId(accountId), tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { lockMode: LockMode.PESSIMISTIC_WRITE },
    scope,
  )
}

/** The team, validated: distinct ids, every one an active member of the organization. */
async function validatedTeam(em: EntityManager, scope: ChatScope, memberUserIds: readonly string[]): Promise<string[]> {
  const messages = await loadChatMessages()
  const ids = [...new Set(memberUserIds.map((id) => requireIdentityId(id)))]
  if (ids.length === 0) throw badRequest(messages.accountTeamRequired)
  const members = await loadOrganizationMembers(em, scope, ids)
  if (members.size !== ids.length) throw badRequest(messages.memberNotFound)
  return ids
}

async function replaceTeam(
  em: EntityManager,
  account: ChatMessagingAccount,
  memberUserIds: readonly string[],
  now: Date,
): Promise<void> {
  const current = await em.find(ChatMessagingAccountMember, {
    accountId: account.id,
    tenantId: account.tenantId,
    organizationId: account.organizationId,
  })
  const wanted = new Set(memberUserIds)
  for (const row of current) {
    if (!wanted.has(row.userId)) em.remove(row)
  }
  const kept = new Set(current.map((row) => row.userId))
  for (const userId of memberUserIds) {
    if (kept.has(userId)) continue
    em.persist(
      em.create(ChatMessagingAccountMember, {
        tenantId: account.tenantId,
        organizationId: account.organizationId,
        accountId: account.id,
        userId,
        createdAt: now,
      }),
    )
  }
}

/**
 * Run a connector call, turning an unreachable bridge into a message a person
 * can act on. The connector's own errors are logged, never shown: they can name
 * internal hosts.
 */
async function withConnector<T>(action: string, accountId: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof CrudHttpError) throw error
    logger.error('messaging account connector call failed', {
      action,
      accountId,
      error: error instanceof Error ? error.message : String(error),
    })
    const messages = await loadChatMessages()
    throw new CrudHttpError(503, { error: messages.accountUnreachable })
  }
}

function connectorFor(ctx: CommandRuntimeContext): ChatAccountConnector {
  return resolveChatAccountConnector(ctx.container)
}

// ---------------------------------------------------------------------------
// Commands a person runs.
// ---------------------------------------------------------------------------

export type CreateAccountInput = {
  tenantId: string
  organizationId: string
  network: string
  /** Required for a company account. A personal one left unnamed takes its owner's name. */
  name?: string
  ownerType: ChatMessagingAccountOwner
  /** The team a company account seats in every new chat. Must be empty for a personal account. */
  memberUserIds: string[]
}

const createAccountCommand: CommandHandler<CreateAccountInput, { accountId: string }> = {
  id: 'chat.accounts.create',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const userId = await actingUserId(ctx)
    const messages = await loadChatMessages()
    const scope = scopeOf(input)
    const em = forkEm(ctx)

    const personal = input.ownerType === 'user'
    const feature = personal ? CONNECT_OWN_ACCOUNT_FEATURE : MANAGE_ACCOUNTS_FEATURE
    if (!(await callerHasChatFeatures(ctx.container, userId, scope, [feature]))) {
      throw forbidden(messages.unauthorized)
    }

    const connector = connectorFor(ctx)
    if (!NETWORK_PATTERN.test(input.network) || !connector.networks().includes(input.network)) {
      throw badRequest(messages.accountNetworkUnavailable)
    }
    if (personal && !connector.supportsPersonalAccounts()) throw badRequest(messages.accountPersonalUnavailable)

    // A personal number speaks for its owner — "via Ana Silva" reads right to
    // the colleagues who see it; a company number is named by whoever adds it.
    const ownerName = personal && !input.name?.trim() ? (await loadOrganizationMember(em, scope, userId))?.name : null
    const name = trimmedName(input.name?.trim() ? input.name : ownerName ?? '', messages)
    const team = personal ? [] : await validatedTeam(em, scope, input.memberUserIds)
    if (personal && input.memberUserIds.length > 0) throw badRequest(messages.validationFailed)

    try {
      const accountId = await em.transactional(async (tx) => {
        const now = await dbNow(tx)
        const account = tx.create(ChatMessagingAccount, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          network: input.network,
          ownerType: input.ownerType,
          ownerUserId: personal ? userId : null,
          displayName: name,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        })
        tx.persist(account)
        await tx.flush()
        await replaceTeam(tx, account, team, now)
        await tx.flush()
        return account.id
      })
      return { accountId }
    } catch (error) {
      // `chat_messaging_accounts_personal_uq`: one personal account per person per network.
      if (personal && isUniqueViolation(error)) throw conflict(messages.accountPersonalExists)
      throw error
    }
  },
}

export type UpdateAccountInput = {
  tenantId: string
  organizationId: string
  accountId: string
  name?: string
  memberUserIds?: string[]
  showSenderName?: boolean
}

const updateAccountCommand: CommandHandler<UpdateAccountInput, { accountId: string }> = {
  id: 'chat.accounts.update',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const userId = await actingUserId(ctx)
    const messages = await loadChatMessages()
    const scope = scopeOf(input)
    const em = forkEm(ctx)

    const account = await requireAccessibleAccount(em, ctx, scope, userId, input.accountId)
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: ACCOUNT_RESOURCE_KIND,
      resourceId: account.id,
      current: account.updatedAt ?? account.createdAt,
      request: ctx.request ?? null,
    })

    // A personal account has no team: its chats are its owner's alone.
    if (account.ownerType === 'user' && (input.memberUserIds?.length ?? 0) > 0) {
      throw badRequest(messages.validationFailed)
    }
    const team =
      account.ownerType === 'company' && input.memberUserIds !== undefined
        ? await validatedTeam(em, scope, input.memberUserIds)
        : null
    const name = input.name === undefined ? null : trimmedName(input.name, messages)

    await em.transactional(async (tx) => {
      const row = await tx.findOneOrFail(ChatMessagingAccount, {
        id: account.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
      if (name !== null) row.displayName = name
      if (input.showSenderName !== undefined) row.showSenderName = input.showSenderName
      if (team) await replaceTeam(tx, row, team, await dbNow(tx))
      // A team change alone touches no account column. Move the version anyway,
      // so a second editor still holding the old team is told it changed.
      row.updatedAt = await dbNow(tx)
      await tx.flush()
    })
    return { accountId: account.id }
  },
}

export type ConnectAccountInput = {
  tenantId: string
  organizationId: string
  accountId: string
  flow: ChatAccountLoginFlow
  phoneNumber?: string | null
}

/**
 * Start connecting: the connector returns the first thing to show (a QR code, a
 * pairing code) and keeps reporting new ones until the login ends.
 *
 * Starting again while a login runs replaces it — the connector cancels the old
 * attempt, and its late reports name an attempt that is no longer current.
 */
const connectAccountCommand: CommandHandler<ConnectAccountInput, { accountId: string }> = {
  id: 'chat.accounts.connect',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const userId = await actingUserId(ctx)
    const messages = await loadChatMessages()
    const scope = scopeOf(input)
    const em = forkEm(ctx)

    const account = await requireAccessibleAccount(em, ctx, scope, userId, input.accountId)
    if (account.status === 'connected') throw conflict(messages.accountAlreadyConnected)

    const phoneNumber = input.flow === 'phone' ? normalizePhoneNumber(input.phoneNumber) : null
    if (input.flow === 'phone' && !phoneNumber) throw badRequest(messages.accountPhoneRequired)

    const connector = connectorFor(ctx)
    if (!connector.networks().includes(account.network)) throw badRequest(messages.accountNetworkUnavailable)

    const started = await withConnector('startLogin', account.id, () =>
      connector.startLogin({ em: forkEm(ctx), container: ctx.container }, toConnectorAccount(account), input.flow, {
        phoneNumber,
      }),
    )

    const now = await dbNow(em)
    account.connectedByUserId = userId
    if (started.kind === 'step') {
      account.status = 'connecting'
      account.statusReason = null
      account.loginStep = { ...started.step, updatedAt: now.toISOString() }
    } else if (started.kind === 'connected') {
      account.status = 'connected'
      account.statusReason = null
      account.loginStep = null
      account.connectedAt = now
      account.disconnectedAt = null
      account.remoteHandle = remoteText(started.remoteHandle) ?? account.remoteHandle ?? null
    } else {
      account.status = 'failed'
      account.statusReason = started.reason
      account.loginStep = null
    }
    await em.flush()
    return { accountId: account.id }
  },
}

export type AccountActionInput = {
  tenantId: string
  organizationId: string
  accountId: string
}

/** Stop a login in progress. Converges: nothing running is not an error. */
const cancelConnectCommand: CommandHandler<AccountActionInput, { accountId: string }> = {
  id: 'chat.accounts.cancelConnect',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const userId = await actingUserId(ctx)
    const scope = scopeOf(input)
    const em = forkEm(ctx)

    const account = await requireAccessibleAccount(em, ctx, scope, userId, input.accountId)

    // Chat lets go of the attempt first, and only then tells the network. The
    // wait the connector is blocked on ends the moment the bridge hears
    // "cancel", and its report must find the attempt already gone — or it
    // lands last and the account reads "failed" for something a person chose.
    const released = await em.transactional(async (tx) => {
      const locked = await lockAccount(tx, scope, account.id)
      if (!locked || locked.status !== 'connecting') return false
      locked.status = locked.connectedAt ? 'disconnected' : 'pending'
      locked.statusReason = null
      locked.loginStep = null
      await tx.flush()
      return true
    })
    if (!released) return { accountId: account.id }

    // A network that cannot be reached keeps a code alive a little longer; the
    // attempt is gone on this side, so whatever it reports is dropped, and a
    // login it finishes anyway is undone by the connector.
    const connector = connectorFor(ctx)
    await withConnector('cancelLogin', account.id, () =>
      connector.cancelLogin({ em: forkEm(ctx), container: ctx.container }, toConnectorAccount(account)),
    )
    return { accountId: account.id }
  },
}

/**
 * Log the account out of its network. Its conversations stay — they are the
 * company's record of what was said — but nothing more arrives or leaves until
 * someone connects it again.
 */
const disconnectAccountCommand: CommandHandler<AccountActionInput, { accountId: string }> = {
  id: 'chat.accounts.disconnect',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const userId = await actingUserId(ctx)
    const scope = scopeOf(input)
    const em = forkEm(ctx)

    const account = await requireAccessibleAccount(em, ctx, scope, userId, input.accountId)
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: ACCOUNT_RESOURCE_KIND,
      resourceId: account.id,
      current: account.updatedAt ?? account.createdAt,
      request: ctx.request ?? null,
    })

    const connector = connectorFor(ctx)
    await withConnector('logout', account.id, async () => {
      const target = toConnectorAccount(account)
      const connectorCtx = { em: forkEm(ctx), container: ctx.container }
      if (account.status === 'connecting') await connector.cancelLogin(connectorCtx, target)
      await connector.logout(connectorCtx, target)
    })

    const wasConnected = account.status === 'connected' || account.connectedAt !== null
    account.status = wasConnected ? 'disconnected' : 'pending'
    account.statusReason = null
    account.loginStep = null
    if (wasConnected) account.disconnectedAt = await dbNow(em)
    await em.flush()
    return { accountId: account.id }
  },
}

/**
 * Disconnect, then remove the account from the list. Soft: its conversations
 * and the messages sent through it still name it.
 */
const deleteAccountCommand: CommandHandler<AccountActionInput, { accountId: string }> = {
  id: 'chat.accounts.delete',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const userId = await actingUserId(ctx)
    const scope = scopeOf(input)
    const em = forkEm(ctx)

    const account = await requireAccessibleAccount(em, ctx, scope, userId, input.accountId)
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: ACCOUNT_RESOURCE_KIND,
      resourceId: account.id,
      current: account.updatedAt ?? account.createdAt,
      request: ctx.request ?? null,
    })

    // Logged out first and for certain: a deleted account whose login lived on
    // would keep feeding chats into conversations nobody can manage any more.
    const connector = connectorFor(ctx)
    await withConnector('logout', account.id, async () => {
      const target = toConnectorAccount(account)
      const connectorCtx = { em: forkEm(ctx), container: ctx.container }
      await connector.cancelLogin(connectorCtx, target)
      await connector.logout(connectorCtx, target)
    })

    const now = await dbNow(em)
    if (account.connectedAt) account.disconnectedAt = now
    account.status = account.connectedAt ? 'disconnected' : 'pending'
    account.loginStep = null
    account.deletedAt = now
    await em.flush()
    return { accountId: account.id }
  },
}

// ---------------------------------------------------------------------------
// Commands the connector runs.
// ---------------------------------------------------------------------------

export type RecordLoginStepInput = {
  tenantId: string
  organizationId: string
  accountId: string
  step: Omit<ChatAccountLoginStep, 'updatedAt'>
}

/** A new code to show — a rotated QR, say. Ignored unless its attempt is the current one. */
const recordLoginStepCommand: CommandHandler<RecordLoginStepInput, { applied: boolean }> = {
  id: 'chat.accounts.recordLoginStep',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    requireSystemContext(ctx)
    const scope = scopeOf(input)
    const em = forkEm(ctx)

    const applied = await em.transactional(async (tx) => {
      const account = await lockAccount(tx, scope, input.accountId)
      if (!account || account.status !== 'connecting' || account.loginStep?.attemptId !== input.step.attemptId) {
        return false
      }
      account.loginStep = { ...input.step, updatedAt: (await dbNow(tx)).toISOString() }
      await tx.flush()
      return true
    })
    return { applied }
  },
}

export type MarkAccountStateInput = {
  tenantId: string
  organizationId: string
  accountId: string
  /**
   * The login attempt this outcome ends. Absent for a health check, which only
   * ever moves an account that finished connecting.
   */
  attemptId?: string | null
  status: 'connected' | 'disconnected' | 'failed'
  reason?: ChatAccountFailureReason | null
  remoteHandle?: string | null
  remoteName?: string | null
}

/**
 * A connection state the network reported: a login that finished or failed, or
 * a connected account that dropped (or came back on its own).
 *
 * A drop notifies the people who can reconnect it — once per drop, because the
 * transition, not the state, is what sends it.
 */
const markAccountStateCommand: CommandHandler<MarkAccountStateInput, { applied: boolean }> = {
  id: 'chat.accounts.markState',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    requireSystemContext(ctx)
    const scope = scopeOf(input)
    const em = forkEm(ctx)

    const outcome = await em.transactional(async (tx) => {
      const account = await lockAccount(tx, scope, input.accountId)
      if (!account) return null

      if (input.attemptId) {
        if (account.status !== 'connecting' || account.loginStep?.attemptId !== input.attemptId) return null
        if (input.status === 'disconnected') return null
      } else {
        // A health report: it may drop a connected account or restore a dropped
        // one, never finish or fail a login somebody is looking at.
        const movable =
          (account.status === 'connected' && input.status === 'disconnected') ||
          (account.status === 'disconnected' && account.connectedAt !== null && input.status === 'connected')
        if (!movable) return null
      }

      const now = await dbNow(tx)
      const dropped = account.status === 'connected' && input.status === 'disconnected'
      account.status = input.status
      account.loginStep = null
      if (input.status === 'connected') {
        account.statusReason = null
        account.disconnectedAt = null
        if (input.attemptId || !account.connectedAt) account.connectedAt = now
        account.remoteHandle = remoteText(input.remoteHandle) ?? account.remoteHandle ?? null
      } else {
        account.statusReason = input.reason ?? 'error'
        if (input.status === 'disconnected') account.disconnectedAt = now
      }
      await tx.flush()
      return { account, dropped }
    })
    if (!outcome) return { applied: false }

    if (outcome.dropped) await notifyDisconnected(ctx, outcome.account)
    return { applied: true }
  },
}

/** Where an employee manages their own WhatsApp. */
const PERSONAL_ACCOUNT_PAGE = '/backend/profile/whatsapp'

async function notifyDisconnected(ctx: CommandRuntimeContext, account: ChatMessagingAccount): Promise<void> {
  const typeDef = notificationTypes.find((type) => type.type === 'chat.account.disconnected')
  if (!typeDef) return
  const scope = { tenantId: account.tenantId, organizationId: account.organizationId }
  try {
    const service = resolveNotificationService(ctx.container as { resolve: (name: string) => unknown })
    const content = {
      bodyVariables: { account: account.displayName },
      sourceEntityType: 'chat:chat_messaging_account',
      sourceEntityId: account.id,
      groupKey: `chat.account.disconnected:${account.id}`,
    }
    if (account.ownerType === 'user' && account.ownerUserId) {
      // Their own number is reconnected on their own page, not the admins'.
      const built = buildNotificationFromType(typeDef, {
        ...content,
        linkHref: PERSONAL_ACCOUNT_PAGE,
        recipientUserId: account.ownerUserId,
      })
      await service.create(
        { ...built, actions: built.actions?.map((action) => ({ ...action, href: PERSONAL_ACCOUNT_PAGE })) },
        scope,
      )
      return
    }
    // Everyone who may reconnect it, in this organization only — wildcard grants
    // (`chat.*`, `*`) included, through the RBAC service.
    await service.createForFeature(
      {
        ...buildFeatureNotificationFromType(typeDef, { ...content, requiredFeature: MANAGE_ACCOUNTS_FEATURE }),
        restrictRecipientsToOrganization: true,
      },
      scope,
    )
  } catch (error) {
    // The state change is committed; a missing bell entry is not worth undoing it.
    logger.warn('could not notify about a disconnected messaging account', {
      accountId: account.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export type MoveAccountChatInput = AccountActionInput & {
  /** The connector's id for the chat, from the list it gave. */
  chatId: string
}

/**
 * Move one chat from an employee's personal WhatsApp to the company: from now
 * on it is a client conversation they own, and nothing said in it before comes
 * along. Only by the employee, and only while the number is connected.
 */
const moveAccountChatCommand: CommandHandler<MoveAccountChatInput, { conversationId: string }> = {
  id: 'chat.accounts.moveChat',
  async execute(input, ctx) {
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const userId = await actingUserId(ctx)
    const messages = await loadChatMessages()
    const scope = scopeOf(input)
    const em = forkEm(ctx)

    const account = await requireAccessibleAccount(em, ctx, scope, userId, input.accountId)
    // A company number's chats arrive by themselves; only a personal one's are
    // moved, and only by the person it belongs to.
    if (account.ownerType !== 'user' || account.ownerUserId !== userId) throw notFound(messages.accountNotFound)
    if (account.status !== 'connected') throw conflict(messages.accountNotConnected)
    const chatId = input.chatId.trim()
    if (chatId.length === 0 || chatId.length > 255) throw notFound(messages.accountChatNotFound)

    const connector = connectorFor(ctx)
    const moved = await withConnector('moveChat', account.id, () =>
      connector.moveChat({ em: forkEm(ctx), container: ctx.container }, toConnectorAccount(account), chatId),
    )
    if (!moved) throw notFound(messages.accountChatNotFound)
    return moved
  },
}

registerCommand(createAccountCommand)
registerCommand(updateAccountCommand)
registerCommand(connectAccountCommand)
registerCommand(cancelConnectCommand)
registerCommand(disconnectAccountCommand)
registerCommand(deleteAccountCommand)
registerCommand(recordLoginStepCommand)
registerCommand(markAccountStateCommand)
registerCommand(moveAccountChatCommand)
