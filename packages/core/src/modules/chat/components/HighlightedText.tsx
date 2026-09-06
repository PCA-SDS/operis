"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import type { ChatSearchHighlight } from '../data/types'

export type HighlightedTextProps = {
  text: string
  /** Ranges into `text`, in order and non-overlapping, as the server computed them. */
  ranges: readonly ChatSearchHighlight[]
  /**
   * Whether this is the match the reader is standing on.
   *
   * Every match in the transcript is marked, so without a stronger treatment for
   * the current one you cannot tell which of two visible matches you navigated
   * to. Telegram draws the same distinction.
   */
  active?: boolean
  className?: string
}

/**
 * Message text with the matched runs marked.
 *
 * Segments and text nodes, never markup. `MessageBody` renders chat text the
 * same way and for the same reason -- a message body is user input, and the one
 * rule that makes it safe is that it never becomes HTML. Highlighting is not a
 * good enough reason to open that door, so this splits the string and emits
 * `<mark>` around the pieces instead of interpolating tags into it.
 *
 * Ranges arrive from the server already mapped to the ORIGINAL text, which is
 * what lets an accentless query mark `báo cáo` without ever showing the reader
 * the folded form.
 */
export function HighlightedText({ text, ranges, active = false, className }: HighlightedTextProps) {
  const segments = React.useMemo(() => {
    if (ranges.length === 0) return [{ text, match: false }]

    const parts: { text: string; match: boolean }[] = []
    let cursor = 0
    for (const range of ranges) {
      // Defensive: a range outside the string would silently truncate the
      // message, which is a worse failure than not highlighting.
      const start = Math.max(cursor, Math.min(range.start, text.length))
      const end = Math.max(start, Math.min(range.end, text.length))
      if (start > cursor) parts.push({ text: text.slice(cursor, start), match: false })
      if (end > start) parts.push({ text: text.slice(start, end), match: true })
      cursor = end
    }
    if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false })
    return parts
  }, [text, ranges])

  return (
    <span className={cn('whitespace-pre-wrap break-words', className)}>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark
            key={index}
            // Semantic tokens, and both a background and a weight change: colour
            // alone would carry the whole signal, which fails for anyone who
            // cannot distinguish it.
            //
            // The active pair is the same strong one a mention of you already
            // uses in this transcript, so "this one is about you right now"
            // reads the same way twice rather than inventing a second language.
            className={cn(
              'rounded-sm px-0.5 font-medium',
              active
                ? 'bg-primary text-primary-foreground'
                : 'bg-status-warning-bg text-status-warning-text',
            )}
          >
            {segment.text}
          </mark>
        ) : (
          <React.Fragment key={index}>{segment.text}</React.Fragment>
        ),
      )}
    </span>
  )
}
