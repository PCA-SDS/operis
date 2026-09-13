"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { parseMessageBody } from '../lib/mentions'
import { findMatchRanges } from '../lib/searchText'
import type { HighlightPlan } from '../lib/searchQuery'
import { HighlightedText } from './HighlightedText'

export type MessageBodyProps = {
  body: string
  /** Display names for the ids this body names, resolved server-side with the page. */
  mentionNames: Record<string, string>
  /** The viewer, so a mention OF them can read differently from one of a colleague. */
  currentUserId: string
  /**
   * Terms the open find bar is looking for, marked inside the text.
   *
   * Matched right here rather than served from the search response, because the
   * transcript renders messages the response never mentioned — the ones between
   * the matches — and they have to mark the same words. `findMatchRanges` is the
   * same function the results list highlights through, so the two agree.
   */
  highlight?: HighlightPlan
  /** Whether this message is the match the reader has navigated to. */
  highlightActive?: boolean
  className?: string
}

/**
 * A message body, with mentions rendered as chips.
 *
 * Every segment is emitted as a TEXT NODE — the body is split by a parser and
 * the pieces are placed as children, never assigned as HTML. A mention is
 * therefore not a route to inject markup, which matters because the token
 * syntax is the one part of a message the composer writes rather than the
 * person.
 *
 * Names come from the page's own lookup rather than being baked into the stored
 * text, so a colleague who is renamed is renamed everywhere, including in
 * messages written years ago.
 */
export function MessageBody({
  body,
  mentionNames,
  currentUserId,
  highlight,
  highlightActive = false,
  className,
}: MessageBodyProps) {
  const t = useT()

  const segments = React.useMemo(
    () =>
      // `?? {}` because a payload cached from a previous deploy may predate this
      // field, and a missing name map must render the message without its chips
      // rather than take the whole transcript down.
      parseMessageBody(body, new Map(Object.entries(mentionNames ?? {})), {
        everyone: t('chat.mentions.everyone', 'everyone'),
        unknownPerson: t('chat.list.unknownPerson', 'Former colleague'),
      }),
    [body, mentionNames, t],
  )

  /**
   * Where the query matched, per text segment.
   *
   * Memoised because it is not cheap and the transcript re-renders for reasons
   * that have nothing to do with search — a measured 0.13ms per long message,
   * which across a screenful is several milliseconds of every frame spent
   * re-deriving an answer that did not change. Keyed on the segments and the
   * terms, so it recomputes exactly when one of them does.
   *
   * Per segment, not across the whole body: the pieces are separate strings and
   * a term is not allowed to match across the mention that separates them —
   * which is how the stored search text reads it too, since indexing replaces a
   * mention with a space.
   */
  const rangesBySegment = React.useMemo(() => {
    if (!highlight?.terms.length) return null
    return segments.map((segment) =>
      segment.kind === 'text'
        ? findMatchRanges(segment.text, highlight.terms, {
            fuzzyThreshold: highlight.fuzzyThreshold,
          })
        : [],
    )
  }, [segments, highlight])

  return (
    <p
      // The message decides its own base direction from its own first strong
      // character. Arabic, Hebrew, Farsi and Urdu are all selectable reading
      // languages, and rendered in an LTR paragraph their trailing punctuation
      // lands at the wrong end and mixed runs — mention chips, numbers, URLs —
      // reorder incorrectly. Scoped to the body so the surrounding controls keep
      // the interface direction.
      dir="auto"
      className={cn('whitespace-pre-wrap break-words text-sm text-foreground', className)}>
      {segments.map((segment, index) => {
        if (segment.kind === 'text') {
          const ranges = rangesBySegment?.[index]
          if (!ranges?.length) {
            return <React.Fragment key={index}>{segment.text}</React.Fragment>
          }
          return (
            <HighlightedText
              key={index}
              text={segment.text}
              ranges={ranges}
              active={highlightActive}
            />
          )
        }

        // A mention of YOU is the one that should catch the eye while scanning a
        // busy space; a mention of somebody else is context, so it stays quiet.
        const isMe = segment.kind === 'mention' && segment.userId === currentUserId
        const addressesMe = isMe || segment.kind === 'everyone'

        return (
          <span
            key={index}
            className={cn(
              // Inline and wrapping, not a pill with its own line box — a chip
              // that could not break would push a long message sideways.
              'rounded px-0.5 font-medium',
              // `bg-primary`, not `bg-primary-soft`. Your own bubbles ARE
              // `bg-primary-soft`, so a soft-filled chip on one of them was the
              // same colour as its background and the highlight did nothing —
              // reachable any time you send a message naming yourself or
              // everyone. The strong pair reads against both bubble grounds.
              addressesMe ? 'bg-primary text-primary-foreground' : 'text-primary',
            )}
          >
            @{segment.label}
          </span>
        )
      })}
    </p>
  )
}
