import fs from 'node:fs'
import path from 'node:path'

import {
  buildBaseSecurityHeaders,
  buildContentSecurityPolicy,
  buildStrictTransportSecurity,
} from '../lib/security-headers'

function directives(csp: string): Map<string, string> {
  return new Map(
    csp.split(';').map((part) => {
      const trimmed = part.trim()
      const space = trimmed.indexOf(' ')
      return space === -1 ? [trimmed, ''] : [trimmed.slice(0, space), trimmed.slice(space + 1)]
    }),
  )
}

describe('app content security policy', () => {
  // Regression guard for https://github.com/open-mercato/open-mercato/issues/1606:
  // the CSP must allowlist Stripe's script and frame origins so payment pages
  // can load js.stripe.com and render 3-D Secure iframes.
  it('allowlists Stripe in script-src and frame-src', () => {
    for (const isDevelopment of [true, false]) {
      const found = directives(buildContentSecurityPolicy(isDevelopment))
      expect(found.get('script-src')).toContain('https://js.stripe.com')
      expect(found.get('frame-src')).toContain('https://js.stripe.com')
      expect(found.get('frame-src')).toContain('https://hooks.stripe.com')
    }
  })

  it('keeps the directives that bound where anything may load from', () => {
    const found = directives(buildContentSecurityPolicy(false))
    expect(found.get('default-src')).toBe("'self'")
    expect(found.get('base-uri')).toBe("'self'")
    expect(found.get('form-action')).toBe("'self'")
    expect(found.get('frame-ancestors')).toBe("'self'")
    expect(found.get('object-src')).toBe("'none'")
  })

  // The point of the split: a production bundle has no reachable `eval` or
  // `Function(...)` call, so shipping the primitive that turns a string
  // injection into script execution buys nothing. Dev still needs it for the
  // Next dev server and React Refresh.
  it('drops unsafe-eval in production and keeps it in development', () => {
    expect(directives(buildContentSecurityPolicy(false)).get('script-src')).not.toContain('unsafe-eval')
    expect(directives(buildContentSecurityPolicy(true)).get('script-src')).toContain("'unsafe-eval'")
  })

  it('never lets a production build regain unsafe-eval through another directive', () => {
    expect(buildContentSecurityPolicy(false)).not.toContain('unsafe-eval')
  })

  it('is wired into next.config.ts rather than redefined there', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../next.config.ts'), 'utf8')
    expect(source).toContain("from './src/lib/security-headers'")
    expect(source).toContain('buildContentSecurityPolicy(isDevelopment)')
    // A second, hand-maintained copy of the policy is exactly what this module
    // exists to prevent.
    expect(source).not.toContain("default-src 'self'")
  })
})

describe('strict transport security', () => {
  it('is not sent in development, where the app is plain HTTP', () => {
    expect(buildStrictTransportSecurity(true, {})).toBeNull()
  })

  it('defaults to one year, without includeSubDomains or preload', () => {
    expect(buildStrictTransportSecurity(false, {})).toBe('max-age=31536000')
  })

  // Both are opt-in on purpose: the portal answers on tenant custom domains, so
  // asserting HSTS across every subdomain would strand any that is not on TLS.
  it('adds includeSubDomains and preload only when asked', () => {
    expect(
      buildStrictTransportSecurity(false, { OM_SECURITY_HSTS_INCLUDE_SUBDOMAINS: 'true' }),
    ).toBe('max-age=31536000; includeSubDomains')
    expect(
      buildStrictTransportSecurity(false, {
        OM_SECURITY_HSTS_INCLUDE_SUBDOMAINS: '1',
        OM_SECURITY_HSTS_PRELOAD: 'yes',
      }),
    ).toBe('max-age=31536000; includeSubDomains; preload')
  })

  it('honours a custom max-age and treats 0 as "do not send"', () => {
    expect(buildStrictTransportSecurity(false, { OM_SECURITY_HSTS_MAX_AGE: '600' })).toBe('max-age=600')
    expect(buildStrictTransportSecurity(false, { OM_SECURITY_HSTS_MAX_AGE: '0' })).toBeNull()
  })

  it('falls back to the default rather than emitting a malformed max-age', () => {
    for (const raw of ['', '   ', 'soon', '-1', 'NaN']) {
      expect(buildStrictTransportSecurity(false, { OM_SECURITY_HSTS_MAX_AGE: raw })).toBe(
        'max-age=31536000',
      )
    }
  })
})

describe('base security headers', () => {
  it('carries the always-on set, plus HSTS only in production', () => {
    const dev = buildBaseSecurityHeaders(true, {}).map((header) => header.key)
    const prod = buildBaseSecurityHeaders(false, {}).map((header) => header.key)
    for (const key of ['Referrer-Policy', 'X-Content-Type-Options', 'X-Frame-Options']) {
      expect(dev).toContain(key)
      expect(prod).toContain(key)
    }
    expect(dev).not.toContain('Strict-Transport-Security')
    expect(prod).toContain('Strict-Transport-Security')
  })

  it('is applied to the attachment-download route too, which sets its own CSP', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../next.config.ts'), 'utf8')
    const attachmentBlock = source.slice(source.indexOf('/api/attachments/file/:path*'))
    expect(attachmentBlock).toContain('...baseSecurityHeaders')
  })
})
