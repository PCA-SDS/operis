"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useBackendChrome } from '../BackendChromeProvider'
import { flash } from '../FlashMessages'
import { useGuardedMutation } from '../injection/useGuardedMutation'
import { apiCall, withScopedApiRequestHeaders } from '../utils/apiCall'
import { buildOptimisticLockHeader } from '../utils/optimisticLock'

const PREFERENCES_API = '/api/auth/sidebar/preferences'
const REFRESH_SIDEBAR_EVENT = 'om:refresh-sidebar'
const MANAGE_FEATURE = 'auth.sidebar.manage'

type SidebarSettings = {
  version: number
  groupOrder: string[]
  groupLabels: Record<string, string>
  itemLabels: Record<string, string>
  hiddenItems: string[]
  itemOrder: Record<string, string[]>
}

type Preferences = { settings: SidebarSettings; updatedAt: string | null }

type PreferencesResponse = { settings?: Partial<SidebarSettings>; updatedAt?: string | null }

function toPreferences(body: PreferencesResponse | null): Preferences | null {
  if (!body?.settings) return null
  const settings = body.settings
  return {
    settings: {
      version: typeof settings.version === 'number' ? settings.version : 1,
      groupOrder: Array.isArray(settings.groupOrder) ? settings.groupOrder : [],
      groupLabels: settings.groupLabels ?? {},
      itemLabels: settings.itemLabels ?? {},
      hiddenItems: Array.isArray(settings.hiddenItems) ? settings.hiddenItems : [],
      itemOrder: settings.itemOrder ?? {},
    },
    updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : null,
  }
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index])
}

/**
 * The viewer's module order, as the switcher shows and saves it.
 *
 * The order lives in the existing sidebar preference (`groupOrder`), so the
 * switcher, the sidebar customization page and the server's nav payload stay
 * one source of truth. Saving needs `auth.sidebar.manage`, which the server
 * enforces; without it the switcher simply does not offer reordering.
 *
 * The preference endpoint replaces the whole record, so a save writes back the
 * viewer's current labels, hidden items and item order untouched and changes
 * only the module positions. A viewer with no personal preference yet inherits
 * any role layout; the pages that layout hides are carried over as hidden, or a
 * first reorder would unhide them.
 *
 * The new order shows at once. A module the grid leaves out (no reachable
 * landing page) is placed after the ones it shows, so a save always covers
 * every module and the local order can settle back onto the server's. Saves
 * run one at a time with the latest order winning; a failure reverts and says
 * so, and an edit conflict with another tab reloads the record and retries once.
 */
export function useModuleOrder(serverKeys: string[]) {
  const t = useT()
  const { payload } = useBackendChrome()
  const canReorder = hasFeature(payload?.grantedFeatures ?? [], MANAGE_FEATURE)
  const [localKeys, setLocalKeys] = React.useState<string[] | null>(null)
  const [savedGroupOrder, setSavedGroupOrder] = React.useState<string[] | null>(null)
  const preferencesRef = React.useRef<Preferences | null>(null)
  const queueRef = React.useRef<Promise<void>>(Promise.resolve())
  const latestRequestRef = React.useRef(0)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    operation: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'module-switcher-order',
    blockedMessage: t('appShell.modules.saveError', "Couldn't save the module order"),
  })

  const hiddenFromPayload = React.useMemo(() => {
    const hidden: string[] = []
    for (const group of payload?.groups ?? []) {
      for (const item of group.items ?? []) {
        if (item.hidden === true) hidden.push(item.id ?? item.href)
        for (const child of item.children ?? []) {
          if (child.hidden === true) hidden.push(child.id ?? child.href)
        }
      }
    }
    return hidden
  }, [payload?.groups])

  const serverKeySet = React.useMemo(() => new Set(serverKeys), [serverKeys])
  const hasCustomOrder = React.useMemo(
    () => (savedGroupOrder ?? []).some((key) => serverKeySet.has(key)),
    [savedGroupOrder, serverKeySet],
  )

  const loadPreferences = React.useCallback(async (): Promise<Preferences | null> => {
    const call = await apiCall<PreferencesResponse>(PREFERENCES_API, { cache: 'no-store' })
    const preferences = call.ok ? toPreferences(call.result) : null
    preferencesRef.current = preferences
    if (preferences) setSavedGroupOrder(preferences.settings.groupOrder)
    return preferences
  }, [])

  const ensureLoaded = React.useCallback(() => {
    if (!canReorder || preferencesRef.current) return
    void loadPreferences()
  }, [canReorder, loadPreferences])

  React.useEffect(() => {
    if (localKeys && sameOrder(localKeys, serverKeys)) setLocalKeys(null)
  }, [localKeys, serverKeys])

  const putOrder = React.useCallback(async (moduleKeys: string[]): Promise<boolean> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const preferences = attempt === 0 && preferencesRef.current ? preferencesRef.current : await loadPreferences()
      if (!preferences) return false
      const rest = preferences.settings.groupOrder.filter((key) => !serverKeySet.has(key))
      const body = {
        ...preferences.settings,
        groupOrder: [...moduleKeys, ...rest],
        hiddenItems: preferences.updatedAt ? preferences.settings.hiddenItems : hiddenFromPayload,
      }
      const call = await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(buildOptimisticLockHeader(preferences.updatedAt), () =>
            apiCall<{ updatedAt?: string | null }>(PREFERENCES_API, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }),
          ),
        context: { formId: 'module-switcher', operation: 'saveModuleOrder', retryLastMutation },
        mutationPayload: body,
      })
      if (call.ok) {
        preferencesRef.current = {
          settings: body,
          updatedAt: typeof call.result?.updatedAt === 'string' ? call.result.updatedAt : null,
        }
        setSavedGroupOrder(body.groupOrder)
        return true
      }
      if (call.status !== 409) return false
    }
    return false
  }, [hiddenFromPayload, loadPreferences, retryLastMutation, runMutation, serverKeySet])

  const persist = React.useCallback((moduleKeys: string[], optimistic: string[] | null) => {
    const request = ++latestRequestRef.current
    setLocalKeys(optimistic)
    queueRef.current = queueRef.current.then(async () => {
      if (request !== latestRequestRef.current) return
      const saved = await putOrder(moduleKeys).catch(() => false)
      if (request !== latestRequestRef.current) return
      if (!saved) {
        setLocalKeys(null)
        flash(t('appShell.modules.saveError', "Couldn't save the module order"), 'error')
        return
      }
      try {
        window.dispatchEvent(new Event(REFRESH_SIDEBAR_EVENT))
      } catch {
        return
      }
    })
  }, [putOrder, t])

  const reorder = React.useCallback((nextKeys: string[]) => {
    const current = localKeys ?? serverKeys
    const moved = new Set(nextKeys)
    const fullOrder = [...nextKeys, ...current.filter((key) => !moved.has(key))]
    if (!canReorder || sameOrder(fullOrder, current)) return
    persist(fullOrder, fullOrder)
  }, [canReorder, localKeys, persist, serverKeys])

  const resetOrder = React.useCallback(() => {
    if (!canReorder) return
    persist([], null)
  }, [canReorder, persist])

  return {
    canReorder,
    orderedKeys: localKeys ?? serverKeys,
    hasCustomOrder,
    ensureLoaded,
    reorder,
    resetOrder,
  }
}
