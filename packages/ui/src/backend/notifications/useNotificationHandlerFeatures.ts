"use client"
import * as React from 'react'
import { apiCall } from '../utils/apiCall'
import { getRequiredNotificationHandlerFeatures } from './NotificationDispatcher'

/**
 * Resolves the ACL features that registered notification handlers require, so
 * `dispatchNotificationHandlers` can gate side effects on what this user is
 * actually granted.
 *
 * Extracted from `useNotificationsPoll` so its SSE sibling can share the same
 * resolution instead of duplicating it. Returns a ref rather than state on
 * purpose: the value is only ever read inside the dispatch callback, so writing
 * it must not trigger a render of the notification bell.
 *
 * Resolves to `[]` when no handler declares a feature — the common case, and it
 * skips the request entirely.
 */
export function useNotificationHandlerFeatures(): React.MutableRefObject<string[]> {
  const grantedFeaturesRef = React.useRef<string[]>([])

  React.useEffect(() => {
    let mounted = true
    const run = async () => {
      const requiredFeatures = getRequiredNotificationHandlerFeatures()
      if (requiredFeatures.length === 0) {
        grantedFeaturesRef.current = []
        return
      }
      const response = await apiCall<{ granted?: string[] }>('/api/auth/feature-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ features: requiredFeatures }),
      })
      if (!mounted) return
      grantedFeaturesRef.current = response.ok
        ? (response.result?.granted ?? [])
        : []
    }
    void run()
    return () => {
      mounted = false
    }
  }, [])

  return grantedFeaturesRef
}
