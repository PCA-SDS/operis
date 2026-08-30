/**
 * The app's security response headers.
 *
 * They live here rather than inline in `next.config.ts` so the config and its
 * test read the same definition instead of a regex over the config's source —
 * the previous test scraped the file with `/const contentSecurityPolicy = \[/`,
 * which silently stops matching the moment a directive becomes conditional.
 */

/** Stripe's script and frame origins. Payment pages load js.stripe.com and
 *  render 3-D Secure in an iframe from hooks.stripe.com (issue #1606). */
const STRIPE_SCRIPT_ORIGIN = 'https://js.stripe.com'
const STRIPE_FRAME_ORIGINS = ['https://js.stripe.com', 'https://hooks.stripe.com']

/**
 * `'unsafe-eval'` is a DEVELOPMENT-ONLY concession.
 *
 * Next's dev server and React Refresh evaluate code at runtime, so dev cannot
 * load without it. A production bundle does not: the only `Function(...)` calls
 * in the built client are the `Function('return this')()` global-object
 * fallbacks inside core-js, decimal.js and lodash, and every one of them sits
 * behind a `globalThis` / `self` guard that a browser satisfies first, so the
 * call is never reached. Dropping it in production removes the primitive that
 * turns a string-injection bug into arbitrary script execution.
 *
 * `'unsafe-inline'` stays for now. Next's App Router streams hydration payloads
 * through inline `<script>` tags, so removing it needs a per-request nonce
 * plumbed through `src/proxy.ts` — a change that fails only at runtime, and
 * only in production, when it is wrong. Tracked separately.
 */
function scriptSrc(isDevelopment: boolean): string {
  return [
    "'self'",
    "'unsafe-inline'",
    ...(isDevelopment ? ["'unsafe-eval'"] : []),
    STRIPE_SCRIPT_ORIGIN,
  ].join(' ')
}

export function buildContentSecurityPolicy(isDevelopment: boolean): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "font-src 'self' data: https:",
    "form-action 'self'",
    "frame-ancestors 'self'",
    `frame-src 'self' ${STRIPE_FRAME_ORIGINS.join(' ')}`,
    "img-src 'self' data: blob: https:",
    "object-src 'none'",
    `script-src ${scriptSrc(isDevelopment)}`,
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' https: ws: wss:",
  ].join('; ')
}

/** One year, the value HSTS preload lists require and the usual production default. */
const DEFAULT_HSTS_MAX_AGE = 31536000

function parseMaxAge(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_HSTS_MAX_AGE
  const parsed = Number(raw.trim())
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_HSTS_MAX_AGE
  return Math.floor(parsed)
}

function isEnabled(raw: string | undefined): boolean {
  if (raw === undefined) return false
  const value = raw.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

export type HstsEnv = {
  OM_SECURITY_HSTS_MAX_AGE?: string
  OM_SECURITY_HSTS_INCLUDE_SUBDOMAINS?: string
  OM_SECURITY_HSTS_PRELOAD?: string
}

/**
 * `Strict-Transport-Security`, or `null` when it must not be sent.
 *
 * Off in development, where the app is served over plain HTTP and the header
 * would be meaningless (a browser ignores HSTS on an insecure origin anyway).
 *
 * `includeSubDomains` is OPT-IN, not the default, and that is deliberate: the
 * customer portal answers on tenant-supplied custom domains, and asserting HSTS
 * across every subdomain of the platform host would make any one of them that
 * is not yet on TLS unreachable — for a year, with no way for the operator to
 * take it back. `preload` is opt-in for the same reason, plus it is close to
 * irreversible once a domain is on the browser list.
 *
 * `OM_SECURITY_HSTS_MAX_AGE=0` disables the header outright, which is the
 * escape hatch for a deployment that terminates TLS somewhere else.
 */
export function buildStrictTransportSecurity(
  isDevelopment: boolean,
  env: HstsEnv = process.env as HstsEnv,
): string | null {
  if (isDevelopment) return null
  const maxAge = parseMaxAge(env.OM_SECURITY_HSTS_MAX_AGE)
  if (maxAge === 0) return null
  return [
    `max-age=${maxAge}`,
    ...(isEnabled(env.OM_SECURITY_HSTS_INCLUDE_SUBDOMAINS) ? ['includeSubDomains'] : []),
    ...(isEnabled(env.OM_SECURITY_HSTS_PRELOAD) ? ['preload'] : []),
  ].join('; ')
}

export type ResponseHeader = { key: string; value: string }

/** The headers every response carries, whatever the route renders. */
export function buildBaseSecurityHeaders(
  isDevelopment: boolean,
  env: HstsEnv = process.env as HstsEnv,
): ResponseHeader[] {
  const hsts = buildStrictTransportSecurity(isDevelopment, env)
  return [
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    ...(hsts ? [{ key: 'Strict-Transport-Security', value: hsts }] : []),
  ]
}
