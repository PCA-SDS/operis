"use client"

import * as React from 'react'
import { ArrowUp } from 'lucide-react'
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
export function MessageComposer({ disabled, onSend, placeholder }: MessageComposerProps) {
  const t = useT()
  const [value, setValue] = React.useState('')
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

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

  const submit = React.useCallback(() => {
    if (!canSend) return
    onSend(trimmed)
    setValue('')
    textareaRef.current?.focus()
  }, [canSend, onSend, trimmed])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== 'Enter' || event.shiftKey) return
      // While an IME is composing, Enter confirms the candidate word — it is not
      // a send. Without this check the module ships a guaranteed bug for
      // Korean, Japanese and Chinese input, and it ships a `ko` locale.
      if (event.nativeEvent.isComposing) return
      event.preventDefault()
      submit()
    },
    [submit],
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
            // Two rows of room before it grows, so a short reply has somewhere to
            // land and the box does not jump on the first character.
            'max-h-48 min-h-11 w-full resize-none overflow-y-auto px-3 pb-0 pt-3 font-normal',
            // The container owns every one of these now.
            'rounded-none border-0 bg-transparent shadow-none',
            'hover:bg-transparent focus-visible:border-0 focus-visible:bg-transparent focus-visible:shadow-none',
            'disabled:border-0 disabled:bg-transparent',
          )}
        />
        {/*
          The bottom row. Operis has no attachments, model picker or dictation, so
          the left half carries the keyboard hint instead of being padded out with
          controls that do nothing.
        */}
        <div className="flex items-center justify-between gap-3 px-3 pb-3 pt-2">
          {/* Fixed height so the box never resizes as this row's content
              changes. Idle it is blank: Enter-to-send is universal enough not to
              need restating under every message you write. The over-length case
              is an error, so it takes the error token and a live region — styled
              as muted helper text and never announced, the send button just
              silently stopped working. */}
          <p
            id="chat-composer-hint"
            role={tooLong ? 'alert' : undefined}
            className={cn(
              'flex min-h-5 min-w-0 items-center gap-2 text-xs',
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
            size="lg"
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
