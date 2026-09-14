"use client"

// How chat asks other modules what they have to offer, without knowing who they
// are. Three questions, three helpers, and all of them answer "nothing" when no
// module has claimed the spot — which is what makes every surface that uses them
// degrade quietly rather than break.

import * as React from 'react'
import {
  loadInjectionDataWidgetsForSpot,
  loadInjectionWidgetsForSpot,
  getInjectionRegistryVersion,
  subscribeToInjectionRegistryChanges,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import type {
  InjectionRowActionDefinition,
  InjectionSpotId,
} from '@open-mercato/shared/modules/widgets/injection'
import { hasAllFeatures } from '@open-mercato/shared/security/features'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('chat').child({ component: 'injection' })

/**
 * Whether any module has claimed a render spot at all.
 *
 * Asked once per surface rather than per row: a transcript can hold many card
 * rows and the answer is the same for all of them. It exists so a card whose
 * owning module is absent can render an honest "cannot be shown" line instead of
 * an empty box — `InjectionSpot` renders nothing when unclaimed, which is right
 * for an optional panel and wrong for a row that is already in the transcript.
 */
export function useChatSpotClaimed(spotId: InjectionSpotId): boolean {
  const [claimed, setClaimed] = React.useState(false)
  const { isReady } = useBackendChrome()
  const [registryVersion, setRegistryVersion] = React.useState(() => getInjectionRegistryVersion())

  React.useEffect(
    () => subscribeToInjectionRegistryChanges(() => setRegistryVersion(getInjectionRegistryVersion())),
    [],
  )

  React.useEffect(() => {
    if (!isReady) return
    let mounted = true
    loadInjectionWidgetsForSpot(spotId)
      .then((widgets) => {
        if (mounted) setClaimed(widgets.length > 0)
      })
      .catch((error: unknown) => {
        logger.error('Failed to resolve a chat injection spot', { spotId, err: error })
        if (mounted) setClaimed(false)
      })
    return () => {
      mounted = false
    }
  }, [isReady, registryVersion, spotId])

  return claimed
}

/**
 * Row actions contributed to one of chat's menu spots, filtered to what this
 * viewer's grants allow.
 *
 * A row action rather than a menu item because every one of these needs to know
 * *what* it was invoked on — the message, or the conversation — and `onSelect(row,
 * context)` is the only injected shape that receives it. The feature filter is
 * cosmetic, not a boundary: the endpoint behind the action checks the caller's
 * grants again on the server, because a client-side list is a suggestion.
 */
export function useChatInjectedActions(spotId: InjectionSpotId): InjectionRowActionDefinition[] {
  const [actions, setActions] = React.useState<InjectionRowActionDefinition[]>([])
  const { payload, isReady } = useBackendChrome()
  const granted = React.useMemo(() => payload?.grantedFeatures ?? [], [payload?.grantedFeatures])
  const hasPayload = payload !== null
  const [registryVersion, setRegistryVersion] = React.useState(() => getInjectionRegistryVersion())

  React.useEffect(
    () => subscribeToInjectionRegistryChanges(() => setRegistryVersion(getInjectionRegistryVersion())),
    [],
  )

  React.useEffect(() => {
    if (!isReady) return
    let mounted = true
    loadInjectionDataWidgetsForSpot(spotId)
      .then((widgets) => {
        if (!mounted) return
        const collected: InjectionRowActionDefinition[] = []
        const seen = new Set<string>()
        for (const widget of widgets) {
          const features = widget.metadata.features ?? []
          if (hasPayload && features.length > 0 && !hasAllFeatures(granted, features)) continue
          if (!('rowActions' in widget)) continue
          for (const action of widget.rowActions ?? []) {
            // First contributor wins a given id, so a duplicate cannot render
            // the same entry twice in one menu.
            if (seen.has(action.id)) continue
            seen.add(action.id)
            collected.push(action)
          }
        }
        setActions(collected)
      })
      .catch((error: unknown) => {
        logger.error('Failed to load chat injected actions', { spotId, err: error })
        if (mounted) setActions([])
      })
    return () => {
      mounted = false
    }
  }, [granted, hasPayload, isReady, registryVersion, spotId])

  return actions
}
