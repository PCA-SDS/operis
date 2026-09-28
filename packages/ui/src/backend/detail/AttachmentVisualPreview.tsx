"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { resolveAttachmentPlaceholder } from './attachmentFiles'

type AttachmentVisualPreviewProps = {
  mimeType?: string | null
  fileName?: string | null
  thumbnailUrl?: string | null
  alt?: string
  className?: string
  imageClassName?: string
  iconClassName?: string
  labelClassName?: string
  overlay?: React.ReactNode
}

export function AttachmentVisualPreview(props: AttachmentVisualPreviewProps) {
  const [imageLoadFailed, setImageLoadFailed] = React.useState(false)
  const placeholder = React.useMemo(
    () => resolveAttachmentPlaceholder(props.mimeType, props.fileName),
    [props.fileName, props.mimeType],
  )

  React.useEffect(() => {
    setImageLoadFailed(false)
  }, [props.thumbnailUrl])

  const PlaceholderIcon = placeholder.icon
  const showThumbnail = Boolean(props.thumbnailUrl) && !imageLoadFailed

  return (
    <div className={cn('relative bg-muted', props.className)}>
      {showThumbnail ? (
        <img
          src={props.thumbnailUrl ?? undefined}
          alt={props.alt ?? props.fileName ?? 'Attachment preview'}
          className={cn('h-full w-full object-cover', props.imageClassName)}
          onError={() => setImageLoadFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center text-xs font-semibold uppercase text-muted-foreground">
          <PlaceholderIcon className={cn('mb-2 h-6 w-6', props.iconClassName)} aria-hidden />
          <span className={props.labelClassName}>{placeholder.label}</span>
        </div>
      )}
      {props.overlay}
    </div>
  )
}
