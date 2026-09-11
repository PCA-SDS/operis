import type { CacheStrategy } from '@open-mercato/cache'

export type GdtAuthResult =
  | { kind: 'success'; token: string; expiresInSeconds?: number }
  | { kind: 'captcha_expired' }
  | { kind: 'bad_credentials' }
  | { kind: 'account_locked' }

export interface GdtClient {
  isConfigured(): boolean
  fetchCaptcha(): Promise<{ key: string; svg: string }>
  authenticate(input: { mst: string; password: string; captchaKey: string; captchaSolution: string }): Promise<GdtAuthResult>
}

export function createGdtClient(config: Record<string, unknown> = {}): GdtClient {
  const baseUrl = String(config.gdtBaseUrl ?? process.env.GDT_BASE_URL ?? '').replace(/\/$/, '')
  const captchaPath = String(config.gdtCaptchaPath ?? process.env.GDT_PATH_CAPTCHA ?? '/captcha')
  const authPath = String(config.gdtAuthPath ?? process.env.GDT_PATH_AUTHENTICATE ?? '/security-taxpayer/authenticate')
  const timeoutMs = Number(config.gdtTimeoutMs ?? process.env.GDT_REQUEST_TIMEOUT_MS ?? 15000)
  const request = async (url: string, init?: RequestInit) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try { return await fetch(url, { ...init, signal: controller.signal }) } finally { clearTimeout(timer) }
  }
  return {
    isConfigured: () => Boolean(baseUrl),
    async fetchCaptcha() {
      const response = await request(`${baseUrl}${captchaPath}`)
      if (!response.ok) throw new Error('[internal] GDT CAPTCHA unavailable')
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
      if (!response.ok) throw new Error('[internal] GDT authentication unavailable')
      const body = await response.json() as { token?: string; access_token?: string; expires_in?: number }
      const token = body.token ?? body.access_token
      if (!token) throw new Error('[internal] Invalid GDT authentication response')
      return { kind: 'success', token, expiresInSeconds: body.expires_in }
    },
  }
}

export async function cacheJson(cache: CacheStrategy, key: string, value: unknown, ttlSeconds: number) {
  await cache.set(key, value, { ttl: ttlSeconds * 1000 })
}
