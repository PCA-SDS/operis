"use client"

import * as React from 'react'
import { ArrowUp, Quote, X } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { MAX_MESSAGE_LENGTH } from '../data/validators'

export type MessageComposerProps = {
  disabled?: boolean
  /** Hands the body to the transcript, which owns delivery and retry from there. */
  onSend: (body: string) => void
  placeholder: string
  /**
   * The message being replied to, owned by the view — so switching conversation
   * clears it in one place rather than the composer having to know about routes.
   */
  replyTarget?: { authorName: string; body: string } | null
  onCancelReply?: () => void
}

/**
 * The message box.
 *
 * Enter sends and Shift+Enter breaks the line — the convention every chat app
 * shares, so muscle memory transfers.
 *
 * The draft clears the moment it is handed off, and the transcript shows it as a
 * pending bubble. That is deliberate: keeping the text here *as well* while a
 * failed bubble also held it gave the same message two retry affordances, and
 * only one of them reused the idempotency key — so pressing Enter again after a
 * failure could genuinely deliver the message twice. One copy, one retry.
 */
export function MessageComposer({
  disabled,
  onSend,
  placeholder,
  replyTarget,
  onCancelReply,
}: MessageComposerProps) {
  const t = useT()
  const [value, setValue] = React.useState('')
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  /**
   * Choosing "Reply" puts the cursor in the box.
   *
   * Without it the action selects a target and then leaves the writer to find
   * the field themselves — and for a keyboard user, focus would still be back in
   * the transcript's action menu, which has just closed.
   */
  const replyMessageId = replyTarget ? `${replyTarget.authorName}:${replyTarget.body}` : null
  React.useEffect(() => {
    if (!replyMessageId || disabled) return
    textareaRef.current?.focus()
  }, [disabled, replyMessageId])

  /**
   * Grow the box with the message, up to the max height the class sets.
   * Without this a Shift+Enter message scrolls inside a one-line field and the
   * writer cannot see what they are writing.
   */
  React.useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [value])

  const trimmed = value.trim()
  const tooLong = trimmed.length > MAX_MESSAGE_LENGTH
  const canSend = trimmed.length > 0 && !tooLong && !disabled
  const remaining = MAX_MESSAGE_LENGTH - trimmed.length
  const nearLimit = !tooLong && remaining <= Math.round(MAX_MESSAGE_LENGTH / 10)

  /**
   * What has actually been handed off, tracked outside React state.
   *
   * `setValue('')` does not take effect until the next render, so three clicks
   * on Send inside one tick all read the same `trimmed` and all called `onSend`
   * — and because each send mints its OWN `clientMessageId`, the server saw
   * three distinct messages and idempotency could not collapse them. Measured:
   * a triple click posted the message three times.
   *
   * The ref clears synchronously, so the second and third clicks of a
   * double-click see an empty box and do nothing, while typing something new
   * re-arms it immediately. Guarding by disabling the button instead would also
   * have blocked the legitimate case of sending two different lines quickly.
   */
  const pendingValue = React.useRef(value)
  pendingValue.current = value

  const submit = React.useCallback(() => {
    if (disabled) return
    const body = pendingValue.current.trim()
    if (body.length === 0 || body.length > MAX_MESSAGE_LENGTH) return
    pendingValue.current = ''
    onSend(body)
    setValue('')
    textareaRef.current?.focus()
  }, [disabled, onSend])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Escape drops the reply before it drops anything else — the same key that
      // dismisses a dialog dismisses this, and it does not clear the draft, so a
      // mistaken Reply costs nothing that was typed.
      if (event.key === 'Escape' && replyTarget && onCancelReply) {
        event.preventDefault()
        onCancelReply()
        return
      }
      if (event.key !== 'Enter' || event.shiftKey) return
      // While an IME is composing, Enter confirms the candidate word — it is not
      // a send. Without this check the module ships a guaranteed bug for
      // Korean, Japanese and Chinese input, and it ships a `ko` locale.
      if (event.nativeEvent.isComposing) return
      event.preventDefault()
      submit()
    },
    [onCancelReply, replyTarget, submit],
  )

  return (
    <form
      className="shrink-0 border-t border-border bg-surface px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      {/*
        One control, not two.

        The field and the send button live inside a single bordered box, and the
        box — not the textarea — carries the border, the radius and the focus
        ring. That is what makes the pair read as one input rather than a field
        with a button parked beside it, and it removes the alignment problem at
        the root: there is no second element to keep level with the first.

        The DS textarea is stripped back to a bare text surface for this
        (`border-0`, transparent, no ring of its own) and the container reproduces
        those states with `focus-within`, so focus and disabled still look exactly
        like every other input in the product.
      */}
      <div
        className={cn(
          'rounded-xl border border-input bg-input-bg transition-colors',
          'focus-within:border-input-border-focus focus-within:shadow-focus',
          disabled && 'bg-input-disabled-bg border-border-disabled',
        )}
      >
        {/* Inside the box, above the field: the reply is part of the message
            being written, not a banner floating over the composer.

            The same card the sent bubble will carry — quote glyph, the author's
            avatar and name, then up to three lines of what they said — so what
            you are about to send looks like what you will have sent. */}
        {replyTarget ? (
          <div className="px-3 pt-3">
            <div className="flex items-start gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5">
              <Quote
                className="mt-1 size-3 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Avatar label={replyTarget.authorName} size="xs" />
                  <span className="min-w-0 truncate text-xs font-semibold text-foreground">
                    {replyTarget.authorName}
                  </span>
                  {/* The glyph, the avatar and the name say "quote" to anyone who
                      can see them; this says it to anyone who cannot. */}
                  <span className="sr-only">
                    {t('chat.reply.replyingTo', 'Replying to {name}', {
                      name: replyTarget.authorName,
                    })}
                  </span>
                </div>
                <p
                  className={cn(
                    'mt-0.5 whitespace-pre-wrap break-words text-xs',
                    replyTarget.body.length > 0
                      ? 'line-clamp-3 text-foreground'
                      : 'italic text-muted-foreground',
                  )}
                >
                  {replyTarget.body.length > 0
                    ? replyTarget.body
                    : t('chat.reply.unavailable', 'Original message unavailable')}
                </p>
              </div>
              {onCancelReply ? (
                <IconButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-mr-1 -mt-0.5 shrink-0"
                  aria-label={t('chat.reply.cancel', 'Cancel reply')}
                  onClick={onCancelReply}
                >
                  <X className="size-4" aria-hidden="true" />
                </IconButton>
              ) : null}
            </div>
          </div>
        ) : null}

        <label className="sr-only" htmlFor="chat-composer">
          {t('chat.composer.label', 'Message')}
        </label>
        <Textarea
          id="chat-composer"
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-describedby="chat-composer-hint"
          aria-invalid={tooLong || undefined}
          className={cn(
            // One row of room, plus the padding — a reply that fits on a line
            // should not open a box twice its height. It grows from here.
            'max-h-48 min-h-9 w-full resize-none overflow-y-auto px-3 pb-0 pt-2.5 font-normal',
            // The container owns every one of these now.
            'rounded-none border-0 bg-transparent shadow-none',
            'hover:bg-transparent focus-visible:border-0 focus-visible:bg-transparent focus-visible:shadow-none',
            'disabled:border-0 disabled:bg-transparent',
          )}
        />
        {/*
          The send control sits on the field's own line, tucked to the trailing
          edge, rather than on a row of its own beneath it.

          The row below cost 58px of chrome around a 44px field — more than half
          the composer was empty space held open for one button. Operis has no
          attachments, model picker or dictation to put beside it, so that row
          was reserving width for controls that will never arrive.

          The counter keeps its place in the flow above the button so the box
          does not resize when it appears, and it only appears near the limit.
        */}
        {/* `items-center`, not `items-end`. The counter's box is 32px and the
            send button 28px, so bottom-aligning them left their optical centres
            2px apart — the number sat low against the button beside it. */}
        <div className="flex items-center gap-2 px-2 pb-2">
          {/* Fixed height so nothing shifts as this appears and disappears.
              Idle it is blank: Enter-to-send is universal enough not to need
              restating under every message you write. The over-length case is an
              error, so it takes the error token and a live region — styled as
              muted helper text and never announced, the send button just
              silently stopped working. */}
          <p
            id="chat-composer-hint"
            role={tooLong ? 'alert' : undefined}
            className={cn(
              'flex min-h-7 min-w-0 flex-1 items-center gap-2 pl-1 text-xs',
              tooLong ? 'text-status-error-text' : 'text-muted-foreground',
            )}
          >
            {tooLong
              ? t('chat.composer.tooLong', 'Messages are limited to {max} characters.', {
                  max: MAX_MESSAGE_LENGTH,
                })
              : /* The count appears only once it is close to mattering, so the
                   limit stops being a surprise without nagging about it. */
                nearLimit
                ? <span className="tabular-nums">{remaining}</span>
                : null}
          </p>
          <IconButton
            type="submit"
            variant="primary"
            size="sm"
            disabled={!canSend}
            aria-label={t('chat.composer.send', 'Send')}
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </IconButton>
        </div>
      </div>
    </form>
  )
}
