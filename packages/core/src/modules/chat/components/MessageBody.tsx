"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { parseMessageBody } from '../lib/mentions'

export type MessageBodyProps = {
  body: string
  /** Display names for the ids this body names, resolved server-side with the page. */
  mentionNames: Record<string, string>
  /** The viewer, so a mention OF them can read differently from one of a colleague. */
  currentUserId: string
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
export function MessageBody({ body, mentionNames, currentUserId, className }: MessageBodyProps) {
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

  return (
    <p className={cn('whitespace-pre-wrap break-words text-sm text-foreground', className)}>
      {segments.map((segment, index) => {
        if (segment.kind === 'text') return <React.Fragment key={index}>{segment.text}</React.Fragment>

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
