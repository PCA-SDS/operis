"use client"

import * as React from 'react'
import { SmilePlus } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import type { ChatReactionDto } from '../data/types'

/**
 * The reactions the picker offers.
 *
 * A curated row rather than a full emoji library: these cover what a workplace
 * conversation actually needs, and shipping a searchable set of several thousand
 * would add a dependency heavier than the entire chat module for a control that
 * is used a few times a day. Anything already on a message can be joined with
 * one click, so the set in practice grows with the conversation.
 */
const QUICK_REACTIONS = ['👍', '❤️', '😄', '🎉', '👀', '🙏', '✅'] as const

/**
 * The three offered inline, without opening anything.
 *
 * The overwhelmingly common reaction is one of a handful, and making even those
 * cost a click-to-open, a scan and a second click is the difference between a
 * control people use and one they do not. The rest of the set stays one click
 * away behind the picker beside them. Drawn from the same list so there is one
 * place to change what this module offers.
 */
const INLINE_REACTIONS = QUICK_REACTIONS.slice(0, 3)

/**
 * Emoji ride high in an inherited line box, so every button that holds one
 * kills the leading and lets the flex centring do the work instead.
 */
const EMOJI_GLYPH = 'leading-none'

export type QuickReactionsProps = {
  onToggle: (emoji: string) => void
}

/**
 * The reactions reachable in a single click from the hover bar.
 *
 * Sits with the message actions rather than under the bubble: an idle message
 * shows nothing at all, and everything that acts on a message is found in one
 * place.
 */
export function QuickReactions({ onToggle }: QuickReactionsProps) {
  const t = useT()
  return (
    <>
      {INLINE_REACTIONS.map((emoji) => (
        // The same `IconButton` the picker and the overflow menu beside these
        // use. Hand-rolled, they carried a different radius and a different
        // hover fill from their neighbours in the very same 155px bar.
        <IconButton
          key={emoji}
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => onToggle(emoji)}
          aria-label={t('chat.reactions.reactWith', 'React with {emoji}', { emoji })}
          className={cn(EMOJI_GLYPH, 'text-sm')}
        >
          <span aria-hidden="true">{emoji}</span>
        </IconButton>
      ))}
    </>
  )
}

export type ReactionPickerProps = {
  onToggle: (emoji: string) => void
  /** Which end of the hover bar this sits at, so the panel opens over the row. */
  align: 'start' | 'end'
}

/**
 * The control that adds a reaction.
 *
 * It lives in the hover chrome beside the other message actions rather than
 * under the bubble. Under the bubble it had to be rendered on every message so
 * it could fade in on hover — and an `opacity-0` control still occupies its
 * box, so every message in the transcript, reacted to or not, carried a 28px
 * band of dead space beneath it. In the hover bar it costs nothing when idle
 * and sits with the actions it belongs to.
 */
export function ReactionPicker({ onToggle, align }: ReactionPickerProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          type="button"
          variant="ghost"
          size="xs"
          aria-label={t('chat.reactions.add', 'Add reaction')}
        >
          <SmilePlus className="size-4" aria-hidden="true" />
        </IconButton>
      </PopoverTrigger>
      {/* `side="top"`: the trigger lives in a bar that already floats above the
          bubble, so a panel opening downwards covered the message it was about
          to react to and read as an unattached card adrift in the transcript.
          Upwards it stacks onto the bar it belongs to. */}
      <PopoverContent side="top" sideOffset={6} align={align} className="w-auto p-1">
        <div
          className="flex items-center gap-0.5"
          role="group"
          aria-label={t('chat.reactions.add', 'Add reaction')}
        >
          {QUICK_REACTIONS.map((emoji) => (
            <IconButton
              key={emoji}
              type="button"
              variant="ghost"
              // Explicit, like every other IconButton in the module. Left
              // unset this defaulted to `size-8` beside the bar's `size-6`
              // quick reactions — the same control at two sizes.
              size="sm"
              onClick={() => {
                onToggle(emoji)
                setOpen(false)
              }}
              aria-label={t('chat.reactions.reactWith', 'React with {emoji}', { emoji })}
              className={cn(EMOJI_GLYPH, 'text-base')}
            >
              <span aria-hidden="true">{emoji}</span>
            </IconButton>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export type MessageReactionsProps = {
  reactions: ChatReactionDto[]
  onToggle: (emoji: string) => void
  /** Absent for a read-only member: the chips render, but nothing responds. */
  disabled?: boolean
}

/**
 * The aggregated reaction chips under a bubble.
 *
 * Counts are aggregated server-side, so a message with fifty thumbs-up is one
 * chip rather than fifty. The tooltip names a few of the people behind it and
 * says how many more there are, which is enough to answer "who?" without
 * rendering a roster under every message.
 *
 * Nothing is rendered when there are none — the row is content, and content
 * that does not exist must not reserve a line.
 */
export function MessageReactions({ reactions, onToggle, disabled }: MessageReactionsProps) {
  const t = useT()

  if (reactions.length === 0) return null

  return (
    // No margin of its own: the footer row that holds this owns the offset, so
    // the chips and the delivery receipt beside them sit on one baseline.
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {reactions.map((reaction) => {
        const others = reaction.count - reaction.sampleNames.length
        const who = [
          ...reaction.sampleNames,
          ...(others > 0
            ? [t('chat.reactions.andOthers', 'and {count} others', { count: others })]
            : []),
        ].join(', ')

        const label = t('chat.reactions.toggleLabel', '{emoji}, {count} reacted', {
          emoji: reaction.emoji,
          count: reaction.count,
        })
        const shell = cn(
          'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors',
          reaction.mine
            ? 'border-primary bg-primary-soft font-semibold text-primary'
            : 'border-border bg-surface text-muted-foreground',
        )
        // `leading-none` on the glyph: an emoji inherits the 16px line box of
        // `text-xs` and rides high in it, which reads as a chip padded more
        // below than above even though the box is centred.
        const face = (
          <>
            <span className={EMOJI_GLYPH} aria-hidden="true">
              {reaction.emoji}
            </span>
            <span className={cn('tabular-nums', EMOJI_GLYPH)}>{reaction.count}</span>
          </>
        )

        return (
          <SimpleTooltip key={reaction.emoji} content={who}>
            {disabled ? (
              // Not a disabled button — a label.
              //
              // A `disabled` button emits no pointer events, so wrapping one in
              // a tooltip meant the person who most needs it, a read-only
              // viewer who cannot react and can only look, was the one person
              // who could never see who reacted. With nothing to press there is
              // no control here, so this stops pretending to be one: no
              // `aria-pressed`, nothing in the tab order, and the count still
              // reads out.
              <span className={shell} role="img" aria-label={label}>
                {face}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onToggle(reaction.emoji)}
                // `aria-pressed` rather than colour alone: whether you are one
                // of the people behind a count has to reach a screen reader,
                // and has to survive a reader who cannot distinguish the tint.
                aria-pressed={reaction.mine}
                aria-label={label}
                className={cn(
                  shell,
                  'outline-none focus-visible:shadow-focus',
                  !reaction.mine && 'hover:bg-surface-muted',
                )}
              >
                {face}
              </button>
            )}
          </SimpleTooltip>
        )
      })}
    </div>
  )
}
