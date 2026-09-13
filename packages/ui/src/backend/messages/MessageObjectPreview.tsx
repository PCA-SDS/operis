"use client"

import { Box, type LucideIcon } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ObjectPreviewProps } from '@open-mercato/shared/modules/messages/types'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { cn } from '@open-mercato/shared/lib/utils'
import { resolveRegisteredLucideIcon } from '../icons/lucideRegistry'

/**
 * Every module's preview computes a severity name for its status chip, but the
 * chip rendered neutral, so a "Cancelled" order and a "Paid" order looked
 * identical. These are the five names the producers emit
 * (customers/sales/staff/inbox_ops/catalog/currencies/resources); anything else
 * falls through to the neutral outline.
 */
export const STATUS_TONE_CLASSES: Record<string, string> = {
  green: 'border-status-success-border bg-status-success-bg text-status-success-text',
  red: 'border-status-error-border bg-status-error-bg text-status-error-text',
  amber: 'border-status-warning-border bg-status-warning-bg text-status-warning-text',
  blue: 'border-status-info-border bg-status-info-bg text-status-info-text',
  gray: '',
}

function resolveIcon(name: string | undefined): LucideIcon {
  return resolveRegisteredLucideIcon(name) ?? Box
}

export function MessageObjectPreview({
  previewData,
  actionRequired,
  actionLabel,
  icon,
  fallbackTitleKey,
}: ObjectPreviewProps) {
  const t = useT()
  const Icon = resolveIcon(icon)
  const title = previewData?.title || (fallbackTitleKey ? t(fallbackTitleKey, '') : '')

  return (
    <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-3">
      <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{title}</p>
          {actionRequired ? (
            <Badge variant="secondary" className="text-xs">
              {actionLabel || t('messages.composer.objectActionRequired', 'Action required')}
            </Badge>
          ) : null}
        </div>
        {previewData?.subtitle ? (
          <p className="truncate text-xs text-muted-foreground">{previewData.subtitle}</p>
        ) : null}
        {previewData?.status ? (
          <Badge
            variant="outline"
            className={cn('text-xs', STATUS_TONE_CLASSES[previewData.statusColor ?? 'gray'])}
          >
            {previewData.status}
          </Badge>
        ) : null}
        {previewData?.metadata && Object.keys(previewData.metadata).length > 0 ? (
          <dl className="space-y-1 pt-1">
            {Object.entries(previewData.metadata).map(([key, value]) => (
              <div key={key} className="flex items-start gap-2 text-xs text-muted-foreground">
                <dt className="font-medium capitalize">{key}:</dt>
                <dd className="truncate">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </div>
  )
}

export default MessageObjectPreview
