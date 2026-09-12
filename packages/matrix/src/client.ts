import { createLogger } from '@open-mercato/shared/lib/logger'
import type { MatrixConfig } from './config'
import { MatrixError, classifyMatrixFailure } from './errors'
import { assertMasqueradable, botMxid, senderMxid } from './identity'
import { type MatrixEvent, parseMatrixEvent } from './events'

const logger = createLogger('matrix')

const DEFAULT_TIMEOUT_MS = 30_000
/** A long-polling `/sync` holds the connection open by design. */
const SYNC_TIMEOUT_HEADROOM_MS = 30_000

/**
 * Nothing this client asks for is legitimately larger than this. A homeserver
 * that answers a `/messages` page with 16MB is either misconfigured or hostile,
 * and streaming it into memory to find out is the failure we are avoiding.
 * Media downloads bypass this and stream to the caller instead.
 */
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024

export type RequestOptions = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  /** Act as this Matrix user. Must be inside the appservice namespace. */
  asUser?: string
  timeoutMs?: number
  signal?: AbortSignal
  /**
   * Retry transient failures internally.
   *
   * Off by default, and that default is load-bearing: `POST /createRoom` is not
   * idempotent, so a retry after a timeout can leave two rooms behind for one
   * conversation. Only turned on for calls that are safe to repeat — GETs, and
   * writes carrying a Matrix transaction id.
   */
  retry?: boolean
}

export type SendEventResult = { event_id: string }
export type WhoamiResult = { user_id: string; device_id?: string }
export type CreateRoomResult = { room_id: string }
export type MessagesPage = { chunk: MatrixEvent[]; start: string; end?: string }
export type RelationsPage = { chunk: MatrixEvent[]; next_batch?: string }
export type UploadResult = { content_uri: string }

export type SyncResult = {
  next_batch: string
  rooms?: {
    join?: Record<string, { timeline?: { events?: unknown[]; limited?: boolean; prev_batch?: string } }>
    invite?: Record<string, unknown>
    leave?: Record<string, unknown>
  }
}

export type CreateRoomOptions = {
  name?: string
  topic?: string
  isDirect?: boolean
  invite?: string[]
  preset?: 'private_chat' | 'trusted_private_chat' | 'public_chat'
  powerLevels?: Record<string, unknown>
  creationContent?: Record<string, unknown>
}

const RETRY_BACKOFF_MS = [500, 2000, 5000]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function retryAfterMs(response: Response, payload: unknown): number | undefined {
  if (payload && typeof payload === 'object' && 'retry_after_ms' in payload) {
    const value = (payload as { retry_after_ms?: unknown }).retry_after_ms
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  }
  const header = response.headers.get('retry-after')
  if (!header) return undefined
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined
}

/**
 * Read a response body with a hard ceiling, checking as it streams.
 *
 * `content-length` alone is not enough — it is advisory and a chunked response
 * omits it — so the running total is what actually enforces the limit.
 */
async function readBounded(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > MAX_RESPONSE_BYTES) {
    throw new MatrixError({
      message: '[internal] Matrix response exceeded the maximum accepted size',
      kind: 'permanent',
      status: response.status,
    })
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new MatrixError({
        message: '[internal] Matrix response exceeded the maximum accepted size',
        kind: 'permanent',
        status: response.status,
      })
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export class MatrixClient {
  private readonly config: MatrixConfig

  constructor(config: MatrixConfig) {
    this.config = config
  }

  get serverName(): string {
    return this.config.serverName
  }

  /** The appservice's own user. Cannot `/sync` — see {@link botUserId}. */
  get senderUserId(): string {
    return senderMxid(this.config)
  }

  /** The namespaced user that reads timelines and owns rooms. */
  get botUserId(): string {
    return botMxid(this.config)
  }

  private buildUrl(options: Pick<RequestOptions, 'path' | 'query' | 'asUser'>, asUser?: string): string {
    const url = new URL(`${this.config.baseUrl}${options.path}`)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined) continue
      url.searchParams.set(key, String(value))
    }
    if (asUser) url.searchParams.set('user_id', asUser)
    return url.toString()
  }

  async request<T>(options: RequestOptions): Promise<T> {
    const attempts = options.retry ? RETRY_BACKOFF_MS.length + 1 : 1
    let lastError: MatrixError | null = null

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.requestOnce<T>(options)
      } catch (error) {
        if (!(error instanceof MatrixError) || !error.isTransient) throw error
        lastError = error
        if (attempt === attempts - 1) break
        const wait = error.retryAfterMs ?? RETRY_BACKOFF_MS[attempt]
        logger.warn('retrying transient Matrix failure', {
          path: options.path,
          status: error.status,
          attempt: attempt + 1,
          waitMs: wait,
        })
        await sleep(wait)
      }
    }
    throw lastError
  }

  private async requestOnce<T>(options: RequestOptions): Promise<T> {
    // Every masquerade goes through the namespace gate. Placed here rather than
    // in each method so a new method cannot forget it.
    const asUser = options.asUser ? assertMasqueradable(this.config, options.asUser) : undefined
    const url = this.buildUrl(options, asUser)

    const controller = new AbortController()
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    if (options.signal) {
      if (options.signal.aborted) controller.abort()
      else options.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }

    let response: Response
    try {
      response = await fetch(url, {
        method: options.method,
        headers: {
          // Header, never a query parameter: a token in a URL is a token in
          // every access log and every error report along the way.
          authorization: `Bearer ${this.config.asToken}`,
          accept: 'application/json',
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        // A homeserver has no business redirecting an API call, and following
        // one would replay the bearer token at a location we did not choose.
        redirect: 'manual',
        signal: controller.signal,
      })
    } catch (error) {
      const aborted = controller.signal.aborted
      throw new MatrixError({
        message: aborted
          ? '[internal] Matrix request timed out'
          : '[internal] Matrix request failed before a response was received',
        kind: 'transient',
        status: 0,
        cause: error,
      })
    } finally {
      clearTimeout(timer)
    }

    if (response.status >= 300 && response.status < 400) {
      throw new MatrixError({
        message: '[internal] Matrix homeserver returned a redirect, which is not followed',
        kind: 'permanent',
        status: response.status,
      })
    }

    const text = await readBounded(response)
    let payload: unknown = null
    if (text.length > 0) {
      try {
        payload = JSON.parse(text)
      } catch {
        payload = null
      }
    }

    if (!response.ok) {
      const errcode =
        payload && typeof payload === 'object' && 'errcode' in payload
          ? String((payload as { errcode?: unknown }).errcode)
          : undefined
      const detail =
        payload && typeof payload === 'object' && 'error' in payload
          ? String((payload as { error?: unknown }).error)
          : text.slice(0, 200)
      throw new MatrixError({
        message: `[internal] Matrix ${options.method} ${options.path} failed: ${response.status} ${errcode ?? ''} ${detail}`.trim(),
        kind: classifyMatrixFailure(response.status, errcode),
        status: response.status,
        errcode,
        retryAfterMs: retryAfterMs(response, payload),
      })
    }

    return (payload ?? {}) as T
  }

  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------

  whoami(): Promise<WhoamiResult> {
    return this.request({ method: 'GET', path: '/_matrix/client/v3/account/whoami', retry: true })
  }

  /**
   * Create a namespaced user.
   *
   * Appservice users are not created implicitly — the first call as an
   * unregistered id fails — so this runs before a user's first write. Treating
   * `M_USER_IN_USE` as success makes it safe to call unconditionally, which is
   * simpler and cheaper than tracking who has been registered.
   */
  async registerUser(localpart: string): Promise<void> {
    try {
      await this.request({
        method: 'POST',
        path: '/_matrix/client/v3/register',
        body: { type: 'm.login.application_service', username: localpart },
      })
    } catch (error) {
      if (error instanceof MatrixError && error.errcode === 'M_USER_IN_USE') return
      throw error
    }
  }

  setDisplayName(userId: string, displayName: string): Promise<void> {
    return this.request({
      method: 'PUT',
      path: `/_matrix/client/v3/profile/${encodeURIComponent(userId)}/displayname`,
      body: { displayname: displayName },
      asUser: userId,
      retry: true,
    })
  }

  // -------------------------------------------------------------------------
  // Rooms
  // -------------------------------------------------------------------------

  /**
   * Not retried, and not idempotent.
   *
   * A retry after a timeout would create a second room for one conversation,
   * and the caller cannot tell the two apart afterwards. Recovery belongs one
   * level up, where the conversation-to-room mapping is unique and can be
   * consulted before trying again.
   */
  createRoom(options: CreateRoomOptions, asUser: string): Promise<CreateRoomResult> {
    return this.request({
      method: 'POST',
      path: '/_matrix/client/v3/createRoom',
      asUser,
      body: {
        preset: options.preset ?? 'private_chat',
        ...(options.name === undefined ? {} : { name: options.name }),
        ...(options.topic === undefined ? {} : { topic: options.topic }),
        ...(options.isDirect === undefined ? {} : { is_direct: options.isDirect }),
        ...(options.invite === undefined ? {} : { invite: options.invite }),
        ...(options.powerLevels === undefined
          ? {}
          : { power_level_content_override: options.powerLevels }),
        ...(options.creationContent === undefined
          ? {}
          : { creation_content: options.creationContent }),
      },
    })
  }

  invite(roomId: string, userId: string, asUser: string): Promise<void> {
    return this.request({
      method: 'POST',
      path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`,
      body: { user_id: userId },
      asUser,
      retry: true,
    })
  }

  join(roomId: string, asUser: string): Promise<{ room_id: string }> {
    return this.request({
      method: 'POST',
      path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/join`,
      body: {},
      asUser,
      retry: true,
    })
  }

  leave(roomId: string, asUser: string): Promise<void> {
    return this.request({
      method: 'POST',
      path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/leave`,
      body: {},
      asUser,
      retry: true,
    })
  }

  kick(roomId: string, userId: string, asUser: string, reason?: string): Promise<void> {
    return this.request({
      method: 'POST',
      path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/kick`,
      body: { user_id: userId, ...(reason === undefined ? {} : { reason }) },
      asUser,
      retry: true,
    })
  }

  joinedMembers(roomId: string, asUser: string): Promise<{ joined: Record<string, unknown> }> {
    return this.request({
      method: 'GET',
      path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members`,
      asUser,
      retry: true,
    })
  }

  getStateEvent<T>(roomId: string, eventType: string, stateKey: string, asUser: string): Promise<T> {
    return this.request({
      method: 'GET',
      path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(eventType)}/${encodeURIComponent(stateKey)}`,
      asUser,
      retry: true,
    })
  }

  setStateEvent(
    roomId: string,
    eventType: string,
    stateKey: string,
    content: Record<string, unknown>,
    asUser: string,
  ): Promise<SendEventResult> {
    return this.request({
      method: 'PUT',
      path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(eventType)}/${encodeURIComponent(stateKey)}`,
      body: content,
      asUser,
      retry: true,
    })
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  /**
   * Send an event under a caller-chosen transaction id.
   *
   * The transaction id is what makes this safe to retry: the homeserver returns
   * the ORIGINAL event id for a repeated one rather than posting a duplicate, so
   * an at-least-once delivery becomes exactly-once at the room. Derive it from a
   * stable Operis identifier, never randomly, or the guarantee is lost.
   */
  sendEvent(params: {
    roomId: string
    eventType: string
    transactionId: string
    content: Record<string, unknown>
    asUser: string
  }): Promise<SendEventResult> {
    return this.request({
      method: 'PUT',
      path: `/_matrix/client/v3/rooms/${encodeURIComponent(params.roomId)}/send/${encodeURIComponent(params.eventType)}/${encodeURIComponent(params.transactionId)}`,
      body: params.content,
      asUser: params.asUser,
      retry: true,
    })
  }

  redact(params: {
    roomId: string
    eventId: string
    transactionId: string
    asUser: string
    reason?: string
  }): Promise<SendEventResult> {
    return this.request({
      method: 'PUT',
      path: `/_matrix/client/v3/rooms/${encodeURIComponent(params.roomId)}/redact/${encodeURIComponent(params.eventId)}/${encodeURIComponent(params.transactionId)}`,
      body: params.reason === undefined ? {} : { reason: params.reason },
      asUser: params.asUser,
      retry: true,
    })
  }

  async getEvent(roomId: string, eventId: string, asUser: string): Promise<MatrixEvent | null> {
    const raw = await this.request<unknown>({
      method: 'GET',
      path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`,
      asUser,
      retry: true,
    })
    return parseMatrixEvent(raw)
  }

  async messages(
    roomId: string,
    params: { from?: string; to?: string; dir?: 'b' | 'f'; limit?: number },
    asUser: string,
  ): Promise<MessagesPage> {
    const page = await this.request<{ chunk?: unknown[]; start: string; end?: string }>({
      method: 'GET',
      path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`,
      query: {
        from: params.from,
        to: params.to,
        dir: params.dir ?? 'b',
        limit: params.limit ?? 30,
      },
      asUser,
      retry: true,
    })
    return {
      chunk: (page.chunk ?? []).map(parseMatrixEvent).filter((e): e is MatrixEvent => e !== null),
      start: page.start,
      end: page.end,
    }
  }

  async relations(
    roomId: string,
    eventId: string,
    asUser: string,
    relType?: string,
  ): Promise<RelationsPage> {
    const suffix = relType ? `/${encodeURIComponent(relType)}` : ''
    const page = await this.request<{ chunk?: unknown[]; next_batch?: string }>({
      method: 'GET',
      path: `/_matrix/client/v1/rooms/${encodeURIComponent(roomId)}/relations/${encodeURIComponent(eventId)}${suffix}`,
      asUser,
      retry: true,
    })
    return {
      chunk: (page.chunk ?? []).map(parseMatrixEvent).filter((e): e is MatrixEvent => e !== null),
      next_batch: page.next_batch,
    }
  }

  // -------------------------------------------------------------------------
  // Presence of mind: receipts and typing
  // -------------------------------------------------------------------------

  sendReceipt(
    roomId: string,
    eventId: string,
    asUser: string,
    receiptType: 'm.read' | 'm.read.private' = 'm.read',
  ): Promise<void> {
    return this.request({
      method: 'POST',
      path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/receipt/${encodeURIComponent(receiptType)}/${encodeURIComponent(eventId)}`,
      body: {},
      asUser,
      retry: true,
    })
  }

  setReadMarkers(
    roomId: string,
    params: { fullyRead: string; read?: string },
    asUser: string,
  ): Promise<void> {
    return this.request({
      method: 'POST',
      path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/read_markers`,
      body: {
        'm.fully_read': params.fullyRead,
        ...(params.read === undefined ? {} : { 'm.read': params.read }),
      },
      asUser,
      retry: true,
    })
  }

  setTyping(roomId: string, asUser: string, typing: boolean, timeoutMs = 20_000): Promise<void> {
    return this.request({
      method: 'PUT',
      path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(asUser)}`,
      body: typing ? { typing: true, timeout: timeoutMs } : { typing: false },
      asUser,
      // Typing is a hint with a short lifetime. Retrying a stale one is worse
      // than dropping it.
      retry: false,
    })
  }

  // -------------------------------------------------------------------------
  // Media
  // -------------------------------------------------------------------------

  uploadMedia(params: {
    body: Uint8Array
    contentType: string
    fileName?: string
    asUser: string
  }): Promise<UploadResult> {
    const asUser = assertMasqueradable(this.config, params.asUser)
    const url = new URL(`${this.config.baseUrl}/_matrix/media/v3/upload`)
    if (params.fileName) url.searchParams.set('filename', params.fileName)
    url.searchParams.set('user_id', asUser)

    return (async () => {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.asToken}`,
          'content-type': params.contentType,
        },
        // TypeScript 5.7 made `ArrayBufferView` generic, so `BodyInit` now wants
        // `ArrayBufferView<ArrayBuffer>` while `Buffer` — what a caller reading a
        // file actually holds — is `Uint8Array<ArrayBufferLike>`. The value is a
        // valid request body at runtime; copying it into a fresh ArrayBuffer just
        // to satisfy the variance would duplicate an attachment that may be
        // hundreds of megabytes.
        body: params.body as BodyInit,
        redirect: 'manual',
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS * 4),
      })
      const text = await readBounded(response)
      if (!response.ok) {
        throw new MatrixError({
          message: `[internal] Matrix media upload failed: ${response.status} ${text.slice(0, 200)}`,
          kind: classifyMatrixFailure(response.status),
          status: response.status,
        })
      }
      return JSON.parse(text) as UploadResult
    })()
  }

  /**
   * Streamed rather than buffered — the response ceiling that protects JSON
   * calls would be exactly wrong here, where a 200MB attachment is legitimate.
   * The caller decides what to do with the body.
   */
  async downloadMedia(serverName: string, mediaId: string): Promise<Response> {
    const url = `${this.config.baseUrl}/_matrix/client/v1/media/download/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${this.config.asToken}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS * 4),
    })
    if (!response.ok) {
      throw new MatrixError({
        message: `[internal] Matrix media download failed: ${response.status}`,
        kind: classifyMatrixFailure(response.status),
        status: response.status,
      })
    }
    return response
  }

  // -------------------------------------------------------------------------
  // Sync
  // -------------------------------------------------------------------------

  /**
   * Incremental read.
   *
   * Runs as the namespaced bot by default because Synapse refuses `/sync` for
   * the appservice's own sender (matrix-doc#1144). `filter` should be a narrowed
   * server-side filter — an unfiltered initial sync returns full room state for
   * every joined room, which is megabytes to parse and discard.
   */
  sync(params: {
    since?: string | null
    timeoutMs?: number
    filter?: string
    asUser?: string
  }): Promise<SyncResult> {
    const timeout = params.timeoutMs ?? 0
    return this.request({
      method: 'GET',
      path: '/_matrix/client/v3/sync',
      query: {
        since: params.since ?? undefined,
        timeout,
        filter: params.filter,
      },
      asUser: params.asUser ?? this.botUserId,
      // The request must outlive the long poll it asked the server to hold.
      timeoutMs: timeout + SYNC_TIMEOUT_HEADROOM_MS,
      retry: true,
    })
  }
}
