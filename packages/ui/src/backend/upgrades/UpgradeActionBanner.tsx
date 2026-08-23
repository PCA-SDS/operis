"use client"
import * as React from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '../../primitives/button'
import { apiCall } from '../utils/apiCall'
import { flash } from '../FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useBackendChrome } from '../BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'

function upgradeActionsEnabled() {
  return (
    process.env.NEXT_PUBLIC_UPGRADE_ACTIONS_ENABLED === 'true' ||
    process.env.UPGRADE_ACTIONS_ENABLED === 'true'
  )
}

type UpgradeActionPayload = {
  id: string
  version: string
  message: string
  ctaLabel: string
  successMessage?: string
  loadingLabel?: string
}

type UpgradeActionResponse = {
  version: string
  actions?: UpgradeActionPayload[]
  error?: string
}

type RunActionResponse = {
  status?: 'completed' | 'already_completed'
  message?: string
  error?: string
}

const forbiddenRedirectOptOutHeader = { 'x-om-forbidden-redirect': '0' } as const

export function UpgradeActionBanner() {
  const t = useT()
  const { payload, isReady } = useBackendChrome()
  const canManageConfigs = isReady && hasFeature(payload?.grantedFeatures, 'configs.manage')
  const [action, setAction] = React.useState<UpgradeActionPayload | null>(null)
  const [loading, setLoading] = React.useState(false)
  const cancelledRef = React.useRef(false)

  const loadNextAction = React.useCallback(async () => {
    if (!canManageConfigs) return
    if (!upgradeActionsEnabled()) return
    if (typeof window === 'undefined' || typeof fetch === 'undefined') return
    const call = await apiCall<UpgradeActionResponse>('/api/configs/upgrade-actions', {
      headers: forbiddenRedirectOptOutHeader,
    })
    if (cancelledRef.current) return
    if (!call.ok || !call.result || !Array.isArray(call.result.actions) || !call.result.actions.length) {
      setAction(null)
      return
    }
    setAction(call.result.actions[0]!)
  }, [canManageConfigs])

  React.useEffect(() => {
    cancelledRef.current = false
    void loadNextAction()
    return () => {
      cancelledRef.current = true
    }
  }, [loadNextAction])

  if (!upgradeActionsEnabled() || !canManageConfigs || !action) return null

  async function handleRun() {
    if (!upgradeActionsEnabled() || !action || loading) return
    setLoading(true)
    try {
      const response = await apiCall<RunActionResponse>('/api/configs/upgrade-actions', {
        method: 'POST',
        headers: { ...forbiddenRedirectOptOutHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: action.id }),
      })
      if (!response.ok) {
        const baseError =
          (response.result && typeof response.result.error === 'string' && response.result.error) ||
          t('upgrades.runFailed', 'We could not run this upgrade action.')
        const detail = response.result && typeof (response.result as any).details === 'string' ? (response.result as any).details : null
        const errorMessage = detail ? `${baseError} (${detail})` : baseError
        flash(errorMessage, 'error')
        return
      }
      const message =
        response.result?.message ||
        action.successMessage ||
        t('upgrades.v034.success', 'Example catalog products and categories installed.')
      flash(message, 'success')
      setAction(null)
      await loadNextAction()
    } catch (error) {
      const message = error instanceof Error ? error.message : t('upgrades.runFailed', 'We could not run this upgrade action.')
      flash(message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadingLabel = action.loadingLabel || t('upgrades.v034.loading', 'Installing…')
  const title = action.ctaLabel || action.message
  const description = action.message && action.message !== title ? action.message : null

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-md border border-status-warning-border bg-status-warning-bg px-3 py-3 text-sm text-status-warning-text md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-2 text-sm">
        <Sparkles className="mt-0.5 size-4 text-status-warning-text" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <div className="font-medium text-status-warning-text">
            {title}
          </div>
          {description ? (
            <div className="text-xs text-status-warning-text/80">
              {description}
            </div>
          ) : null}
          <div className="text-xs text-status-warning-text/80">{t('upgrades.versionLabel', { version: action.version })}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => { void handleRun() }}
          disabled={loading}
          className="border-status-warning-border text-status-warning-text hover:bg-status-warning-bg"
        >
          {loading ? loadingLabel : action.ctaLabel}
        </Button>
      </div>
    </div>
  )
}
