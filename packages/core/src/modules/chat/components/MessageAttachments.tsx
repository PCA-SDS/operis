"use client"

import * as React from 'react'
import { Download, FileText, ImageOff, ShieldAlert } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { ChatAttachmentDto } from '../data/types'
import { formatFileSize } from './ComposerAttachments'

/**
 * The files a message carries.
 *
 * Every URL here points at the authorized attachment route, never at storage.
 * That is the whole reason the id is the stable reference: a transcript that is
 * cached, copied or forwarded carries no means of reaching the bytes, and every
 * fetch re-checks membership at the moment it is made.
 */

export type MessageAttachmentsProps = {
  /**
   * Optional because a payload cached from a previous deploy predates the
   * field, and a transcript must render without its files rather than take the
   * whole conversation down — the same reason `MessageBody` guards its name map.
   */
  attachments?: readonly ChatAttachmentDto[]
  /** Own messages sit on a tinted bubble, so the cards need the other ground. */
  onOwnBubble?: boolean
  onPreview?: (attachment: ChatAttachmentDto) => void
}

/** The authorized endpoint for an attachment's bytes. */
export function attachmentHref(attachmentId: string): string {
  return `/api/attachments/file/${attachmentId}`
}

/** The image route, which serves a derived variant rather than the original. */
export function attachmentImageHref(attachmentId: string, variant: 'thumb' | 'preview'): string {
  return `/api/attachments/image/${attachmentId}/${variant}`
}

export function MessageAttachments({
  attachments = [],
  onOwnBubble = false,
  onPreview,
}: MessageAttachmentsProps) {
  const t = useT()
  if (attachments.length === 0) return null

  const media = attachments.filter((one) => one.kind === 'media' && one.status === 'ready')
  const files = attachments.filter((one) => one.kind !== 'media' || one.status !== 'ready')

  return (
    <div className="mt-2 flex flex-col gap-2">
      {media.length > 0 ? (
        <ul
          className={cn(
            'grid gap-1',
            // One image gets the room to be looked at; several become a grid so
            // a message with twenty photos does not become twenty screens.
            media.length === 1 ? 'grid-cols-1' : media.length === 2 ? 'grid-cols-2' : 'grid-cols-3',
          )}
        >
          {media.map((attachment) => (
            <li key={attachment.id} className="min-w-0">
              <MessageImage
                attachment={attachment}
                onOwnBubble={onOwnBubble}
                onPreview={onPreview}
                sole={media.length === 1}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {files.map((attachment) => {
        const blocked = attachment.status === 'rejected' || attachment.status === 'failed'
        const pending = attachment.status === 'pending'
        return (
          <div
            key={attachment.id}
            className={cn(
              'flex items-center gap-2 rounded-lg border p-2',
              blocked ? 'border-status-error-border' : 'border-border',
              onOwnBubble ? 'bg-surface' : 'bg-surface-muted',
            )}
          >
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded bg-surface-muted"
              aria-hidden="true"
            >
              {blocked ? (
                <ShieldAlert className="size-4 text-status-error-text" />
              ) : (
                <FileText className="size-4 text-muted-foreground" />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground" title={attachment.fileName}>
                {attachment.fileName}
              </p>
              <p
                className={cn(
                  'truncate text-xs',
                  blocked ? 'text-status-error-text' : 'text-muted-foreground',
                )}
              >
                {attachment.status === 'rejected'
                  ? t('chat.attachments.rejected', "Didn't pass the security check")
                  : attachment.status === 'failed'
                    ? t('chat.attachments.unavailable', 'Unavailable')
                    : pending
                      ? t('chat.attachments.checking', 'Checking…')
                      : formatFileSize(attachment.fileSize)}
              </p>
            </div>

            {/* No control at all while a file is unavailable, rather than one
                that leads nowhere (§108). There is nothing to download. */}
            {attachment.status === 'ready' ? (
              <Button variant="ghost" size="sm" asChild className="shrink-0 gap-1.5">
                <a href={attachmentHref(attachment.id)} download={attachment.fileName}>
                  <Download className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">
                    {t('chat.attachments.download', 'Download {name}', {
                      name: attachment.fileName,
                    })}
                  </span>
                </a>
              </Button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/**
 * One image in a message.
 *
 * The box reserves its height before the image arrives. Without that the row is
 * nearly flat at first paint and grows when the bytes land, which pushes the
 * transcript down after it has already scrolled to the bottom — and a scroll
 * event fired by that growth tells the follow-the-bottom rule the reader has
 * moved away, so it stops re-pinning and the newest message ends up half off
 * the screen. Reserving the space means there is no growth to chase.
 *
 * A failure is a state, not an absence. A broken-image glyph with a filename
 * beside it is the browser's answer, not ours; a file card is something the
 * reader can still act on.
 */
function MessageImage({
  attachment,
  onOwnBubble,
  onPreview,
  sole,
}: {
  attachment: ChatAttachmentDto
  onOwnBubble: boolean
  onPreview?: (attachment: ChatAttachmentDto) => void
  sole: boolean
}) {
  const t = useT()
  const [failed, setFailed] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)

  if (failed) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border border-border p-2',
          onOwnBubble ? 'bg-surface' : 'bg-surface-muted',
        )}
      >
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded bg-surface-muted"
          aria-hidden="true"
        >
          <ImageOff className="size-4 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground" title={attachment.fileName}>
            {attachment.fileName}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {t('chat.attachments.previewUnavailable', 'Preview unavailable')}
          </p>
        </div>
        <Button variant="ghost" size="sm" asChild className="shrink-0">
          <a href={attachmentHref(attachment.id)} download={attachment.fileName}>
            <Download className="size-3.5" aria-hidden="true" />
            <span className="sr-only">
              {t('chat.attachments.download', 'Download {name}', { name: attachment.fileName })}
            </span>
          </a>
        </Button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onPreview?.(attachment)}
      className={cn(
        'block w-full overflow-hidden rounded-lg outline-none focus-visible:shadow-focus',
        // The height exists before the image does. `aspect-video` for a lone
        // image and a square in a grid are both guesses at the real ratio, but
        // a guess that holds its space beats a correct answer that arrives late.
        sole ? 'aspect-video max-h-72' : 'aspect-square',
        // A quiet ground while it loads, so the reserved space reads as a
        // picture arriving rather than as a gap.
        !loaded && 'animate-pulse bg-surface-muted',
      )}
      aria-label={t('chat.attachments.open', 'Open {name}', { name: attachment.fileName })}
    >
      <img
        // The derived thumbnail, never the original: a transcript that fetched
        // full-resolution originals would download tens of megabytes to draw
        // thumbnails nobody has clicked.
        src={attachmentImageHref(attachment.id, 'thumb')}
        alt={attachment.fileName}
        // Off-screen images are not fetched until scrolled to, which is what
        // keeps a long transcript cheap.
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </button>
  )
}
