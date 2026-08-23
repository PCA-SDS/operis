"use client"
import { useCallback, useEffect, useMemo, useState } from 'react'
import { extensionPoints } from '@open-mercato/core/modules/auth/extension-points'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { clearAllOperations } from '@open-mercato/ui/backend/operations/store'
import { notifyAuthIdentityChange } from '@open-mercato/ui/backend/AuthSessionGuard'
import { clearAllPerspectiveState } from '@open-mercato/ui/backend/perspectiveState'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Eye, EyeOff, X } from 'lucide-react'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import type { AuthOverride, LoginFormWidgetContext } from './login-injection'

// Hero photograph. Matches the reference sign-in; override with
// NEXT_PUBLIC_OM_LOGIN_HERO_URL (e.g. a self-hosted asset) without a code change.
const defaultHeroImageUrl =
  'https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?q=80&w=2338&auto=format&fit=crop'
const heroImageUrl = process.env.NEXT_PUBLIC_OM_LOGIN_HERO_URL || defaultHeroImageUrl

const loginTenantKey = 'om_login_tenant'
const loginTenantCookieMaxAge = 60 * 60 * 24 * 14

function readTenantCookie() {
  if (typeof document === 'undefined') return null
  const entries = document.cookie.split(';')
  for (const entry of entries) {
    const [name, ...rest] = entry.trim().split('=')
    if (name === loginTenantKey) return decodeURIComponent(rest.join('='))
  }
  return null
}

function setTenantCookie(value: string) {
  if (typeof document === 'undefined') return
  document.cookie = `${loginTenantKey}=${encodeURIComponent(value)}; path=/; max-age=${loginTenantCookieMaxAge}; samesite=lax`
}

function clearTenantCookie() {
  if (typeof document === 'undefined') return
  document.cookie = `${loginTenantKey}=; path=/; max-age=0; samesite=lax`
}

function extractErrorMessage(payload: unknown): string | null {
  if (!payload) return null
  if (typeof payload === 'string') return payload
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const resolved = extractErrorMessage(entry)
      if (resolved) return resolved
    }
    return null
  }
  if (typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    const candidates: unknown[] = [
      record.error,
      record.message,
      record.detail,
      record.details,
      record.description,
    ]
    for (const candidate of candidates) {
      const resolved = extractErrorMessage(candidate)
      if (resolved) return resolved
    }
  }
  return null
}

function looksLikeJsonString(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

type LoginResponseEventDetail = Record<string, unknown> | null

type LoginFormSectionProps = {
  children: ReactNode
}

function LoginFormSectionDefault({ children }: LoginFormSectionProps) {
  return <>{children}</>
}

function emitLoginResponseEvent(detail: LoginResponseEventDetail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('om:auth:login-response', { detail }))
}

export default function LoginPage() {
  const t = useT()
  const translate = useCallback(
    (key: string, fallback: string, params?: Record<string, string | number>) =>
      translateWithFallback(t, key, fallback, params),
    [t],
  )
  const router = useRouter()
  const searchParams = useSearchParams()
  const requireRole = (searchParams.get('requireRole') || searchParams.get('role') || '').trim()
  const requireFeature = (searchParams.get('requireFeature') || '').trim()
  const redirectParam = searchParams.get('redirect') || ''
  const requiredRoles = requireRole ? requireRole.split(',').map((value) => value.trim()).filter(Boolean) : []
  const requiredFeatures = requireFeature ? requireFeature.split(',').map((value) => value.trim()).filter(Boolean) : []
  const translatedRoles = requiredRoles.map((role) => translate(`auth.roles.${role}`, role))
  const translatedFeatures = requiredFeatures.map((feature) => translate(`features.${feature}`, feature))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [authOverride, setAuthOverride] = useState<AuthOverride | null>(null)
  const [authOverridePending, setAuthOverridePending] = useState(false)
  const [clientReady, setClientReady] = useState(false)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [activeAuthenticatedUser, setActiveAuthenticatedUser] = useState(false)
  const [email, setEmail] = useState('')
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [tenantName, setTenantName] = useState<string | null>(null)
  const [tenantLoading, setTenantLoading] = useState(false)
  const [tenantInvalid, setTenantInvalid] = useState<string | null>(null)
  const showTenantInvalid = tenantId != null && tenantInvalid === tenantId
  const LoginFormSection = useRegisteredComponent<LoginFormSectionProps>(
    'section:auth.login.form',
    LoginFormSectionDefault,
  )

  useEffect(() => {
    setClientReady(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    const hasAclChallenge = requiredFeatures.length > 0 || requiredRoles.length > 0
    void (async () => {
      try {
        const res = await apiCall<{ userId?: string }>('/api/auth/feature-check', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            // Probing for an already-active session: a 401 is the expected answer
            // for an anonymous visitor, never a session that just expired.
            'x-om-unauthorized-redirect': '0',
            'x-om-forbidden-redirect': '0',
          },
          body: JSON.stringify({ features: [] }),
          cache: 'no-store',
        })
        if (cancelled) return
        const activeUserId = typeof res.result?.userId === 'string' ? res.result.userId : ''
        if (!activeUserId) return
        setActiveAuthenticatedUser(true)
        // When a feature/role challenge is present in the URL, the user already
        // failed an ACL check while authenticated. Auto-redirecting back to
        // `redirect` would re-trigger the same 403 and re-bounce here,
        // producing an infinite loop (see GH #2070). Stay on the login page so
        // the access-denied banner is visible.
        if (hasAclChallenge) return
        const rawRedirect = redirectParam
        let destination = '/backend'
        if (rawRedirect) {
          try {
            const resolved = new URL(rawRedirect, window.location.origin)
            if (
              resolved.origin === window.location.origin &&
              resolved.pathname.startsWith('/') &&
              !resolved.pathname.includes('//')
            ) {
              destination = resolved.pathname + resolved.search + resolved.hash
            }
          } catch {
            // fall back to /backend
          }
        }
        router.replace(destination)
      } catch {
        // ignore — leave login form usable on network failure
      }
    })()
    return () => { cancelled = true }
  }, [router, redirectParam, requiredFeatures.length, requiredRoles.length])

  useEffect(() => {
    const tenantParam = (searchParams.get('tenant') || '').trim()
    if (tenantParam) {
      setTenantId(tenantParam)
      window.localStorage.setItem(loginTenantKey, tenantParam)
      setTenantCookie(tenantParam)
      return
    }
    const storedTenant = window.localStorage.getItem(loginTenantKey) || readTenantCookie()
    if (storedTenant) {
      setTenantId(storedTenant)
    }
  }, [searchParams])

  useEffect(() => {
    if (!tenantId) {
      setTenantName(null)
      setTenantInvalid(null)
      return
    }
    if (tenantInvalid === tenantId) {
      setTenantName(null)
      setTenantLoading(false)
      return
    }
    let active = true
    setTenantLoading(true)
    setTenantInvalid(null)
    apiCall<{ ok: boolean; tenant?: { id: string; name: string }; error?: string }>(
      `/api/directory/tenants/lookup?tenantId=${encodeURIComponent(tenantId)}`,
    )
      .then(({ result }) => {
        if (!active) return
        if (result?.ok && result.tenant) {
          setTenantName(result.tenant.name)
          return
        }
        setTenantName(null)
        setTenantInvalid(tenantId)
        setError(null)
      })
      .catch(() => {
        if (!active) return
        setTenantName(null)
        setTenantInvalid(tenantId)
        setError(null)
      })
      .finally(() => {
        if (active) setTenantLoading(false)
      })
    return () => {
      active = false
    }
  }, [tenantId, translate])

  function handleClearTenant() {
    window.localStorage.removeItem(loginTenantKey)
    clearTenantCookie()
    setTenantId(null)
    setTenantName(null)
    setTenantInvalid(null)
    const params = new URLSearchParams(searchParams)
    params.delete('tenant')
    setError(null)
    const query = params.toString()
    router.replace(query ? `/login?${query}` : '/login')
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!clientReady || authOverridePending) {
      return
    }
    setError(null)
    if (authOverride) {
      authOverride.onSubmit()
      return
    }
    setSubmitting(true)
    try {
      const form = new FormData(e.currentTarget)
      if (requiredRoles.length) form.set('requireRole', requiredRoles.join(','))
      const redirectParam = searchParams.get('redirect')
      if (redirectParam) form.set('redirect', redirectParam)
      const res = await fetch('/api/auth/login', { method: 'POST', body: form })
      if (res.redirected) {
        clearAllOperations()
        clearAllPerspectiveState()
        notifyAuthIdentityChange()
        // NextResponse.redirect from API
        router.replace(res.url)
        return
      }
      if (!res.ok) {
        const fallback = (() => {
          if (res.status === 403) {
            return translate(
              'auth.login.errors.permissionDenied',
              'You do not have permission to access this area. Please contact your administrator.',
            )
          }
          if (res.status === 401 || res.status === 400) {
            return translate('auth.login.errors.invalidCredentials', 'Invalid email or password')
          }
          return translate('auth.login.errors.generic', 'An error occurred. Please try again.')
        })()
        const cloned = res.clone()
        let errorMessage = ''
        const contentType = res.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          try {
            const data = await res.json()
            errorMessage = extractErrorMessage(data) || ''
          } catch {
            try {
              const text = await cloned.text()
              const trimmed = text.trim()
              if (trimmed && !looksLikeJsonString(trimmed)) {
                errorMessage = trimmed
              }
            } catch {
              errorMessage = ''
            }
          }
        } else {
          try {
            const text = await res.text()
            const trimmed = text.trim()
            if (trimmed && !looksLikeJsonString(trimmed)) {
              errorMessage = trimmed
            }
          } catch {
            errorMessage = ''
          }
        }
        setError(errorMessage || fallback)
        return
      }
      // In case API returns 200 with JSON
      const data = await res.json().catch(() => null) as LoginResponseEventDetail
      emitLoginResponseEvent(data)
      clearAllOperations()
      clearAllPerspectiveState()
      notifyAuthIdentityChange()
      if (data && typeof data.redirect === 'string' && data.redirect.length > 0) {
        router.replace(data.redirect)
      }
    } catch (err: unknown) {
      // Handle any errors thrown (e.g., network errors or thrown exceptions)
      const message = err instanceof Error ? err.message : ''
      setError(message || translate('auth.login.errors.generic', 'An error occurred. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  const loginFormContext = useMemo<LoginFormWidgetContext>(() => ({
    email,
    tenantId,
    searchParams,
    setAuthOverride,
    setAuthOverridePending,
    setError,
  }), [email, tenantId, searchParams])

  const formReady = clientReady && !authOverridePending

  // Layout replicates PCA ERP's tenant sign-in: full-bleed hero on the left,
  // narrow form column on the right. Colours come from Operis tokens rather
  // than the reference's palette, per the design-system rules.
  //
  // `pb-32` on the form column is load-bearing, not spacing taste. The global
  // notice bars (cookie consent, demo-instance warning) are `fixed` to the
  // bottom of the viewport and overlay whatever is under them; without a
  // reserve the submit button sat underneath them and could not be clicked.
  //
  // Fields, labels, checkbox, error box and button reproduce the reference's
  // component styling. Email/password replace its single workspace field
  // (Operis authenticates with a password, not an OIDC redirect) and reuse the
  // same field treatment, as do the Operis-only tenant banners and ACL notices.
  const fieldClass =
    'w-full rounded-lg border border-transparent bg-surface-muted px-3.5 py-3 text-sm text-foreground placeholder:text-disabled-foreground transition-all outline-none ring-0 focus:outline-none focus:ring-0 focus:border-transparent'
  const fieldLabelClass = 'mb-2.5 block text-xs font-bold uppercase tracking-wide text-muted-foreground'
  const primaryButtonClass =
    'inline-flex w-full items-center justify-center gap-2 rounded-lg border border-transparent bg-primary px-3.5 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-focus-ring/30 disabled:cursor-not-allowed disabled:opacity-60'
  const noticeClass = 'rounded-lg px-3 py-2 text-sm leading-5'

  return (
    <div className="flex min-h-svh bg-background">
      {/*
        The scrim and hero copy use fixed black/white rather than theme tokens on
        purpose: this panel sits over a photograph, so it is a fixed dark context
        in both themes. `bg-foreground/55` would invert to a LIGHT scrim in dark
        mode and make the headline unreadable. Same rationale as the dialog
        backdrop's `bg-black/40`.
      */}
      <div
        aria-hidden="true"
        className="relative hidden bg-cover bg-center lg:flex lg:w-2/3 xl:w-3/4"
        style={{ backgroundImage: `url("${heroImageUrl}")` }}
      >
        <div className="absolute inset-0 bg-black/55" />
        <div className="relative z-10 flex max-w-2xl flex-col justify-end p-12 text-white">
          <h1 className="mb-4 text-5xl font-bold tracking-normal">
            {translate('auth.login.hero.title', 'An Enterprise Resource Planning Software')}
          </h1>
          <p className="text-base leading-8 text-white/85">
            {translate('auth.login.hero.description', 'Manage operations, approvals, and tenant workflows from one secure platform.')}
          </p>
          <p className="mt-2 text-sm font-medium text-white/70">
            {translate('auth.login.hero.tagline', "Your Company's Solution.")}
          </p>
        </div>
      </div>

      <div className="flex w-full items-center justify-center px-6 py-10 pb-32 lg:w-1/3 lg:px-8 xl:w-1/4">
        <div className="w-full max-w-sm">
          <header className="mb-8">
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-accent-strong">
              {translate('auth.login.eyebrow', 'Operis ERP')}
            </p>
            <h2 className="text-3xl font-bold leading-tight tracking-tight text-foreground">
              {translate('auth.login.workspaceTitle', 'Sign in to Your Workspace')}
            </h2>
          </header>

          <LoginFormSection>
            <form className="space-y-5" onSubmit={onSubmit} noValidate data-auth-ready={formReady ? '1' : '0'}>
              {tenantId ? (
                <input type="hidden" name="tenantId" value={tenantId} />
              ) : null}

              {!!translatedRoles.length && (
                <div className={`${noticeClass} border border-status-info-border bg-status-info-bg text-status-info-text`}>
                  {translate(
                    translatedRoles.length > 1 ? 'auth.login.requireRolesMessage' : 'auth.login.requireRoleMessage',
                    translatedRoles.length > 1
                      ? 'Access requires one of the following roles: {roles}'
                      : 'Access requires role: {roles}',
                    { roles: translatedRoles.join(', ') },
                  )}
                </div>
              )}
              {!!translatedFeatures.length && (
                <div className={`${noticeClass} border border-status-info-border bg-status-info-bg text-status-info-text`}>
                  {translate('auth.login.featureDenied', "You don't have access to this feature ({feature}). Please contact your administrator.", {
                    feature: translatedFeatures.join(', '),
                  })}
                </div>
              )}
              {activeAuthenticatedUser && (translatedRoles.length || translatedFeatures.length) ? (
                <div className="flex justify-center" data-testid="login-return-dashboard">
                  <Link
                    href="/backend"
                    className="text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    {translate('auth.accessDenied.dashboard', 'Go to Dashboard')}
                  </Link>
                </div>
              ) : null}

              {showTenantInvalid ? (
                <div className={`${noticeClass} border border-status-error-border bg-status-error-bg text-status-error-text`}>
                  <div className="font-medium">{translate('auth.login.errors.tenantInvalid', 'Tenant not found. Clear the tenant selection and try again.')}</div>
                  <button type="button" onClick={handleClearTenant} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium underline underline-offset-4">
                    <X className="size-3.5" aria-hidden="true" />
                    {translate('auth.login.tenantClear', 'Clear')}
                  </button>
                </div>
              ) : tenantId ? (
                <div className={`${noticeClass} border border-status-success-border bg-status-success-bg text-status-success-text`}>
                  <div className="font-medium">
                    {tenantLoading
                      ? translate('auth.login.tenantLoading', 'Loading tenant details...')
                      : translate('auth.login.tenantBanner', "You're logging in to {tenant}.", { tenant: tenantName || tenantId })}
                  </div>
                  <button type="button" onClick={handleClearTenant} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium underline underline-offset-4">
                    <X className="size-3.5" aria-hidden="true" />
                    {translate('auth.login.tenantClear', 'Clear')}
                  </button>
                </div>
              ) : null}

              <div>
                <label htmlFor="email" className={fieldLabelClass}>{t('auth.email')}</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="name@example.com"
                  aria-invalid={!!error}
                  className={fieldClass}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={(e) => setEmail(e.target.value)}
                />
              </div>

              <InjectionSpot<LoginFormWidgetContext>
                spotId={extensionPoints.hosts.loginForm.spotId}
                context={loginFormContext}
              />

              {authOverride?.hidePassword ? null : (
                <div>
                  <label htmlFor="password" className={fieldLabelClass}>{t('auth.password')}</label>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      type={isPasswordVisible ? 'text' : 'password'}
                      required={!authOverride}
                      autoComplete="current-password"
                      aria-invalid={!!error}
                      className={`${fieldClass} pr-11`}
                    />
                    <button
                      type="button"
                      aria-label={isPasswordVisible
                        ? translate('auth.login.hidePassword', 'Hide password')
                        : translate('auth.login.showPassword', 'Show password')}
                      aria-pressed={isPasswordVisible}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setIsPasswordVisible((current) => !current)}
                      className="absolute right-3 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition hover:text-foreground focus:outline-none focus:ring-2 focus:ring-focus-ring/40"
                    >
                      {isPasswordVisible
                        ? <EyeOff aria-hidden="true" size={18} strokeWidth={2} />
                        : <Eye aria-hidden="true" size={18} strokeWidth={2} />}
                    </button>
                  </div>
                </div>
              )}

              {!authOverride?.hideRememberMe && !authOverride?.hidePassword && (
                <label className="flex cursor-pointer items-center gap-2.5 text-sm text-muted-foreground">
                  <input type="checkbox" name="remember" className="h-4 w-4 shrink-0 rounded border-border accent-primary" />
                  <span>{translate('auth.login.rememberMe', 'Keep me signed in')}</span>
                </label>
              )}

              <div
                className={`overflow-hidden transition-all duration-200 ease-out ${error && !showTenantInvalid ? 'max-h-40 opacity-100' : 'pointer-events-none max-h-0 opacity-0'}`}
                aria-hidden={!(error && !showTenantInvalid)}
              >
                {error && !showTenantInvalid ? (
                  <div role="alert" aria-live="polite" className={`${noticeClass} border border-status-error-border bg-status-error-bg text-status-error-text`}>
                    {error}
                  </div>
                ) : null}
              </div>

              <button type="submit" disabled={submitting || !formReady} className={primaryButtonClass}>
                {submitting
                  ? translate('auth.login.loading', 'Signing in…')
                  : authOverride
                    ? authOverride.providerLabel
                    : translate('auth.signIn', 'Sign in')}
              </button>

              {!authOverride?.hideForgotPassword && (
                <div className="text-center">
                  <Link
                    href="/reset"
                    className="text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    {translate('auth.login.forgotPassword', 'Forgot password?')}
                  </Link>
                </div>
              )}
            </form>
          </LoginFormSection>

          <p className="mt-5 text-center text-xs text-muted-foreground">
            {translate('auth.login.helperText', 'Need access? Contact your company administrator.')}
          </p>
        </div>
      </div>
    </div>
  )
}
