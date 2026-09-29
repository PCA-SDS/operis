'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type IntegrationOption = {
  id: string
  title: string
  category?: string
}

type IntegrationOptionsResponse = {
  items: IntegrationOption[]
}

export function IntegrationVisibilityDialog({
  open,
  onOpenChange,
  pinnedIds,
  onTogglePinned,
  onReset,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pinnedIds: readonly string[]
  onTogglePinned: (id: string, pinned: boolean) => void
  onReset: () => void
}) {
  const t = useT()
  const [options, setOptions] = React.useState<IntegrationOption[] | null>(null)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const pinnedSet = React.useMemo(() => new Set(pinnedIds), [pinnedIds])

  React.useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let cancelled = false
    setLoadFailed(false)
    apiCall<IntegrationOptionsResponse>('/api/integrations?sort=title&order=asc&pageSize=100', { signal: controller.signal }, {
      fallback: { items: [] },
    })
      .then((call) => {
        if (cancelled) return
        if (!call.ok) {
          setLoadFailed(true)
          return
        }
        setOptions(call.result?.items ?? [])
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [open])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      onOpenChange(false)
    }
  }, [onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('integrations.marketplace.customize.title', 'Choose integrations to show')}</DialogTitle>
          <DialogDescription>
            {t(
              'integrations.marketplace.customize.description',
              'Pick which integrations appear on the main page. Your choice is saved in this browser.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {loadFailed ? (
            <p className="text-sm text-status-error-text">{t('integrations.marketplace.loadError')}</p>
          ) : options === null ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {options.map((option) => (
                <li key={option.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{option.title}</p>
                    {option.category ? (
                      <p className="text-xs text-muted-foreground">
                        {t(`integrations.marketplace.categories.${option.category}`, option.category)}
                      </p>
                    ) : null}
                  </div>
                  <Switch
                    checked={pinnedSet.has(option.id)}
                    onCheckedChange={(checked) => onTogglePinned(option.id, checked)}
                    aria-label={t('integrations.marketplace.customize.showOnMain', 'Show {{title}} on the main page', {
                      title: option.title,
                    })}
                  />
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
        <DialogFooter
          bordered
          leading={(
            <Button type="button" variant="ghost" onClick={onReset}>
              {t('integrations.marketplace.customize.reset', 'Reset to defaults')}
            </Button>
          )}
        >
          <Button type="button" onClick={() => onOpenChange(false)}>
            {t('integrations.marketplace.customize.done', 'Done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
