'use client'

import * as React from 'react'
import { apiCall } from './utils/apiCall'
import { subscribeOrganizationScopeChanged, getCurrentOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { registerEntitledModuleIds } from '@open-mercato/shared/modules/widgets/injection-loader'
import type {
  BackendChromeCurrentOrganization,
  BackendChromePayload,
} from '@open-mercato/shared/modules/navigation/backendChrome'

type BackendChromeContextValue = {
  payload: BackendChromePayload | null
  isLoading: boolean
  isReady: boolean
  refresh: () => Promise<void>
}

type BackendChromeProviderProps = {
  adminNavApi?: string
  children: React.ReactNode
}

const chromeCache = new Map<string, BackendChromePayload>()
const BackendChromeContext = React.createContext<BackendChromeContextValue | null>(null)

function buildCacheKey(api: string): string {
  return `${api}::scope:${getCurrentOrganizationScopeVersion()}`
}

export function BackendChromeProvider({ adminNavApi, children }: BackendChromeProviderProps) {
  const cachedPayload = React.useMemo(() => {
    if (!adminNavApi) return null
    return chromeCache.get(buildCacheKey(adminNavApi)) ?? null
  }, [adminNavApi])
  const [payload, setPayload] = React.useState<BackendChromePayload | null>(cachedPayload)
  const [isLoading, setIsLoading] = React.useState(Boolean(adminNavApi && !cachedPayload))

  const refresh = React.useCallback(async () => {
    if (!adminNavApi) return
    setIsLoading(true)
    try {
      const call = await apiCall<BackendChromePayload>(adminNavApi, { credentials: 'include' as never })
      if (!call.ok || !call.result) return
      const nextPayload = call.result
      chromeCache.set(buildCacheKey(adminNavApi), nextPayload)
      setPayload(nextPayload)
    } catch {
      return
    } finally {
      setIsLoading(false)
    }
  }, [adminNavApi])

  React.useEffect(() => {
    if (!adminNavApi) {
      setPayload(null)
      setIsLoading(false)
      return
    }
    const cached = chromeCache.get(buildCacheKey(adminNavApi)) ?? null
    setPayload(cached)
    if (!cached) {
      void refresh()
    }
  }, [adminNavApi, refresh])

  // Injection widgets declare `requiredModules`, and the loader resolves that
  // against the deploy-level registry, which is the same for every tenant.
  // Publishing the viewer's reachable set here narrows it to what this person
  // may actually see, so a widget contributed by a withheld module never
  // mounts. Cleared when the payload goes away so a signed-out shell does not
  // keep the previous viewer's entitlement.
  React.useEffect(() => {
    // A payload from a server that predates this field, or one replayed from
    // the pre-upgrade cache, carries no module set. Registering `null` there
    // means "do not narrow" rather than "narrow to nothing", which would blank
    // every injection widget on the page.
    registerEntitledModuleIds(payload?.enabledModuleIds ?? null)
  }, [payload])

  React.useEffect(() => {
    if (!adminNavApi) return
    const onFocus = () => { void refresh() }
    const onManualRefresh = () => { void refresh() }
    const unsubscribeScope = subscribeOrganizationScopeChanged(() => {
      void refresh()
    })
    window.addEventListener('focus', onFocus)
    window.addEventListener('om:refresh-sidebar', onManualRefresh as EventListener)
    return () => {
      unsubscribeScope()
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('om:refresh-sidebar', onManualRefresh as EventListener)
    }
  }, [adminNavApi, refresh])

  const value = React.useMemo<BackendChromeContextValue>(() => ({
    payload,
    isLoading,
    isReady: !adminNavApi || payload !== null,
    refresh,
  }), [adminNavApi, isLoading, payload, refresh])

  return (
    <BackendChromeContext.Provider value={value}>
      {children}
    </BackendChromeContext.Provider>
  )
}

export function useBackendChrome(): BackendChromeContextValue {
  return React.useContext(BackendChromeContext) ?? {
    payload: null,
    isLoading: false,
    isReady: true,
    refresh: async () => {},
  }
}

/**
 * Whether the signed-in user can reach `moduleId` — the deploy-level module
 * registry narrowed by tenant entitlement and per-user restrictions.
 *
 * This is the client-side counterpart to the server guards. Use it for any
 * affordance that points into a module other than the one rendering it: a link
 * to another module's page, a button that calls its API, a column or menu entry
 * it contributes. A withheld module must leave no trace in the UI, and a
 * hardcoded href carries no feature the existing `grantedFeatures` checks could
 * test.
 *
 * Prefer a feature check (`grantedFeatures`) when the affordance maps to a real
 * ACL feature — that is finer-grained and already entitlement-aware. Reach for
 * this when it does not.
 *
 * Resolution:
 * - Outside a `BackendChromeProvider` (component galleries, tests) — `true`,
 *   because there is no entitlement context to honour and gating there would
 *   break unrelated surfaces.
 * - Inside one, before the payload arrives — `false`, so a link into a withheld
 *   module never flashes on screen before being removed.
 * - Once loaded — membership in `payload.enabledModuleIds`.
 */
export function useModuleEnabled(moduleId: string): boolean {
  const { payload, isReady } = useBackendChrome()
  return React.useMemo(() => {
    if (!payload) return isReady
    // Absent field — an older server or a cached pre-upgrade payload — is
    // "unknown", not "nothing is reachable".
    if (!Array.isArray(payload.enabledModuleIds)) return true
    return payload.enabledModuleIds.includes(moduleId)
  }, [payload, isReady, moduleId])
}

/**
 * Set-shaped variant of {@link useModuleEnabled} for callers testing several
 * module ids in one render (a list of links, a menu built from data).
 * `null` means "no entitlement context" — treat every module as reachable.
 */
export function useEnabledModules(): ReadonlySet<string> | null {
  const { payload } = useBackendChrome()
  return React.useMemo(() => (
    Array.isArray(payload?.enabledModuleIds) ? new Set(payload.enabledModuleIds) : null
  ), [payload])
}

export type ModuleGateProps = {
  module: string
  children: React.ReactNode
  /** Rendered instead of `children` when the module is unreachable. Defaults to nothing. */
  fallback?: React.ReactNode
}

/**
 * Renders `children` only when {@link useModuleEnabled} allows `module`.
 *
 * The declarative form, for wrapping a whole affordance. When only part of a
 * render depends on the module — a label that should stay but lose its link —
 * call the hook instead.
 */
export function ModuleGate({ module, children, fallback = null }: ModuleGateProps) {
  const enabled = useModuleEnabled(module)
  return <>{enabled ? children : fallback}</>
}

/**
 * The organization the backend chrome is currently scoped to, for UI that needs to label
 * "you are viewing: <name>".
 *
 * Reads the payload this provider already holds, so it costs no additional request. Returns `null`
 * under an all-organizations selection, outside a provider, or before the payload has arrived — treat
 * it as "unknown", not as "no organization".
 *
 * Prefer this over `payload.brand`, which only populates when the organization has a logo configured.
 */
export function useCurrentOrganization(): BackendChromeCurrentOrganization | null {
  const { payload } = useBackendChrome()
  return payload?.currentOrganization ?? null
}
