import type { CacheStrategy } from '@open-mercato/cache'
import { GdtProviderError } from './gdt/errors'
import type { GdtInvoicePage, GdtStream, GdtWireRecord } from './gdt/types'

export type GdtAuthResult =
  | { kind: 'success'; token: string; expiresInSeconds?: number }
  | { kind: 'captcha_expired' }
  | { kind: 'bad_credentials' }
  | { kind: 'account_locked' }

export interface GdtClient {
  isConfigured(): boolean
  fetchCaptcha(): Promise<{ key: string; svg: string }>
  authenticate(input: { mst: string; password: string; captchaKey: string; captchaSolution: string }): Promise<GdtAuthResult>
  fetchPage(input: {
    stream: GdtStream
    token: string
    fromDate: string
    toDate: string
    page: number
    pageSize: number
  }): Promise<GdtInvoicePage>
}

export function createGdtClient(config: Record<string, unknown> = {}): GdtClient {
  const baseUrl = String(config.gdtBaseUrl ?? process.env.GDT_BASE_URL ?? '').replace(/\/$/, '')
  const captchaPath = String(config.gdtCaptchaPath ?? process.env.GDT_PATH_CAPTCHA ?? '/captcha')
  const authPath = String(config.gdtAuthPath ?? process.env.GDT_PATH_AUTHENTICATE ?? '/security-taxpayer/authenticate')
  const soldPath = String(config.gdtSoldPath ?? process.env.GDT_PATH_SOLD ?? '/invoice/sold')
  const purchasedPath = String(config.gdtPurchasedPath ?? process.env.GDT_PATH_PURCHASED ?? '/invoice/purchased')
  const timeoutMs = Number(config.gdtTimeoutMs ?? process.env.GDT_REQUEST_TIMEOUT_MS ?? 15000)
  const retryAttempts = Number(config.gdtRetryAttempts ?? process.env.GDT_RETRY_ATTEMPTS ?? 3)
  const retryBaseDelayMs = Number(config.gdtRetryBaseDelayMs ?? process.env.GDT_RETRY_BASE_DELAY_MS ?? 250)
  const request = async (url: string, init?: RequestInit, retry = false) => {
    let attempt = 0
    while (true) {
      attempt += 1
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
          const response = await fetch(url, { ...init, signal: controller.signal })
          if (retry && (response.status === 429 || response.status >= 500) && attempt < retryAttempts) {
            await new Promise((resolve) => setTimeout(resolve, retryBaseDelayMs * (2 ** (attempt - 1))))
            continue
          }
          return response
        } finally { clearTimeout(timer) }
      } catch (error) {
        if (!retry || attempt >= retryAttempts) throw new GdtProviderError('network', 'GDT request failed', error)
        await new Promise((resolve) => setTimeout(resolve, retryBaseDelayMs * (2 ** (attempt - 1))))
      }
    }
  }
  return {
    isConfigured: () => Boolean(baseUrl),
    async fetchCaptcha() {
      const response = await request(`${baseUrl}${captchaPath}`)
      if (!response.ok) throw new GdtProviderError(response.status === 401 ? 'auth' : 'provider', 'GDT CAPTCHA unavailable')
      const body = await response.json() as { key?: string; captchaKey?: string; svg?: string; captchaSvg?: string }
      if (!body.key && !body.captchaKey) throw new Error('[internal] Invalid GDT CAPTCHA response')
      return { key: body.key ?? body.captchaKey!, svg: body.svg ?? body.captchaSvg ?? '' }
    },
    async authenticate(input) {
      const response = await request(`${baseUrl}${authPath}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: input.mst, password: input.password, ckey: input.captchaKey, cvalue: input.captchaSolution }),
      })
      if (response.status === 423) return { kind: 'account_locked' }
      if (response.status === 401 || response.status === 400) {
        const body = await response.json().catch(() => ({})) as { code?: string }
        return String(body.code ?? '').toLowerCase().includes('captcha') ? { kind: 'captcha_expired' } : { kind: 'bad_credentials' }
      }
      if (!response.ok) throw new GdtProviderError(response.status === 401 ? 'auth' : 'provider', 'GDT authentication unavailable')
      const body = await response.json() as { token?: string; access_token?: string; expires_in?: number }
      const token = body.token ?? body.access_token
      if (!token) throw new Error('[internal] Invalid GDT authentication response')
      return { kind: 'success', token, expiresInSeconds: body.expires_in }
    },
    async fetchPage(input) {
      const path = input.stream === 'sold' ? soldPath : purchasedPath
      const query = new URLSearchParams({
        fromDate: input.fromDate,
        toDate: input.toDate,
        page: String(input.page),
        pageSize: String(input.pageSize),
      })
      const response = await request(`${baseUrl}${path}?${query.toString()}`, {
        headers: { authorization: `Bearer ${input.token}`, accept: 'application/json' },
      }, true)
      if (response.status === 401) throw new GdtProviderError('auth', 'GDT token rejected')
      if (response.status === 423) throw new GdtProviderError('account_locked', 'GDT account is locked')
      if (!response.ok) throw new GdtProviderError(response.status === 429 || response.status >= 500 ? 'network' : 'provider', 'GDT invoice request failed')
      let body: unknown
      try { body = await response.json() } catch (error) { throw new GdtProviderError('invalid_response', 'Invalid GDT invoice response', error) }
      if (!body || typeof body !== 'object') throw new GdtProviderError('invalid_response', 'Invalid GDT invoice response')
      const record = body as Record<string, unknown>
      const rows = record.items ?? record.data ?? record.records ?? record.content
      if (!Array.isArray(rows)) throw new GdtProviderError('invalid_response', 'GDT invoice response has no records')
      return {
        items: rows as GdtWireRecord[],
        hasNext: record.hasNext === true || record.has_next === true || Number(record.totalPages ?? record.total_pages ?? 0) > input.page,
      }
    },
  }
}

export async function cacheJson(cache: CacheStrategy, key: string, value: unknown, ttlSeconds: number) {
  await cache.set(key, value, { ttl: ttlSeconds * 1000 })
}
