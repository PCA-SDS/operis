import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  accountMxid,
  BridgeProvisioningClient,
  localpartForAccount,
  MatrixClient,
  MatrixError,
  type BridgeLoginStep,
  type MatrixConfig,
} from '@open-mercato/matrix'
import type {
  ChatAccountConnector,
  ChatAccountFailureReason,
  ConnectorAccount,
  ConnectorAccountState,
  ConnectorContext,
  ConnectorLoginStart,
} from '@open-mercato/core/modules/chat/lib/accountConnector'
import type { ChatScope } from '@open-mercato/core/modules/chat/lib/scope'
import { ChatMatrixAccountLogin, type ChatMatrixPendingLogin } from '../data/entities'
import { enqueueAccountLogin, type AccountLoginJob } from './queue'
import { systemContext } from './outsiders'
import { listPersonalChats, movePersonalChat } from './personalChats'

const logger = createLogger('chat_matrix').child({ component: 'accounts' })

/**
 * Connecting a messaging account through a mautrix bridge — chat's
 * `chatAccountConnector`, backed by the bridge's provisioning API.
 *
 * Each account is one Matrix identity that owns its bridge login: a company
 * account is `@om_a_<hex>` (inside the Operis appservice, so its portals are
 * pushed here), a personal one `@opp_<hex>` (outside it, so they are not). The
 * bridge double-puppets that identity, which is why a reply sent as it leaves
 * WhatsApp as the account itself.
 *
 * The browser never sees a bridge id. The login process and its current step
 * live in `chat_matrix_account_logins.pending_login`; chat only ever holds the
 * attempt id minted here.
 */

type Flow = Parameters<ChatAccountConnector['startLogin']>[2]

/** How long one login may run, end to end — WhatsApp offers six QR codes over about two minutes. */
const LOGIN_DEADLINE_MS = 6 * 60_000
/** A bound on steps, whatever the bridge does: six codes, completion, and headroom. */
const MAX_LOGIN_ROUNDS = 16

export type AccountConnectorDeps = {
  config: MatrixConfig
  /** The appservice client — acts as company account identities. */
  client: MatrixClient
}

export type LoginDriverDeps = AccountConnectorDeps & {
  em: EntityManager
  commandBus: CommandBus
  container: CommandRuntimeContext['container']
}

const provisioningClients = new Map<string, BridgeProvisioningClient>()

function provisioningFor(config: MatrixConfig, network: string): BridgeProvisioningClient | null {
  const entry = config.provisioning?.[network]
  if (!entry) return null
  const key = `${network}|${entry.url}`
  let client = provisioningClients.get(key)
  if (!client) {
    client = new BridgeProvisioningClient(entry)
    provisioningClients.set(key, client)
  }
  return client
}

let accountsClient: MatrixClient | null = null

/** The client that may act as this identity: the appservice for a company account, the double-puppet one for a personal account. */
export function clientFor(deps: AccountConnectorDeps, ownerType: 'company' | 'user'): MatrixClient {
  if (ownerType === 'company') return deps.client
  accountsClient ??= new MatrixClient(deps.config, { scope: 'accounts' })
  return accountsClient
}

/** The Matrix identity that owns the account's login. */
export function accountIdentity(config: MatrixConfig, account: { id: string; ownerType: 'company' | 'user' }): string {
  return accountMxid(config, account.id, account.ownerType)
}

/**
 * Map what the bridge said onto a reason the account page can explain.
 * Unknown codes are `error`: the page says "something went wrong", and the
 * detail stays in the log.
 */
export function failureReasonOf(error: unknown): ChatAccountFailureReason {
  if (!(error instanceof MatrixError)) return 'error'
  const code = error.errcode ?? ''
  if (code === 'FI.MAU.WHATSAPP.LOGIN_TIMEOUT' || code === 'FI.MAU.BRIDGE.LOGIN_TIMED_OUT') return 'timeout'
  if (code === 'FI.MAU.BRIDGE.LOGIN_CANCELLED' || code === 'FI.MAU.LOGIN_STEP_CANCELLED') return 'cancelled'
  if (code.startsWith('FI.MAU.WHATSAPP.PHONE_NUMBER')) return 'invalid_phone_number'
  if (code === 'FI.MAU.WHATSAPP.RATE_LIMITED') return 'rate_limited'
  if (error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504) {
    return 'bridge_unreachable'
  }
  return 'error'
}

/** Whether an error means "the login is gone" rather than "something is wrong". */
function isGoneLogin(error: unknown): boolean {
  if (!(error instanceof MatrixError)) return false
  return (
    error.status === 404 ||
    error.errcode === 'M_NOT_FOUND' ||
    error.errcode === 'FI.MAU.BRIDGE.LOGIN_ALREADY_FINISHED' ||
    error.errcode === 'FI.MAU.BRIDGE.LOGIN_CANCELLED' ||
    error.errcode === 'FI.MAU.LOGIN_STEP_CANCELLED' ||
    error.errcode === 'FI.MAU.NOT_LOGGED_IN'
  )
}

export async function loadLoginRow(em: EntityManager, account: ConnectorAccount): Promise<ChatMatrixAccountLogin | null> {
  return em.findOne(ChatMatrixAccountLogin, {
    accountId: account.id,
    tenantId: account.scope.tenantId,
    organizationId: account.scope.organizationId,
  })
}

/**
 * The account's row, creating it on first connect. The identity is a pure
 * function of the account id, so two racing creators write the same row and
 * the loser re-reads the winner's.
 */
async function ensureLoginRow(
  deps: AccountConnectorDeps,
  em: EntityManager,
  account: ConnectorAccount,
): Promise<ChatMatrixAccountLogin> {
  const existing = await loadLoginRow(em, account)
  if (existing) return existing
  const byAccount = await em.findOne(ChatMatrixAccountLogin, { accountId: account.id })
  if (byAccount) {
    // An account id is a uuid minted in one organization; seeing it under
    // another scope means somebody is guessing ids.
    throw new Error('[internal] a messaging account login exists under another scope')
  }
  const row = em.create(ChatMatrixAccountLogin, {
    tenantId: account.scope.tenantId,
    organizationId: account.scope.organizationId,
    accountId: account.id,
    ownerType: account.ownerType,
    network: account.network,
    mxid: accountIdentity(deps.config, account),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  em.persist(row)
  try {
    await em.flush()
    return row
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    const winner = await loadLoginRow(em.fork(), account)
    if (!winner) throw error
    return winner
  }
}

/** Tell the homeserver the identity exists, once. Appservice users are never implicit. */
async function ensureRegistered(deps: AccountConnectorDeps, em: EntityManager, row: ChatMatrixAccountLogin): Promise<void> {
  if (row.registeredAt) return
  await clientFor(deps, row.ownerType).registerUser(localpartForAccount(deps.config, row.accountId, row.ownerType))
  row.registeredAt = new Date()
  await em.flush()
}

async function cancelPendingAtBridge(
  provisioning: BridgeProvisioningClient,
  row: ChatMatrixAccountLogin,
): Promise<void> {
  const pending = row.pendingLogin
  if (!pending) return
  try {
    await provisioning.cancelLogin(row.mxid, pending.processId)
  } catch (error) {
    if (!isGoneLogin(error)) throw error
  }
}

/**
 * Log out every login this identity holds at the bridge. An account is one
 * WhatsApp number: a second login under the same identity would pour a second
 * number's chats into the same inbox.
 */
async function logoutEverywhere(provisioning: BridgeProvisioningClient, row: ChatMatrixAccountLogin): Promise<void> {
  const whoami = await provisioning.whoami(row.mxid)
  const ids = new Set(whoami.logins.map((login) => login.id))
  if (row.userLoginId) ids.add(row.userLoginId)
  for (const id of ids) {
    try {
      await provisioning.logout(row.mxid, id)
    } catch (error) {
      if (!isGoneLogin(error)) throw error
    }
  }
}

function displayStep(step: BridgeLoginStep): 'qr' | 'code' | 'waiting' | null {
  if (step.kind === 'qr' || step.kind === 'code' || step.kind === 'waiting') return step.kind
  return null
}

export function createMatrixAccountConnector(deps: AccountConnectorDeps): ChatAccountConnector {
  return {
    id: 'matrix',

    networks() {
      return Object.keys(deps.config.provisioning ?? {})
    },

    supportsPersonalAccounts() {
      return Boolean(deps.config.doublePuppetAsToken) && Object.keys(deps.config.provisioning ?? {}).length > 0
    },

    async startLogin(ctx: ConnectorContext, account: ConnectorAccount, flow: Flow, input): Promise<ConnectorLoginStart> {
      const provisioning = provisioningFor(deps.config, account.network)
      if (!provisioning) return { kind: 'failed', reason: 'network_unavailable' }
      if (account.ownerType === 'user' && !deps.config.doublePuppetAsToken) {
        return { kind: 'failed', reason: 'network_unavailable' }
      }

      const row = await ensureLoginRow(deps, ctx.em, account)
      await ensureRegistered(deps, ctx.em, row)

      try {
        // Nothing half-done left behind: the attempt this one replaces, and any
        // login the identity still holds.
        await cancelPendingAtBridge(provisioning, row)
        row.pendingLogin = null
        await logoutEverywhere(provisioning, row)
        row.userLoginId = null
        await ctx.em.flush()

        let step = await provisioning.startLogin(row.mxid, flow === 'qr' ? 'qr' : 'phone')
        if (flow === 'phone') {
          const field = step.kind === 'input' ? step.fields.find((candidate) => candidate.type === 'phone_number') ?? step.fields[0] : null
          if (!field || !input.phoneNumber) {
            await provisioning.cancelLogin(row.mxid, step.loginId).catch(() => undefined)
            return { kind: 'failed', reason: 'unsupported_step' }
          }
          step = await provisioning.submitInput(row.mxid, step, { [field.id]: input.phoneNumber })
        }

        if (step.kind === 'complete') {
          row.userLoginId = step.userLoginId
          await ctx.em.flush()
          const profile = await remoteProfile(provisioning, row)
          return { kind: 'connected', remoteHandle: profile.phone, remoteName: profile.name }
        }
        const kind = displayStep(step)
        if (!kind) {
          await provisioning.cancelLogin(row.mxid, step.loginId).catch(() => undefined)
          logger.warn('the bridge asked for a login step Operis cannot show', {
            accountId: account.id,
            stepType: step.rawType,
          })
          return { kind: 'failed', reason: 'unsupported_step' }
        }

        const pending: ChatMatrixPendingLogin = {
          attemptId: randomUUID(),
          flow,
          processId: step.loginId,
          stepId: step.stepId,
          startedAt: new Date().toISOString(),
        }
        row.pendingLogin = pending
        await ctx.em.flush()

        await enqueueAccountLogin({
          tenantId: account.scope.tenantId,
          organizationId: account.scope.organizationId,
          accountId: account.id,
          attemptId: pending.attemptId,
        })

        return { kind: 'step', step: { flow, kind, data: step.data, attemptId: pending.attemptId } }
      } catch (error) {
        // An unreachable bridge, or anything that is not the bridge answering,
        // is the caller's "try again"; a login the bridge refused is a result.
        if (!(error instanceof MatrixError)) throw error
        const reason = failureReasonOf(error)
        if (reason === 'bridge_unreachable') throw error
        logger.info('the bridge refused to start a login', {
          accountId: account.id,
          reason,
          errcode: error.errcode ?? null,
          status: error.status,
        })
        return { kind: 'failed', reason }
      }
    },

    async cancelLogin(ctx: ConnectorContext, account: ConnectorAccount) {
      const row = await loadLoginRow(ctx.em, account)
      if (!row?.pendingLogin) return
      const provisioning = provisioningFor(deps.config, row.network)
      if (provisioning) await cancelPendingAtBridge(provisioning, row)
      row.pendingLogin = null
      await ctx.em.flush()
    },

    async logout(ctx: ConnectorContext, account: ConnectorAccount) {
      const row = await loadLoginRow(ctx.em, account)
      if (!row) return
      const provisioning = provisioningFor(deps.config, row.network)
      if (provisioning && row.registeredAt) {
        await cancelPendingAtBridge(provisioning, row)
        await logoutEverywhere(provisioning, row)
      }
      row.pendingLogin = null
      row.userLoginId = null
      row.bridgeState = 'LOGGED_OUT'
      row.lastStateAt = new Date()
      await ctx.em.flush()
    },

    async state(ctx: ConnectorContext, account: ConnectorAccount): Promise<ConnectorAccountState> {
      const row = await loadLoginRow(ctx.em, account)
      if (!row?.registeredAt) return { status: 'unknown' }
      const provisioning = provisioningFor(deps.config, row.network)
      if (!provisioning) return { status: 'unknown' }
      return readState(provisioning, ctx.em, row)
    },

    listChats(ctx: ConnectorContext, account: ConnectorAccount) {
      return listPersonalChats(deps, ctx, account)
    },

    moveChat(ctx: ConnectorContext, account: ConnectorAccount, chatId: string) {
      return movePersonalChat(deps, ctx, account, chatId)
    },
  }
}

/** The number and name WhatsApp reports for a finished login, for the account page. */
async function remoteProfile(
  provisioning: BridgeProvisioningClient,
  row: ChatMatrixAccountLogin,
): Promise<{ phone: string | null; name: string | null }> {
  try {
    const whoami = await provisioning.whoami(row.mxid)
    const login = whoami.logins.find((candidate) => candidate.id === row.userLoginId) ?? whoami.logins[0]
    return { phone: login?.phone ?? null, name: login?.profileName ?? login?.name ?? null }
  } catch (error) {
    logger.warn('could not read the profile of a new login', {
      accountId: row.accountId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { phone: null, name: null }
  }
}

/**
 * What the bridge says about the account now.
 *
 * `TRANSIENT_DISCONNECT` and `UNKNOWN_ERROR` are not a drop — the bridge
 * reconnects by itself and a notification for every network blip would train
 * people to ignore the real one. Only a login that is gone, or that WhatsApp
 * rejected, is.
 */
async function readState(
  provisioning: BridgeProvisioningClient,
  em: EntityManager,
  row: ChatMatrixAccountLogin,
): Promise<ConnectorAccountState> {
  const whoami = await provisioning.whoami(row.mxid)
  const login = whoami.logins.find((candidate) => candidate.id === row.userLoginId) ?? whoami.logins[0] ?? null
  row.bridgeState = login?.state ?? 'LOGGED_OUT'
  row.lastStateAt = new Date()
  if (login && !row.userLoginId) row.userLoginId = login.id
  await em.flush()

  if (!login) return { status: 'disconnected', reason: 'logged_out' }
  switch (login.state) {
    case 'BAD_CREDENTIALS':
      return { status: 'disconnected', reason: 'bad_credentials' }
    case 'LOGGED_OUT':
      return { status: 'disconnected', reason: 'logged_out' }
    case 'CONNECTED':
    case 'BACKFILLING':
    case 'CONNECTING':
    case 'TRANSIENT_DISCONNECT':
    case 'STARTING':
      return { status: 'connected', remoteHandle: login.phone, remoteName: login.profileName ?? login.name }
    default:
      return { status: 'unknown' }
  }
}

// ---------------------------------------------------------------------------
// The login driver — what the queue worker runs.
// ---------------------------------------------------------------------------

async function report(
  deps: LoginDriverDeps,
  scope: ChatScope,
  commandId: 'chat.accounts.recordLoginStep' | 'chat.accounts.markState',
  input: Record<string, unknown>,
): Promise<boolean> {
  const { result } = await deps.commandBus.execute<Record<string, unknown>, { applied: boolean }>(commandId, {
    input: { ...scope, ...input },
    ctx: systemContext(deps, scope),
  })
  return Boolean(result?.applied)
}

/**
 * Wait on the bridge until a login ends, passing each new code to chat.
 *
 * Resumable: every round re-reads the pending login, so a retried job picks up
 * the step the last one saw — and stops the moment its attempt is no longer
 * the current one, whether somebody cancelled it or started again.
 */
export async function driveAccountLogin(deps: LoginDriverDeps, job: AccountLoginJob): Promise<void> {
  const scope: ChatScope = { tenantId: job.tenantId, organizationId: job.organizationId }
  const deadline = Date.now() + LOGIN_DEADLINE_MS

  for (let round = 0; round < MAX_LOGIN_ROUNDS && Date.now() < deadline; round += 1) {
    const em = deps.em.fork()
    const row = await em.findOne(ChatMatrixAccountLogin, {
      accountId: job.accountId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    const pending = row?.pendingLogin
    if (!row || !pending || pending.attemptId !== job.attemptId) return

    const provisioning = provisioningFor(deps.config, row.network)
    if (!provisioning) {
      row.pendingLogin = null
      await em.flush()
      await report(deps, scope, 'chat.accounts.markState', {
        accountId: job.accountId,
        attemptId: job.attemptId,
        status: 'failed',
        reason: 'network_unavailable',
      })
      return
    }

    let step: BridgeLoginStep
    try {
      step = await provisioning.waitForStep(row.mxid, { loginId: pending.processId, stepId: pending.stepId })
    } catch (error) {
      const reason = failureReasonOf(error)
      // Re-read, not the row from before the wait: somebody may have cancelled
      // or restarted the login while this one was blocked on the bridge.
      const freshEm = deps.em.fork()
      const current = await freshEm.findOne(ChatMatrixAccountLogin, { id: row.id })
      if (current?.pendingLogin?.attemptId !== job.attemptId) return
      if (reason === 'bridge_unreachable' && Date.now() < deadline) {
        // The bridge restarting mid-login loses the login anyway; retrying the
        // wait tells us so with a real answer instead of a guess.
        await new Promise((resolve) => setTimeout(resolve, 2_000))
        continue
      }
      current.pendingLogin = null
      await freshEm.flush()
      if (reason !== 'cancelled') {
        logger.info('a messaging account login ended without connecting', { accountId: job.accountId, reason })
      }
      await report(deps, scope, 'chat.accounts.markState', {
        accountId: job.accountId,
        attemptId: job.attemptId,
        status: 'failed',
        reason,
      })
      return
    }

    if (step.kind === 'complete') {
      row.pendingLogin = null
      row.userLoginId = step.userLoginId
      await em.flush()
      const profile = await remoteProfile(provisioning, row)
      const applied = await report(deps, scope, 'chat.accounts.markState', {
        accountId: job.accountId,
        attemptId: job.attemptId,
        status: 'connected',
        remoteHandle: profile.phone,
        remoteName: profile.name,
      })
      if (!applied) {
        // Cancelled at the last second, after WhatsApp had already linked it.
        // Undo the link so Operis and the phone agree nothing is connected.
        await logoutEverywhere(provisioning, row).catch((error) => {
          logger.warn('could not undo a login that finished after it was cancelled', {
            accountId: job.accountId,
            error: error instanceof Error ? error.message : String(error),
          })
        })
        row.userLoginId = null
        await em.flush()
      }
      return
    }

    const kind = displayStep(step)
    if (!kind) {
      await provisioning.cancelLogin(row.mxid, step.loginId).catch(() => undefined)
      row.pendingLogin = null
      await em.flush()
      await report(deps, scope, 'chat.accounts.markState', {
        accountId: job.accountId,
        attemptId: job.attemptId,
        status: 'failed',
        reason: 'unsupported_step',
      })
      return
    }

    row.pendingLogin = { ...pending, processId: step.loginId, stepId: step.stepId }
    await em.flush()
    const applied = await report(deps, scope, 'chat.accounts.recordLoginStep', {
      accountId: job.accountId,
      step: { flow: pending.flow, kind, data: step.data, attemptId: job.attemptId },
    })
    if (!applied) {
      // Chat moved on — cancelled, or started over. Let the bridge go too.
      await provisioning.cancelLogin(row.mxid, step.loginId).catch(() => undefined)
      const freshEm = deps.em.fork()
      const current = await freshEm.findOne(ChatMatrixAccountLogin, { id: row.id })
      if (current?.pendingLogin?.attemptId === job.attemptId) {
        current.pendingLogin = null
        await freshEm.flush()
      }
      return
    }
  }

  // Out of time or rounds: end it rather than leave a code on screen forever.
  const em = deps.em.fork()
  const row = await em.findOne(ChatMatrixAccountLogin, {
    accountId: job.accountId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (!row?.pendingLogin || row.pendingLogin.attemptId !== job.attemptId) return
  const provisioning = provisioningFor(deps.config, row.network)
  if (provisioning) await cancelPendingAtBridge(provisioning, row).catch(() => undefined)
  row.pendingLogin = null
  await em.flush()
  await report(deps, scope, 'chat.accounts.markState', {
    accountId: job.accountId,
    attemptId: job.attemptId,
    status: 'failed',
    reason: 'timeout',
  })
}

/**
 * Ask the bridge how every connected account in one organization is doing, and
 * tell chat about any that dropped or came back. Run on the drift schedule.
 */
export async function checkAccountHealth(deps: LoginDriverDeps, scope: ChatScope): Promise<number> {
  const em = deps.em.fork()
  const rows = await em.find(ChatMatrixAccountLogin, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    registeredAt: { $ne: null },
    pendingLogin: null,
  })
  let changed = 0
  for (const row of rows) {
    const provisioning = provisioningFor(deps.config, row.network)
    if (!provisioning) continue
    let state: ConnectorAccountState
    try {
      state = await readState(provisioning, em, row)
    } catch (error) {
      logger.warn('could not read a messaging account state', {
        accountId: row.accountId,
        error: error instanceof Error ? error.message : String(error),
      })
      continue
    }
    if (state.status !== 'connected' && state.status !== 'disconnected') continue
    const applied = await report(deps, scope, 'chat.accounts.markState', {
      accountId: row.accountId,
      status: state.status,
      ...(state.status === 'disconnected' ? { reason: state.reason } : { remoteHandle: state.remoteHandle }),
    })
    if (applied) changed += 1
  }
  return changed
}
