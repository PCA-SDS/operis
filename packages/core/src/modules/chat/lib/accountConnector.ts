import type { EntityManager } from '@mikro-orm/postgresql'
import type { ChatAccountLoginFlow, ChatAccountLoginStep, ChatMessagingAccountOwner } from '../data/entities'
import type { ChatScope } from './scope'

/**
 * Where a messaging account is connected — the seam that keeps chat free of any
 * idea of how a WhatsApp number logs in.
 *
 * Like `chatTransport`, chat registers a local default under the
 * `chatAccountConnector` DI token and `chat_matrix` replaces it with one backed
 * by the bridges' provisioning API when a bridge is configured. Chat keeps the
 * business facts — owner, team, status, what the connect page shows — and
 * everything network-shaped stays behind this interface.
 */

/** The account as a connector needs it. */
export type ConnectorAccount = {
  id: string
  network: string
  ownerType: ChatMessagingAccountOwner
  /** The employee a personal account belongs to; null for a company account. */
  ownerUserId: string | null
  scope: ChatScope
}

export type ConnectorContext = {
  em: EntityManager
  container: unknown
}

/**
 * What starting a login produced: a step to show, or an outcome already.
 *
 * A step carries the attempt id the connector minted. The connector reports
 * later steps and the outcome through `chat.accounts.recordLoginStep` and
 * `chat.accounts.markState` under that same id, and chat drops any report whose
 * attempt is no longer the current one.
 */
export type ConnectorLoginStart =
  | { kind: 'step'; step: Omit<ChatAccountLoginStep, 'updatedAt'> }
  | { kind: 'connected'; remoteHandle: string | null; remoteName: string | null }
  | { kind: 'failed'; reason: ChatAccountFailureReason }

/** How the network sees the account right now. */
export type ConnectorAccountState =
  | { status: 'connected'; remoteHandle: string | null; remoteName: string | null }
  | { status: 'connecting' }
  | { status: 'disconnected'; reason: ChatAccountFailureReason }
  | { status: 'unknown' }

/**
 * Stable codes the account page translates. A connector maps whatever its
 * network reports onto these; anything else is `error`.
 */
export type ChatAccountFailureReason =
  | 'no_connector'
  | 'network_unavailable'
  | 'timeout'
  | 'cancelled'
  | 'unsupported_step'
  | 'invalid_phone_number'
  | 'rate_limited'
  | 'logged_out'
  | 'bad_credentials'
  | 'bridge_unreachable'
  | 'already_connected_elsewhere'
  | 'error'

/**
 * One chat on a personal account, as the "move to the company" picker lists
 * it: what to call it and nothing else — never a message. Read live, never
 * stored.
 */
export type ConnectorChat = {
  /** The connector's handle for the chat; opaque to chat. */
  id: string
  name: string
  kind: 'direct' | 'group'
  /** Already moved: it is an Operis conversation. */
  conversationId: string | null
}

export type ChatAccountConnector = {
  id: string
  /** Networks an account can be connected on in this deployment, e.g. `['whatsapp']`. */
  networks(): string[]
  /** Whether personal accounts can be connected here. */
  supportsPersonalAccounts(): boolean
  startLogin(
    ctx: ConnectorContext,
    account: ConnectorAccount,
    flow: ChatAccountLoginFlow,
    input: { phoneNumber?: string | null },
  ): Promise<ConnectorLoginStart>
  /** Abandon a login in progress. Converges when there is none. */
  cancelLogin(ctx: ConnectorContext, account: ConnectorAccount): Promise<void>
  /** Log the account out of its network. Converges when it is not logged in. */
  logout(ctx: ConnectorContext, account: ConnectorAccount): Promise<void>
  state(ctx: ConnectorContext, account: ConnectorAccount): Promise<ConnectorAccountState>
  /** A connected personal account's chats. Empty where the connector has none to show. */
  listChats(ctx: ConnectorContext, account: ConnectorAccount): Promise<ConnectorChat[]>
  /**
   * Bring one of a personal account's chats into Operis, from this moment on:
   * nothing said before it is read. Idempotent — moving a moved chat returns
   * its conversation. Null when the chat is not one of the account's.
   */
  moveChat(
    ctx: ConnectorContext,
    account: ConnectorAccount,
    chatId: string,
  ): Promise<{ conversationId: string } | null>
}

/** No messaging network is reachable from a deployment without a bridge. */
export const localAccountConnector: ChatAccountConnector = {
  id: 'local',
  networks: () => [],
  supportsPersonalAccounts: () => false,
  async startLogin() {
    return { kind: 'failed', reason: 'no_connector' }
  },
  async cancelLogin() {},
  async logout() {},
  async state() {
    return { status: 'unknown' }
  },
  async listChats() {
    return []
  },
  async moveChat() {
    return null
  },
}

export function resolveChatAccountConnector(container: unknown): ChatAccountConnector {
  const cradle = container as { resolve?: (name: string) => unknown; hasRegistration?: (name: string) => boolean }
  if (typeof cradle.hasRegistration === 'function' && !cradle.hasRegistration('chatAccountConnector')) {
    return localAccountConnector
  }
  // A registration that fails to resolve is a broken deployment, not "no
  // bridge", so it throws here rather than reading as "not available".
  return (cradle.resolve?.('chatAccountConnector') as ChatAccountConnector | undefined) ?? localAccountConnector
}
