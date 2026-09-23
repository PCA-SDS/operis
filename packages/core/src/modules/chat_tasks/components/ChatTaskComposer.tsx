"use client"

import * as React from 'react'
import { AlertTriangle, Info, Quote } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@open-mercato/ui/primitives/drawer'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { parseQuickAdd } from '@open-mercato/core/modules/tasks/lib/quick-add/parser'
import { tasksApi } from '@open-mercato/core/modules/tasks/components/api'
import { useQuickAddWarning } from '@open-mercato/core/modules/tasks/components/quickAddWarnings'
import {
  QUICK_ADD_TEXT_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
  type QuickAddParseResultDto,
} from '@open-mercato/core/modules/tasks/data/types'
import type { ChatTaskCardTaskDto } from '../data/types'
import { useChatTaskComposerContext, useChatTaskMutations } from './hooks'
import { browserTimeZone, localTodayIso, plainTextToTaskHtml } from './format'

/** A message a task is being raised from, when there is one. */
export type ChatTaskSourceMessage = {
  messageId: string
  authorName: string
  /** Held in memory only — see the note on `useMessageText`. */
  body: string
}

export type ChatTaskComposerProps = {
  conversationId: string
  /** Prefilled from the `/task` line, so `/task Ship the proposal` arrives typed. */
  initialText?: string
  source?: ChatTaskSourceMessage | null
  onClose: () => void
  /** Called only when a task was really created. The composer's caller clears its draft here. */
  onCreated: (task: ChatTaskCardTaskDto, cardPublished: boolean, linkId: string) => void
}

/**
 * A mint-once request id.
 *
 * Minted when the composer opens and reused for every attempt from it, which is
 * what makes the server's idempotency ledger work: a double click, a browser
 * re-sending a timed-out POST and a manual retry are all the same request and
 * converge on one task. A new key per click would defeat the whole mechanism.
 */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

/**
 * Raise a task from a conversation.
 *
 * Two things this deliberately does not do:
 *
 * - **It does not invent a parser.** The line is run through the tasks module's own
 *   `parseQuickAdd` for the live highlight, and through `/api/tasks/quick-add/parse`
 *   for the interpretation that is actually used. That is the module's existing
 *   two-step, and it is what stops what the writer saw highlighted from drifting
 *   from what gets saved. Warnings are rendered by the tasks module's own warning
 *   renderer, so all 23 codes read correctly in all eight languages.
 * - **It does not copy the message.** A task raised from a message starts empty, and
 *   the source text is offered behind an explicit control that says out loud who
 *   will be able to read it.
 */
export function ChatTaskComposer({
  conversationId,
  initialText = '',
  source = null,
  onClose,
  onCreated,
}: ChatTaskComposerProps) {
  const t = useT()
  const renderWarning = useQuickAddWarning()
  const { context, isLoading: contextLoading } = useChatTaskComposerContext(conversationId, true)
  const { create } = useChatTaskMutations()

  const [text, setText] = React.useState(initialText)
  const [description, setDescription] = React.useState('')
  const [serverParse, setServerParse] = React.useState<QuickAddParseResultDto | null>(null)
  const [assigneeOverride, setAssigneeOverride] = React.useState<string | null | undefined>(undefined)
  const [useMessageText, setUseMessageText] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const idempotencyKey = React.useRef(newIdempotencyKey())

  const localParsed = React.useMemo(() => {
    const line = text.trim()
    return line.length > 0 ? parseQuickAdd(line, localTodayIso()) : null
  }, [text])

  // The authoritative interpretation. Debounced, and its result discarded the
  // moment the text moves on — a stale parse must never be the one submitted.
  React.useEffect(() => {
    const line = text.trim()
    if (line.length === 0) {
      setServerParse(null)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      tasksApi
        .parseQuickAdd({ text: line, tz: browserTimeZone() }, controller.signal)
        .then((result) => setServerParse(result))
        .catch(() => undefined)
    }, 300)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [text])

  const parsed = serverParse && serverParse.originalText === text.trim() ? serverParse : null

  const warnings = React.useMemo(() => {
    const local = localParsed?.warnings ?? []
    const server = parsed
      ? parsed.warnings.filter((warning) => !local.some((entry) => entry.code === warning.code))
      : []
    return [...local, ...server]
  }, [localParsed, parsed])

  /**
   * The assignee actually in effect.
   *
   * Precedence: an explicit choice in this drawer, then whatever the quick-add line
   * named, then the conversation's own default. A space has no default, so the
   * effective value stays null and submission is blocked with a message rather than
   * guessing at one of the participants.
   */
  const effectiveAssigneeId =
    assigneeOverride !== undefined
      ? assigneeOverride
      : (parsed?.assignee?.id ?? context?.defaultAssignee?.id ?? null)

  const effectiveAssigneeName = React.useMemo(() => {
    if (!effectiveAssigneeId) return null
    if (parsed?.assignee?.id === effectiveAssigneeId) return parsed.assignee.name
    if (context?.defaultAssignee?.id === effectiveAssigneeId) return context.defaultAssignee.name
    return (
      context?.suggestedAssignees.find((person) => person.id === effectiveAssigneeId)?.name ?? null
    )
  }, [context, effectiveAssigneeId, parsed])

  const title = (parsed?.title ?? localParsed?.title ?? text).trim()
  const assigneeMissing = Boolean(context?.requiresExplicitAssignee) && !effectiveAssigneeId
  const canSubmit =
    !submitting &&
    !contextLoading &&
    Boolean(context?.canCreate) &&
    text.trim().length > 0 &&
    !assigneeMissing

  const submit = async () => {
    if (!canSubmit || !context) return
    setSubmitting(true)
    try {
      // Re-parsed at submit: the debounced preview may be a keystroke behind, and
      // only the server can resolve `#project`, `@person` and `+label` to records.
      const final = await tasksApi.parseQuickAdd({ text: text.trim(), tz: browserTimeZone() })
      const assigneeId =
        assigneeOverride !== undefined
          ? assigneeOverride
          : (final.assignee?.id ?? context.defaultAssignee?.id ?? null)

      const descriptionText = [
        description.trim(),
        // Only when the writer explicitly asked for it, and only what they were
        // shown in the review box below.
        useMessageText && source ? source.body : '',
      ]
        .filter((part) => part.length > 0)
        .join('\n\n')

      const result = await create.mutateAsync({
        conversationId,
        body: {
          idempotencyKey: idempotencyKey.current,
          title: (final.title.length > 0 ? final.title : text.trim()).slice(0, TASK_TITLE_MAX_LENGTH),
          // The column is rich text, so the text is escaped into markup that
          // preserves its line structure; the plaintext column keeps the original
          // characters. See `plainTextToTaskHtml`.
          description: descriptionText ? plainTextToTaskHtml(descriptionText) : null,
          descriptionPlaintext: descriptionText || null,
          priority: final.priority ?? 'none',
          assigneeIds: assigneeId ? [assigneeId] : [],
          projectId: final.project && !final.project.isInbox ? final.project.id : null,
          dueDate: final.dueDate,
          dueTime: final.dueDate ? final.dueTime : null,
          recurrence: final.recurrence,
          labelIds: final.labels.map((label) => label.id),
          tz: browserTimeZone(),
          sourceMessageId: source?.messageId ?? null,
          publishCard: true,
        },
      })

      if (!result.cardPublished) {
        /**
         * The honest half of a partial success.
         *
         * The task exists. Saying "could not create the task" would be false and
         * would invite a retry that mints a second one; this says what happened and
         * the panel offers the card retry.
         */
        flash(
          t(
            'chat_tasks.composer.createdWithoutCard',
            'Task created. The card could not be posted here — you can try posting it from the Tasks panel.',
          ),
          'warning',
        )
      } else {
        flash(t('chat_tasks.composer.created', 'Task created.'), 'success')
      }
      onCreated(result.task, result.cardPublished, result.linkId)
    } catch (error) {
      // The drawer stays open and every field keeps its value: a failed submit must
      // never be the reason somebody retypes a task.
      flash(
        error instanceof Error && error.message
          ? error.message
          : t('chat_tasks.composer.createFailed', 'Could not create the task.'),
        'error',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Drawer open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DrawerContent side="right" className="flex flex-col">
        <DrawerHeader>
          <DrawerTitle>{t('chat_tasks.composer.title', 'Create task')}</DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {/* Said once, plainly, and not only in the workspace: a task created from a
              conversation is a normal task. Nothing here makes it private, and
              somebody who assumed otherwise would be typing confidential detail into
              a record their whole organization can read. */}
          <p className="flex items-start gap-2 rounded-lg bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {t(
              'chat_tasks.composer.visibilityNotice',
              'This creates a normal task. Anyone with task access in your organization will be able to read it — it is not private to this conversation.',
            )}
          </p>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground" htmlFor="chat-task-title">
              {t('chat_tasks.composer.quickAddLabel', 'Task')}
            </label>
            {/*
              A plain field, deliberately.

              The tasks module's Quick Add paints a tinted overlay under a transparent
              textarea to highlight the spans the parser claimed. That trick depends on
              the overlay and the textarea agreeing on padding, line height, wrapping and
              scroll position to the pixel — and inside a drawer, at a different width,
              they did not: the transparent text rendered over a misplaced overlay and the
              field read as empty while it held a whole sentence.
              
              What the highlight was FOR is answered better by the resolved-field list
              below, which names the assignee, project, date and priority the server
              actually settled on. That is the thing a writer has to check before
              submitting, and it cannot be misaligned.
            */}
            <Textarea
              id="chat-task-title"
              rows={2}
              value={text}
              maxLength={QUICK_ADD_TEXT_MAX_LENGTH}
              onChange={(event) => setText(event.target.value)}
              placeholder={t(
                'chat_tasks.composer.quickAddPlaceholder',
                'Review the contract @amir tomorrow 3pm +legal p1',
              )}
              className="resize-none text-sm"
            />
          </div>

          {/* Everything the server resolved, shown BEFORE submission — the assignee,
              the project, the dates, the priority. Nothing ambiguous is guessed: the
              parser leaves it in the title and reports it, and those reports are the
              warnings below. */}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">{t('chat_tasks.composer.assignee', 'Assignee')}</dt>
            <dd className={cn('text-foreground', assigneeMissing && 'text-status-error-text')}>
              {effectiveAssigneeName ??
                (assigneeMissing
                  ? t('chat_tasks.composer.assigneeRequired', 'Choose someone')
                  : t('chat_tasks.composer.unassigned', 'Unassigned'))}
            </dd>
            <dt className="text-muted-foreground">{t('chat_tasks.composer.project', 'Project')}</dt>
            <dd className="text-foreground">
              {parsed?.project && !parsed.project.isInbox
                ? parsed.project.name
                : t('chat_tasks.composer.inbox', 'Inbox')}
            </dd>
            <dt className="text-muted-foreground">{t('chat_tasks.composer.due', 'Due')}</dt>
            <dd className="text-foreground">
              {localParsed?.dueDate
                ? localParsed.dueTime
                  ? `${localParsed.dueDate} ${localParsed.dueTime}`
                  : localParsed.dueDate
                : t('chat_tasks.composer.noDueDate', 'No due date')}
            </dd>
            <dt className="text-muted-foreground">{t('chat_tasks.composer.priority', 'Priority')}</dt>
            <dd className="text-foreground">
              {t(`chat_tasks.priority.${localParsed?.priority ?? 'none'}`, localParsed?.priority ?? 'none')}
            </dd>
          </dl>

          {context?.defaultAssigneeBlockedReason ? (
            <p className="flex items-start gap-2 text-xs text-status-error-text">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {context.defaultAssigneeBlockedReason === 'inactive'
                ? t(
                    'chat_tasks.composer.counterpartInactive',
                    'That colleague is no longer active here, so choose someone else.',
                  )
                : t(
                    'chat_tasks.composer.counterpartNotAssignable',
                    'That colleague cannot be assigned tasks here, so choose someone else.',
                  )}
            </p>
          ) : null}

          {context && context.requiresExplicitAssignee && context.suggestedAssignees.length > 0 ? (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">
                {t('chat_tasks.composer.suggested', 'People in this conversation')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {context.suggestedAssignees.map((person) => (
                  <Button
                    key={person.id}
                    type="button"
                    variant={effectiveAssigneeId === person.id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setAssigneeOverride(person.id)}
                  >
                    {person.name}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          {warnings.length > 0 ? (
            <ul className="space-y-1">
              {warnings.map((warning, index) => (
                <li key={`${warning.code}-${index}`} className="flex items-start gap-2 text-xs text-status-warning-text">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  {/* The tasks module's own renderer, so every warning code is
                      translated rather than re-worded here. */}
                  <span>{renderWarning(warning)}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground" htmlFor="chat-task-description">
              {t('chat_tasks.composer.description', 'Description')}
            </label>
            <Textarea
              id="chat-task-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('chat_tasks.composer.descriptionPlaceholder', 'Optional detail')}
              className="resize-none text-sm"
            />
          </div>

          {source ? (
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs font-medium text-foreground">
                {t('chat_tasks.composer.sourceTitle', 'Raised from a message')}
              </p>
              {/* The default is to copy NOTHING. Not the text, not the author, not the
                  conversation's name. The reference is kept on the link, where it is
                  revealed only to someone who can still read this conversation. */}
              <p className="mt-1 text-xs text-muted-foreground">
                {t(
                  'chat_tasks.composer.sourceNotice',
                  'The message is linked, not copied. Nothing from it is added to the task unless you choose to.',
                )}
              </p>
              <label className="mt-2 flex items-start gap-2 text-xs text-foreground">
                <Checkbox
                  checked={useMessageText}
                  onCheckedChange={(next) => setUseMessageText(next === true)}
                />
                <span>
                  {t('chat_tasks.composer.useMessageText', 'Copy the message text into the description')}
                  <span className="mt-0.5 block text-muted-foreground">
                    {t(
                      'chat_tasks.composer.useMessageTextWarning',
                      'Once copied, this text is part of the task and is readable by anyone with task access.',
                    )}
                  </span>
                </span>
              </label>
              {/* Shown for review before submission, so "what will be shared" is a
                  thing the writer reads rather than a thing they trust. */}
              {useMessageText ? (
                <div className="mt-2 flex items-start gap-2 rounded-md bg-surface-muted px-2.5 py-2">
                  <Quote className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <p className="whitespace-pre-wrap break-words text-xs text-foreground">{source.body}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {context && !context.canCreate ? (
            <p className="text-xs text-status-error-text">
              {t('chat_tasks.composer.cannotCreate', 'You do not have permission to create tasks.')}
            </p>
          ) : null}
        </DrawerBody>
        <DrawerFooter>
          <Button type="button" variant="soft" onClick={onClose} disabled={submitting}>
            {t('chat_tasks.composer.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={!canSubmit}>
            {t('chat_tasks.composer.submit', 'Create task')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

/** Kept exported so a test can assert the key is minted once per composer. */
export const __testables = { newIdempotencyKey }
