"use client"

import * as React from 'react'
import { SendHorizontal } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
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
      className="flex items-end gap-2 border-t border-border bg-surface p-3"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="min-w-0 flex-1">
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
          className="max-h-40 min-h-10 resize-none overflow-y-auto"
        />
        {/* The over-length case is an error, so it takes the error token and a
            live region — styled as muted helper text and never announced, the
            send button just silently stopped working. */}
        <p
          id="chat-composer-hint"
          role={tooLong ? 'alert' : undefined}
          className={cn('mt-1 text-xs', tooLong ? 'text-status-error-text' : 'text-muted-foreground')}
        >
          {tooLong
            ? t('chat.composer.tooLong', 'Messages are limited to {max} characters.', {
                max: MAX_MESSAGE_LENGTH,
              })
            : t('chat.composer.hint', 'Enter to send, Shift+Enter for a new line')}
        </p>
      </div>
      <Button type="submit" size="default" disabled={!canSend} aria-label={t('chat.composer.send', 'Send')}>
        <SendHorizontal className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">{t('chat.composer.send', 'Send')}</span>
      </Button>
    </form>
  )
}
