"use client"

import * as React from 'react'
import { FileText, RotateCcw, X } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { ChatDraftAttachment } from './useChatAttachments'

/**
 * What is riding on the message you are writing.
 *
 * Shown before the message is sent, because the moment to notice you attached
 * the wrong thing is while you can still take it off. Every row can be removed,
 * and a row that failed can be retried without finding the file again.
 */

export type ComposerAttachmentsProps = {
  items: ChatDraftAttachment[]
  onRemove?: (key: string) => void
  onRetry?: (key: string) => void
}

/** Bytes as something a person reads, not as a number of bytes. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  // One decimal below 10 so "1.4 MB" stays useful and "234 KB" stays short.
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

export function ComposerAttachments({ items, onRemove, onRetry }: ComposerAttachmentsProps) {
  const t = useT()
  if (items.length === 0) return null

  return (
    <ul
      className="flex flex-wrap gap-2 px-3 pt-3"
      aria-label={t('chat.attachments.staged', 'Attachments on this message')}
    >
      {items.map((item) => {
        const failed = item.status === 'error'
        const uploading = item.status === 'uploading'
        return (
          <li
            key={item.key}
            className={cn(
              'relative flex w-56 items-center gap-2 rounded-lg border bg-surface p-2',
              failed ? 'border-status-error-border' : 'border-border',
            )}
          >
            {item.previewUrl ? (
              // The local file, so an image appears immediately rather than
              // after a round trip. `object-cover` keeps the aspect ratio
              // honest inside a fixed box so the row heights stay even.
              <img
                src={item.previewUrl}
                alt=""
                className="size-10 shrink-0 rounded object-cover"
              />
            ) : (
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded bg-surface-muted"
                aria-hidden="true"
              >
                <FileText className="size-5 text-muted-foreground" />
              </span>
            )}

            <div className="min-w-0 flex-1">
              {/* `break-all` on a filename, not `truncate`: the distinguishing
                  part of `report-2026-final-v3.pdf` is the end. */}
              <p className="truncate text-xs font-medium text-foreground" title={item.fileName}>
                {item.fileName}
              </p>
              {uploading ? (
                <Progress
                  value={Math.round(item.progress * 100)}
                  className="mt-1 h-1"
                  aria-label={t('chat.attachments.uploading', 'Uploading {name}', {
                    name: item.fileName,
                  })}
                />
              ) : (
                <p
                  className={cn(
                    'truncate text-xs',
                    failed ? 'text-status-error-text' : 'text-muted-foreground',
                  )}
                  // Announced so a failure is not something you only find out
                  // about by looking.
                  role={failed ? 'alert' : undefined}
                >
                  {failed
                    ? (item.failure?.message ?? t('chat.attachments.failed', "Couldn't upload"))
                    : formatFileSize(item.fileSize)}
                </p>
              )}
            </div>

            {failed && onRetry ? (
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onRetry(item.key)}
                aria-label={t('chat.attachments.retry', 'Try {name} again', { name: item.fileName })}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
              </IconButton>
            ) : null}

            {onRemove ? (
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onRemove(item.key)}
                aria-label={t('chat.attachments.remove', 'Remove {name}', { name: item.fileName })}
              >
                <X className="size-3.5" aria-hidden="true" />
              </IconButton>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
