'use client'

import * as React from 'react'
import type { InjectionSpotId } from '@open-mercato/shared/modules/widgets/injection'
import { loadInjectionWidgetsForSpot, type LoadedInjectionWidget } from '@open-mercato/shared/modules/widgets/injection-loader'
import { hasAllFeatures } from '@open-mercato/shared/security/features'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readPortalGrantedFeatures } from './portalGrantedFeatures'

const logger = createLogger('ui').child({ component: 'usePortalDashboardWidgets' })

function collectRequiredFeatures(widgets: LoadedInjectionWidget[]): string[] {
  const set = new Set<string>()
  for (const widget of widgets) {
    for (const feature of widget.metadata.features ?? []) {
      if (!feature || feature.trim().length === 0) continue
      set.add(feature)
    }
  }
  return Array.from(set)
}

/**
 * Loads UI injection widgets (with Widget component) for a portal spot.
 *
 * Unlike `useInjectionDataWidgets` which loads data-only widgets (columns, fields, menuItems),
 * this hook loads widgets that export a `Widget` React component — suitable for
 * portal dashboard sections and other UI injection spots.
 *
 * Feature gating: widgets declaring `metadata.features` are filtered against the
 * authenticated customer's grants resolved via
 * `/api/customer_accounts/portal/feature-check`. Wildcard grants (`portal.*`) resolve
 * through the shared matcher.
 */
export function usePortalDashboardWidgets(spotId: InjectionSpotId): {
  widgets: LoadedInjectionWidget[]
  isLoading: boolean
  error: string | null
} {
  const [widgets, setWidgets] = React.useState<LoadedInjectionWidget[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [grantedFeatures, setGrantedFeatures] = React.useState<Set<string>>(new Set())

  React.useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        setIsLoading(true)
        setError(null)
        const loaded = await loadInjectionWidgetsForSpot(spotId)
        if (!mounted) return
        // Only keep widgets that have a Widget component
        const uiWidgets = loaded.filter((w) => typeof w.Widget === 'function')
        setWidgets(uiWidgets)
        const required = collectRequiredFeatures(uiWidgets)
        const granted = await readPortalGrantedFeatures(required)
        if (!mounted) return
        setGrantedFeatures(granted)
      } catch (loadError) {
        if (!mounted) return
        logger.error('Failed to load widgets for spot', { spotId, err: loadError })
        setError(loadError instanceof Error ? loadError.message : String(loadError))
        setWidgets([])
      } finally {
        if (mounted) setIsLoading(false)
      }
    }
    void load()
    return () => {
      mounted = false
    }
  }, [spotId])

  const grantedFeatureList = React.useMemo(() => Array.from(grantedFeatures), [grantedFeatures])

  const visibleWidgets = React.useMemo(
    () =>
      widgets.filter((widget) => {
        const required = widget.metadata.features ?? []
        return required.length === 0 || hasAllFeatures(grantedFeatureList, required)
      }),
    [widgets, grantedFeatureList],
  )

  return { widgets: visibleWidgets, isLoading, error }
}
