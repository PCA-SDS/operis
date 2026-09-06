"use client"

import * as React from 'react'
import { ArrowUp, Paperclip, AtSign, Quote, X } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { MAX_MESSAGE_LENGTH } from '../data/validators'
import { EVERYONE_TOKEN, userToken } from '../lib/mentions'
import { applyMention, detectMentionDraft, type MentionDraft } from '../lib/mentionDraft'
import type { ChatDraftAttachment } from './useChatAttachments'
import { ComposerAttachments } from './ComposerAttachments'

/**
 * How many colleagues the menu offers at once.
 *
 * Enough to pick from without scrolling; anything longer is answered by typing
 * another letter, which is faster than reading a list.
 */
const MENTION_SUGGESTION_LIMIT = 6

/**
 * The combobox wiring. The textarea keeps focus the whole time the menu is open
 * — that is what lets someone keep typing to narrow it — so the highlighted row
 * is conveyed by `aria-activedescendant` pointing at one of these ids, not by
 * moving focus into the list.
 */
const MENTION_LISTBOX_ID = 'chat-mention-suggestions'
const mentionOptionId = (index: number) => `${MENTION_LISTBOX_ID}-option-${index}`

export type MentionCandidate = {
  id: string
  name: string
  /** `everyone` is offered alongside people, so one menu handles both. */
  kind: 'user' | 'everyone'
  subtitle?: string
}

export type MessageComposerProps = {
  disabled?: boolean
  /**
   * Who this conversation lets you name. Empty disables the menu entirely, which
   * is what a direct conversation gets: a picker to choose between the one
   * person already reading it would be friction with nothing behind it.
   */
  mentionCandidates?: MentionCandidate[]
  /**
   * The text after the `@` currently being typed, or null when no mention is in
   * progress. The parent uses it to ask the server for matches, so a space
   * larger than one page of members is still fully mentionable.
   */
  onMentionQueryChange?: (query: string | null) => void
  /** Hands the body to the transcript, which owns delivery and retry from there. */
  onSend: (body: string) => void
  /**
   * Files staged for this message, owned by the view so a conversation switch
   * clears them in one place — the same reason the reply target lives there.
   */
  attachments?: ChatDraftAttachment[]
  onAttachFiles?: (files: File[]) => void
  onRemoveAttachment?: (key: string) => void
  onRetryAttachment?: (key: string) => void
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
  mentionCandidates = [],
  onMentionQueryChange,
  attachments = [],
  onAttachFiles,
  onRemoveAttachment,
  onRetryAttachment,
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
  const anyUploading = attachments.some((item) => item.status === 'uploading')
  const anyReady = attachments.some((item) => item.status === 'ready')
  // A file on its own is a message. Waiting for uploads is deliberate: sending
  // mid-upload would drop the file without saying so.
  const canSend = (trimmed.length > 0 || anyReady) && !tooLong && !disabled && !anyUploading
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

  /**
   * The `@` the caret is inside, and the menu it opens.
   *
   * Filtering happens against the candidates the conversation already handed
   * down — its own members — so typing `@` costs no request until the query
   * outgrows the page the parent already holds. That is both faster and the
   * security posture: the menu cannot offer somebody the server would refuse,
   * because every candidate came from the membership the server validates
   * against.
   *
   * The filter still runs here over whatever the parent supplies, so a small
   * space never waits on a round-trip and `@everyone` — which is synthesised,
   * not a member — is matched by the same rule as a person.
   */
  const [draft, setDraft] = React.useState<MentionDraft | null>(null)
  const [highlighted, setHighlighted] = React.useState(0)

  const suggestions = React.useMemo(() => {
    if (!draft || mentionCandidates.length === 0) return []
    const needle = draft.query.trim().toLowerCase()
    return mentionCandidates
      .filter((candidate) => candidate.name.toLowerCase().includes(needle))
      .slice(0, MENTION_SUGGESTION_LIMIT)
  }, [draft, mentionCandidates])

  const menuOpen = draft !== null && suggestions.length > 0

  React.useEffect(() => {
    setHighlighted(0)
  }, [draft?.query])

  // Tell the parent what is being typed so it can widen the candidate list
  // beyond the first page of members. Reported rather than fetched here because
  // the parent already owns the membership query and its cache key.
  React.useEffect(() => {
    onMentionQueryChange?.(draft ? draft.query : null)
  }, [draft, onMentionQueryChange])

  const syncDraft = React.useCallback(
    (next: string) => {
      const textarea = textareaRef.current
      setDraft(detectMentionDraft(next, textarea ? textarea.selectionStart : null))
    },
    [],
  )

  const choose = React.useCallback(
    (candidate: MentionCandidate) => {
      const textarea = textareaRef.current
      if (!draft || !textarea) return
      const token = candidate.kind === 'everyone' ? EVERYONE_TOKEN : userToken(candidate.id)
      const next = applyMention(value, draft, textarea.selectionStart, token)
      setValue(next.value)
      pendingValue.current = next.value
      setDraft(null)
      // Restore the caret after React re-renders the field from state, or it
      // jumps to the end and the next word lands in the wrong place.
      requestAnimationFrame(() => {
        textarea.focus()
        textarea.setSelectionRange(next.caret, next.caret)
      })
    },
    [draft, value],
  )

  const submit = React.useCallback(() => {
    if (disabled) return
    const body = pendingValue.current.trim()
    if (body.length > MAX_MESSAGE_LENGTH) return
    // Text alone, files alone, or both — but never nothing, and never while a
    // file is still on its way, because that send would silently drop it.
    if (body.length === 0 && !anyReady) return
    if (anyUploading) return
    pendingValue.current = ''
    onSend(body)
    setValue('')
    textareaRef.current?.focus()
  }, [anyReady, anyUploading, disabled, onSend])

  /**
   * Files arriving from the picker, a drop, or a paste.
   *
   * One path for all three so they cannot diverge: the same validation, the
   * same upload, the same rows in the strip below.
   */
  const acceptFiles = React.useCallback(
    (files: FileList | File[] | null | undefined) => {
      if (!files || disabled) return
      const list = Array.from(files)
      if (list.length > 0) onAttachFiles?.(list)
    },
    [disabled, onAttachFiles],
  )

  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [isDropTarget, setIsDropTarget] = React.useState(false)
  // Counted rather than toggled: dragging over a child fires `dragleave` on the
  // parent, so a boolean flickers the drop state off while the pointer is still
  // inside.
  const dragDepth = React.useRef(0)

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // The mention menu owns these keys while it is open — Enter picks the
      // highlighted colleague rather than sending a half-typed message, and
      // Escape closes the menu rather than dropping the reply behind it.
      if (menuOpen) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          setHighlighted((current) => {
            const delta = event.key === 'ArrowDown' ? 1 : -1
            return (current + delta + suggestions.length) % suggestions.length
          })
          return
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault()
          const candidate = suggestions[highlighted]
          if (candidate) choose(candidate)
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          setDraft(null)
          return
        }
      }

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
    [choose, highlighted, menuOpen, onCancelReply, replyTarget, submit, suggestions],
  )

  return (
    <form
      // No rule above it. The composer and the transcript are the same surface,
      // so a line between them divided one panel into two; the padding already
      // separates them. Kept as `py-3` rather than absorbed into the transcript
      // so the distance is unchanged by the border going away.
      className="shrink-0 bg-surface px-4 py-3"
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
      {/* The menu sits above the box rather than floating over the transcript:
          the composer is already at the bottom of the pane, so a popover below
          it would open off-screen, and one anchored to the caret would jump as
          the field grows. Rendered in flow, it pushes the box down by its own
          height and nothing overlaps. */}
      {menuOpen ? (
        <div
          role="listbox"
          id={MENTION_LISTBOX_ID}
          aria-label={t('chat.mentions.suggestionsLabel', 'People you can mention')}
          className="mb-1 overflow-hidden rounded-xl border border-border bg-surface shadow-md"
        >
          {suggestions.map((candidate, index) => (
            <button
              key={candidate.id}
              // Focus never leaves the textarea, so the highlighted row has to
              // be announced by id from there rather than by receiving focus.
              id={mentionOptionId(index)}
              type="button"
              role="option"
              aria-selected={index === highlighted}
              // The textarea keeps focus so typing continues uninterrupted;
              // without this the blur would close the menu before the click.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => choose(candidate)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors',
                index === highlighted ? 'bg-surface-muted' : 'hover:bg-surface-muted',
              )}
            >
              {/* The same `Avatar` the person rows use, with an icon instead of
                  initials — hand-rolling the circle gave the everyone row a
                  different fill from the people directly beneath it. */}
              <Avatar
                label={candidate.name}
                size="sm"
                icon={candidate.kind === 'everyone' ? <AtSign className="size-4" /> : undefined}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {candidate.kind === 'everyone' ? `@${candidate.name}` : candidate.name}
                </span>
                {candidate.subtitle ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {candidate.subtitle}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div
        // Scoped to the composer rather than the whole page. Dropping a file on
        // a conversation you are reading is ambiguous — the composer is what
        // will carry it — and a page-wide handler also has to fight every other
        // droppable surface for the event.
        onDragEnter={(event) => {
          if (!onAttachFiles || disabled) return
          if (!event.dataTransfer?.types?.includes('Files')) return
          event.preventDefault()
          dragDepth.current += 1
          setIsDropTarget(true)
        }}
        onDragOver={(event) => {
          if (!onAttachFiles || disabled) return
          if (!event.dataTransfer?.types?.includes('Files')) return
          // Without this the browser navigates away to the dropped file, which
          // loses whatever was being written.
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={() => {
          if (!onAttachFiles || disabled) return
          // Counted, not toggled: dragging over a child fires `dragleave` on
          // the parent, so a boolean flickers off while the pointer is inside.
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setIsDropTarget(false)
        }}
        onDrop={(event) => {
          if (!onAttachFiles || disabled) return
          event.preventDefault()
          dragDepth.current = 0
          setIsDropTarget(false)
          acceptFiles(event.dataTransfer?.files)
        }}
        className={cn(
          // The tint of your own bubbles, and no border.
          //
          // What you are writing becomes a message from you, so the box you
          // write it in is the same surface those messages land on — the
          // composer reads as the next bubble in the column rather than as a
          // form control bolted underneath it. The focus ring still lands here,
          // so the field is no less findable by keyboard for having lost its
          // outline.
          'rounded-xl bg-primary-soft transition-colors',
          'focus-within:shadow-focus',
          disabled && 'bg-input-disabled-bg',
          isDropTarget && 'ring-2 ring-primary',
        )}
      >
        <ComposerAttachments
          items={attachments}
          onRemove={onRemoveAttachment}
          onRetry={onRetryAttachment}
        />

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
          onPaste={(event) => {
            if (!onAttachFiles || disabled) return
            // Only when the clipboard actually carries a file. Pasting text
            // that happens to come from a file manager must still paste text.
            const files = Array.from(event.clipboardData?.files ?? [])
            if (files.length === 0) return
            event.preventDefault()
            acceptFiles(files)
          }}
          id="chat-composer"
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            setValue(event.target.value)
            syncDraft(event.target.value)
          }}
          onKeyUp={(event) => syncDraft(event.currentTarget.value)}
          onClick={(event) => syncDraft(event.currentTarget.value)}
          onBlur={() => setDraft(null)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-describedby="chat-composer-hint"
          // Announce whichever row the arrow keys are on.
          //
          // `aria-activedescendant` and `aria-controls` are both valid on a
          // textbox, so the highlighted option is announced without the element
          // changing what it is. Promoting it to `role="combobox"` — the usual
          // reflex here — would override the textarea's native role, and a
          // MULTILINE combobox is poorly supported: screen readers stop
          // announcing it as a text area, and `aria-expanded` on one is
          // inconsistently handled. The menu is a helper over a text field, not
          // a select.
          aria-controls={menuOpen ? MENTION_LISTBOX_ID : undefined}
          aria-activedescendant={menuOpen ? mentionOptionId(highlighted) : undefined}
          aria-invalid={tooLong || undefined}
          className={cn(
            // One row of room, plus the padding — a reply that fits on a line
            // should not open a box twice its height. It grows from here.
            // `py-2`, not `pt-2.5 pb-0`: at the one-line height the field
            // opens at, 10px above the text and 6px below sat it visibly high
            // in its own box. 8/8 centres the line the caret is on.
            'max-h-48 min-h-9 w-full resize-none overflow-y-auto px-3 py-2 font-normal',
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
          {onAttachFiles ? (
            <>
              {/* The input is the control; the button is its label. Clicking the
                  button opens the picker, and the input stays reachable to a
                  screen reader rather than being hidden from it entirely. */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="sr-only"
                tabIndex={-1}
                onChange={(event) => {
                  acceptFiles(event.target.files)
                  // Cleared so choosing the same file twice in a row still
                  // fires `change` the second time.
                  event.target.value = ''
                }}
              />
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                // The hint beside these takes `flex-1`, so without this the
                // buttons are the part that gives and both render narrower than
                // their own icons. They are fixed-size controls, not filler.
                className="shrink-0"
                disabled={disabled}
                onClick={() => fileInputRef.current?.click()}
                aria-label={t('chat.composer.attach', 'Attach file')}
                title={t('chat.composer.attach', 'Attach file')}
              >
                <Paperclip className="size-4" aria-hidden="true" />
              </IconButton>
            </>
          ) : null}
          <IconButton
            type="submit"
            variant="primary"
            size="sm"
            className="shrink-0"
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
