import type { CacheStrategy } from '@open-mercato/cache'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { GdtProviderError } from './gdt/errors'
import type { GdtInvoicePage, GdtStream, GdtWireRecord } from './gdt/types'

const logger = createLogger('invoice').child({ component: 'gdt-client' })

export type GdtAuthResult =
  | { kind: 'success'; token: string; expiresInSeconds?: number; sessionCookie?: string }
  | { kind: 'captcha_expired' }
  | { kind: 'bad_credentials' }
  | { kind: 'account_locked' }

export interface GdtClient {
  isConfigured(): boolean
  portalUrl?: string | null
  fetchCaptcha(): Promise<{ key: string; svg: string; sessionCookie?: string }>
  authenticate(input: { mst: string; password: string; captchaKey: string; captchaSolution: string; sessionCookie?: string }): Promise<GdtAuthResult>
  fetchPage(input: {
    stream: GdtStream
    token: string
    fromDate: string
    toDate: string
    cursor?: string
    pageSize: number
  }): Promise<GdtInvoicePage>
}

export function createGdtClient(config: Record<string, unknown> = {}): GdtClient {
  const baseUrl = String(config.gdtBaseUrl ?? process.env.GDT_BASE_URL ?? '').replace(/\/$/, '')
  const queryBaseUrl = String(config.gdtQueryBaseUrl ?? process.env.GDT_QUERY_BASE_URL ?? baseUrl).replace(/\/$/, '')
  const captchaPath = String(config.gdtCaptchaPath ?? process.env.GDT_PATH_CAPTCHA ?? '/captcha')
  const authPath = String(config.gdtAuthPath ?? process.env.GDT_PATH_AUTHENTICATE ?? '/security-taxpayer/authenticate')
  const soldPath = String(config.gdtSoldPath ?? process.env.GDT_PATH_QUERY_SOLD ?? '/query/invoices/sold')
  const purchasedPath = String(config.gdtPurchasedPath ?? process.env.GDT_PATH_QUERY_PURCHASED ?? '/query/invoices/purchase')
  const timeoutMs = Number(config.gdtTimeoutMs ?? process.env.GDT_REQUEST_TIMEOUT_MS ?? 20000)
  const retryAttempts = Number(config.gdtRetryAttempts ?? process.env.GDT_MAX_RETRIES ?? 3)
  const retryBaseDelayMs = Number(config.gdtRetryBaseDelayMs ?? process.env.GDT_RETRY_BASE_DELAY_MS ?? 500)
  const request = async (url: string, init?: RequestInit, retry = init?.method !== 'POST') => {
    const requestMethod = init?.method ?? 'GET'
    const endpoint = safeEndpoint(url)
    let attempt = 0
    while (true) {
      attempt += 1
      const startedAt = Date.now()
      logger.debug('GDT request started', { endpoint, method: requestMethod, attempt, retry, timeoutMs })
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
          const response = await fetch(url, { ...init, signal: controller.signal })
          if (retry && (response.status === 429 || response.status >= 500) && attempt < retryAttempts) {
            const delayMs = retryBaseDelayMs * (2 ** (attempt - 1))
            logger.warn('GDT request retrying', { endpoint, method: requestMethod, attempt, status: response.status, delayMs, elapsedMs: Date.now() - startedAt })
            await new Promise((resolve) => setTimeout(resolve, delayMs))
            continue
          }
          logger.info('GDT request completed', { endpoint, method: requestMethod, attempt, status: response.status, ok: response.ok, elapsedMs: Date.now() - startedAt })
          return response
        } finally { clearTimeout(timer) }
      } catch (error) {
        const errorDetails = describeRequestError(error)
        if (!retry || attempt >= retryAttempts) {
          logger.error('GDT request failed', { endpoint, method: requestMethod, attempt, elapsedMs: Date.now() - startedAt, ...errorDetails })
          throw new GdtProviderError('network', 'GDT request failed', error)
        }
        const delayMs = retryBaseDelayMs * (2 ** (attempt - 1))
        logger.warn('GDT request network retry', { endpoint, method: requestMethod, attempt, delayMs, elapsedMs: Date.now() - startedAt, ...errorDetails })
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }
  return {
    isConfigured: () => Boolean(baseUrl),
    portalUrl: String(config.gdtPortalUrl ?? process.env.GDT_PORTAL_URL ?? '').trim() || null,
    async fetchCaptcha() {
      const response = await request(`${baseUrl}${captchaPath}`, { headers: { accept: 'application/json', 'user-agent': 'pca-erp-invoice-sync/1.0' } })
      if (!response.ok) throw new GdtProviderError(response.status === 401 ? 'auth' : 'provider', 'GDT CAPTCHA unavailable')
      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.includes('json')) {
        const body = await response.json() as { key?: string; captchaKey?: string; svg?: string; captchaSvg?: string; image?: string; data?: string; captcha?: string; content?: string }
        const image = body.svg ?? body.captchaSvg ?? body.image ?? body.data ?? body.captcha ?? body.content ?? ''
        if (!(body.key ?? body.captchaKey) || !image) throw new Error('[internal] Invalid GDT CAPTCHA response')
        return { key: body.key ?? body.captchaKey!, svg: image, sessionCookie: readSessionCookie(response.headers) }
      }
      const image = contentType.includes('svg') ? await response.text() : `data:${contentType || 'image/png'};base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`
      const captchaKey = response.headers.get('x-captcha-key') ?? response.headers.get('captcha-key')
      if (!captchaKey || !image) throw new Error('[internal] Invalid GDT CAPTCHA response')
      return { key: captchaKey, svg: image, sessionCookie: readSessionCookie(response.headers) }
    },
    async authenticate(input) {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'pca-erp-invoice-sync/1.0',
      }
      if (input.sessionCookie) headers.cookie = input.sessionCookie
      const response = await request(`${baseUrl}${authPath}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ username: input.mst, password: input.password, ckey: input.captchaKey, cvalue: input.captchaSolution }),
      })
      if (response.status === 423) return { kind: 'account_locked' }
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        const body = await response.json().catch(() => ({})) as { code?: string; errorCode?: string; message?: string; error?: string }
        const failureText = [body.code, body.errorCode, body.message, body.error].filter(Boolean).join(' ').toLowerCase()
        return /captcha|ckey|cvalue|verification/.test(failureText) ? { kind: 'captcha_expired' } : { kind: 'bad_credentials' }
      }
      if (!response.ok) throw new GdtProviderError(response.status === 401 ? 'auth' : 'provider', 'GDT authentication unavailable')
      const body = await response.json() as { token?: string; access_token?: string; expires_in?: number }
      const token = body.token ?? body.access_token
      if (!token) throw new Error('[internal] Invalid GDT authentication response')
      return { kind: 'success', token, expiresInSeconds: body.expires_in, sessionCookie: readSessionCookie(response.headers) ?? input.sessionCookie }
    },
    async fetchPage(input) {
      const path = input.stream === 'sold' ? soldPath : purchasedPath
      const dateClause = `tdlap=ge=${gdtDateTime(input.fromDate, 'start')};tdlap=le=${gdtDateTime(input.toDate, 'end')}`
      const search = input.stream === 'purchased' ? `${dateClause};ttxly==5` : dateClause
      const query = new URLSearchParams({
        search,
        size: String(input.pageSize),
        sort: 'tdlap:desc',
      })
      if (input.cursor) query.set('state', input.cursor)
      logger.debug('GDT invoice request prepared', { stream: input.stream, endpoint: path, fromDate: input.fromDate, toDate: input.toDate, search, size: input.pageSize, sort: 'tdlap:desc', hasCursor: Boolean(input.cursor) })
      const response = await request(`${queryBaseUrl}${path}?${query.toString()}`, {
        headers: { authorization: `Bearer ${input.token}`, accept: 'application/json', 'user-agent': 'pca-erp-invoice-sync/1.0' },
      }, true)
      if (response.status === 401) throw new GdtProviderError('auth', 'GDT token rejected')
      if (response.status === 423) throw new GdtProviderError('account_locked', 'GDT account is locked')
      if (!response.ok) throw new GdtProviderError(response.status === 429 || response.status >= 500 ? 'network' : 'provider', 'GDT invoice request failed')
      let body: unknown
      try { body = await response.json() } catch (error) { throw new GdtProviderError('invalid_response', 'Invalid GDT invoice response', error) }
      if (!body || typeof body !== 'object') throw new GdtProviderError('invalid_response', 'Invalid GDT invoice response')
      const record = body as Record<string, unknown>
      const rows = record.datas ?? record.items ?? record.data ?? record.records ?? record.content
      if (!Array.isArray(rows)) throw new GdtProviderError('invalid_response', 'GDT invoice response has no records')
      const nextCursor = typeof record.state === 'string' && record.state.length > 0 ? record.state : undefined
      logger.info('GDT invoice page parsed', { stream: input.stream, endpoint: path, fromDate: input.fromDate, toDate: input.toDate, pageSize: input.pageSize, hasCursor: Boolean(input.cursor), itemCount: rows.length, total: typeof record.total === 'number' ? record.total : undefined, responseTimeMs: typeof record.time === 'number' ? record.time : undefined, hasNextCursor: Boolean(nextCursor), stateLength: nextCursor?.length ?? 0 })
      return {
        items: rows as GdtWireRecord[],
        nextCursor,
      }
    },
  }
}

function safeEndpoint(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return '[invalid-url]'
  }
}

function describeRequestError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { errorType: typeof error, errorMessage: String(error) }
  const candidate = error as Error & { code?: unknown; cause?: unknown }
  const cause = candidate.cause instanceof Error ? candidate.cause : null
  return {
    errorName: error.name,
    errorMessage: error.message,
    errorCode: typeof candidate.code === 'string' ? candidate.code : undefined,
    causeName: cause?.name,
    causeMessage: cause?.message,
  }
}

function readSessionCookie(headers: Headers): string | undefined {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  const values = typeof getSetCookie === 'function' ? getSetCookie.call(headers) : [headers.get('set-cookie') ?? '']
  const cookies = values
    .flatMap((value) => value.split(/,(?=[^;,\s]+=)/))
    .map((value) => value.split(';', 1)[0]?.trim() ?? '')
    .filter(Boolean)
  return cookies.length > 0 ? cookies.join('; ') : undefined
}

function gdtDateTime(value: string, edge: 'start' | 'end'): string {
  const [year, month, day] = value.split('-')
  if (!year || !month || !day || !/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) {
    throw new Error('[internal] Invalid GDT date window')
  }
  return `${day}/${month}/${year}T${edge === 'start' ? '00:00:00' : '23:59:59'}`
}

export async function cacheJson(cache: CacheStrategy, key: string, value: unknown, ttlSeconds: number) {
  await cache.set(key, value, { ttl: ttlSeconds * 1000 })
}
