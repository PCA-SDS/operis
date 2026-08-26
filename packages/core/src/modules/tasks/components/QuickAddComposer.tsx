"use client"

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CornerDownRight, Plus } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverAnchor, PopoverContent } from '@open-mercato/ui/primitives/popover'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { menuRowVariants } from '@open-mercato/ui/primitives/menu'
import {
  QUICK_ADD_TEXT_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
  type QuickAddParseResultDto,
  type TaskPriority,
  type TaskRecurrenceDto,
} from '../data/types'
import { parseQuickAdd } from '../lib/quick-add/parser'
import { tasksApi } from './api'
import { Chip } from './badges'
import { RichTextEditor, type RichTextValue } from './RichText'
import { TaskLabelPicker, LABEL_PALETTE } from './TaskLabelPicker'
import { ProjectPicker, RecurrencePicker, TaskPriorityPicker, UserPicker } from './pickers'
import { DateInput, TimeInput, UserAvatar } from './ui-bits'
import { buildHighlightSegments } from './quickAddHighlight'
import { createdTaskDestination } from './createdTaskDestination'
import { browserTimeZone, describeRecurrence, formatTaskDate, localTodayIso, taskRef } from './format'
import { useInboxProject, useLabelMutations, useLabels, useProjects, useTaskMutations, useAssignableUsers } from './hooks'
import { useQuickAddWarning } from './quickAddWarnings'

/** Distinguishes "the user has not touched this control" from "the user set it
 *  to nothing" — the parser only fills in fields the user has left alone. */
const UNSET = Symbol('unset')

type Overrides = {
  projectId: string | typeof UNSET
  assigneeId: string | null | typeof UNSET
  labelIds: string[] | typeof UNSET
  dueDate: string | null | typeof UNSET
  dueTime: string | null | typeof UNSET
  recurrence: TaskRecurrenceDto | null | typeof UNSET
  priority: TaskPriority | typeof UNSET
}

const NO_OVERRIDES: Overrides = {
  projectId: UNSET,
  assigneeId: UNSET,
  labelIds: UNSET,
  dueDate: UNSET,
  dueTime: UNSET,
  recurrence: UNSET,
  priority: UNSET,
}

type Mention = {
  trigger: '@' | '+'
  query: string
  start: number
}

/** A mention is only live when its trigger starts a word — otherwise an email
 *  address in the title would open the assignee menu on every keystroke. */
function detectMention(value: string, caret: number): Mention | null {
  for (let index = caret - 1; index >= 0; index--) {
    const char = value[index]!
    if (char === '@' || char === '+') {
      if (index === 0 || /\s/.test(value[index - 1]!)) {
        return { trigger: char, query: value.slice(index + 1, caret), start: index }
      }
      return null
    }
    if (/\s/.test(char)) return null
  }
  return null
}

function tokenText(trigger: '@' | '+', name: string): string {
  return `${trigger}${/\s/.test(name) ? `"${name}"` : name}`
}

type MenuItem =
  | { kind: 'user'; id: string; name: string; email: string }
  | { kind: 'label'; id: string; name: string; color: string }
  | { kind: 'create'; name: string }

export type QuickAddParentTask = {
  id: string
  projectId: string
  projectKey: string
  number: number
}

/**
 * One-line task entry. Typing is parsed twice: locally on every keystroke so the
 * highlighting and the pickers react instantly, and once more on the server at
 * submit so the interpretation that gets stored is the authoritative one.
 *
 * Any picker the user touches wins over the parse for that field only — the
 * text keeps driving everything else.
 */
export function QuickAddComposer({
  autoFocus = true,
  floating = false,
  parentTask,
  onClose,
  onCreated,
}: {
  autoFocus?: boolean
  floating?: boolean
  parentTask?: QuickAddParentTask
  onClose?: () => void
  onCreated?: () => void
}) {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const renderWarning = useQuickAddWarning()

  const [text, setText] = React.useState('')
  const [description, setDescription] = React.useState<RichTextValue>({ html: '', text: '' })
  const [overrides, setOverrides] = React.useState<Overrides>(NO_OVERRIDES)
  const [submitting, setSubmitting] = React.useState(false)
  const [mention, setMention] = React.useState<Mention | null>(null)
  const [activeIndex, setActiveIndex] = React.useState(0)
  const [serverParse, setServerParse] = React.useState<QuickAddParseResultDto | null>(null)

  const inputRef = React.useRef<HTMLTextAreaElement | null>(null)
  const menuOpenRef = React.useRef(false)
  // The one Escape keypress the mention menu already consumed. `menuOpenRef` is
  // assigned during render, so whether it is still true when the window
  // listener runs depends on when React flushes the state change that closed
  // the menu — which differs between a discrete-event flush and a batched one.
  // Identifying the consumed event itself does not depend on that timing.
  const menuEscapeRef = React.useRef<KeyboardEvent | null>(null)

  const { inbox } = useInboxProject()
  const { projects } = useProjects({ archived: 'active', pageSize: 100, sort: 'name', order: 'asc' })
  const { users } = useAssignableUsers()
  const { labels } = useLabels()
  const { create: createLabel } = useLabelMutations()
  const { create } = useTaskMutations()

  // Local parse: instant, and the only thing the highlighting can trust while
  // the user is still typing.
  const localParsed = React.useMemo(() => {
    const line = text.trim()
    return line.length > 0 ? parseQuickAdd(line, localTodayIso()) : null
  }, [text])

  const segments = React.useMemo(
    () => (localParsed ? buildHighlightSegments(text, text.trim(), localParsed.recognizedTokens) : null),
    [text, localParsed],
  )

  // Server parse: resolves #project / @assignee / +label against real records.
  // Debounced, and its result is discarded the moment the text moves on.
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

  React.useLayoutEffect(() => {
    const element = inputRef.current
    if (!element) return
    element.style.height = '0px'
    element.style.height = `${element.scrollHeight}px`
  }, [text])

  React.useEffect(() => {
    if (!onClose) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Escape belongs to the mention menu first — closing the whole composer
      // because someone dismissed an autocomplete would lose their text.
      if (menuEscapeRef.current === event) {
        menuEscapeRef.current = null
        return
      }
      if (menuOpenRef.current) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const warnings = React.useMemo(() => {
    const local = localParsed?.warnings ?? []
    const server = parsed
      ? parsed.warnings.filter((warning) => !local.some((entry) => entry.code === warning.code))
      : []
    return [...local, ...server]
  }, [localParsed, parsed])

  const effectiveProjectId =
    overrides.projectId !== UNSET
      ? overrides.projectId
      : parsed?.project && !parsed.project.isInbox
        ? parsed.project.id
        : ''
  const effectiveAssigneeId =
    overrides.assigneeId !== UNSET ? overrides.assigneeId : (parsed?.assignee?.id ?? null)
  const effectiveLabelIds =
    overrides.labelIds !== UNSET ? overrides.labelIds : (parsed?.labels.map((label) => label.id) ?? [])
  const effectiveDueDate = overrides.dueDate !== UNSET ? overrides.dueDate : (localParsed?.dueDate ?? null)
  const effectiveDueTime = overrides.dueTime !== UNSET ? overrides.dueTime : (localParsed?.dueTime ?? null)
  const effectiveRecurrence =
    overrides.recurrence !== UNSET ? overrides.recurrence : (localParsed?.recurrence ?? null)
  const effectivePriority =
    overrides.priority !== UNSET ? overrides.priority : (localParsed?.priority ?? 'none')

  const menuItems: MenuItem[] = React.useMemo(() => {
    if (!mention) return []
    const needle = mention.query.replace(/^"/, '').toLowerCase()
    if (mention.trigger === '@') {
      return users
        .filter((user) => user.name.toLowerCase().includes(needle))
        .slice(0, 8)
        .map((user) => ({ kind: 'user' as const, id: user.id, name: user.name, email: user.email }))
    }
    const matched = labels
      .filter((label) => label.name.toLowerCase().includes(needle))
      .slice(0, 8)
      .map((label) => ({ kind: 'label' as const, id: label.id, name: label.name, color: label.color }))
    const trimmed = mention.query.replace(/^"|"$/g, '').trim()
    const exact = labels.some((label) => label.name.toLowerCase() === trimmed.toLowerCase())
    const items: MenuItem[] = [...matched]
    if (trimmed !== '' && !exact) items.push({ kind: 'create', name: trimmed })
    return items
  }, [mention, users, labels])

  const menuOpen = mention !== null && menuItems.length > 0
  menuOpenRef.current = menuOpen

  React.useEffect(() => {
    setActiveIndex(0)
  }, [mention?.trigger, mention?.query])

  const canSubmit = text.trim().length > 0 && !submitting

  const reset = () => {
    setText('')
    setDescription({ html: '', text: '' })
    setOverrides(NO_OVERRIDES)
    setMention(null)
    setServerParse(null)
    inputRef.current?.focus()
  }

  const syncMention = (value: string, caret: number | null) => {
    const next = caret === null ? null : detectMention(value, caret)
    setMention((previous) =>
      previous === next ||
      (previous !== null &&
        next !== null &&
        previous.trigger === next.trigger &&
        previous.query === next.query &&
        previous.start === next.start)
        ? previous
        : next,
    )
  }

  /** Replace the half-typed mention with its resolved token and record the
   *  choice as an override so a later re-parse cannot undo it. */
  const applyInsert = (insert: string, patch: (current: Overrides) => Overrides) => {
    if (!mention) return
    const caretEnd = mention.start + 1 + mention.query.length
    const before = text.slice(0, mention.start)
    const after = text.slice(caretEnd)
    const next = `${before}${insert} ${after}`
    setText(next)
    setOverrides(patch)
    setMention(null)
    const caret = before.length + insert.length + 1
    requestAnimationFrame(() => {
      const element = inputRef.current
      if (!element) return
      element.focus()
      element.setSelectionRange(caret, caret)
    })
  }

  const dedupe = (ids: string[]) => [...new Set(ids)]

  const selectMenuItem = (item: MenuItem) => {
    if (item.kind === 'user') {
      applyInsert(tokenText('@', item.name), (current) => ({ ...current, assigneeId: item.id }))
      return
    }
    if (item.kind === 'label') {
      const current = effectiveLabelIds
      applyInsert(tokenText('+', item.name), (previous) => ({
        ...previous,
        labelIds: dedupe([...current, item.id]),
      }))
      return
    }
    void createAndInsertLabel(item.name)
  }

  const createAndInsertLabel = async (name: string) => {
    try {
      const color = LABEL_PALETTE[labels.length % LABEL_PALETTE.length]
      const current = effectiveLabelIds
      const label = await createLabel.mutateAsync({ name, color })
      applyInsert(tokenText('+', label.name), (previous) => ({
        ...previous,
        labelIds: dedupe([...current, label.id]),
      }))
    } catch {
      flash(t('tasks.labels.createFailed', 'Could not create the label.'), 'error')
    }
  }

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((index) => (index + 1) % menuItems.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((index) => (index - 1 + menuItems.length) % menuItems.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        const item = menuItems[activeIndex]
        if (item) selectMenuItem(item)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        menuEscapeRef.current = event.nativeEvent
        setMention(null)
        return
      }
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      void submit()
    }
  }

  const submit = async () => {
    const line = text.trim()
    if (line.length === 0 || submitting) return
    setSubmitting(true)
    try {
      // Re-parse on the server at submit: the debounced preview may be a
      // keystroke behind, and only the server can resolve references.
      const final = await tasksApi.parseQuickAdd({ text: line, tz: browserTimeZone() })

      const projectId =
        parentTask?.projectId ||
        (overrides.projectId !== UNSET
          ? overrides.projectId
          : final.project && !final.project.isInbox
            ? final.project.id
            : '') ||
        inbox?.id
      if (!projectId) {
        flash(t('tasks.quickAdd.inboxNotReady', "The Inbox isn't ready yet — try again in a second."), 'error')
        return
      }

      const assigneeId =
        overrides.assigneeId !== UNSET ? overrides.assigneeId : (final.assignee?.id ?? null)
      const labelIds =
        overrides.labelIds !== UNSET ? overrides.labelIds : final.labels.map((label) => label.id)
      const dueDate = overrides.dueDate !== UNSET ? overrides.dueDate : final.dueDate
      const dueTime = overrides.dueTime !== UNSET ? overrides.dueTime : final.dueTime
      const recurrence = overrides.recurrence !== UNSET ? overrides.recurrence : final.recurrence
      const priority = overrides.priority !== UNSET ? overrides.priority : (final.priority ?? 'none')

      const task = await create.mutateAsync({
        projectId,
        body: {
          // Quick Add creates work that is meant to be started, so it lands in
          // `pending` rather than the backlog.
          title: (final.title.length > 0 ? final.title : line).slice(0, TASK_TITLE_MAX_LENGTH),
          description: description.html || null,
          descriptionPlaintext: description.text || null,
          status: 'pending',
          priority,
          parentTaskId: parentTask?.id ?? null,
          assigneeIds: assigneeId ? [assigneeId] : [],
          labelIds,
          dueDate,
          dueTime: dueDate ? dueTime : null,
          recurrence,
          tz: browserTimeZone(),
        },
      })

      flash(
        task.recurrence
          ? parentTask
            ? t('tasks.quickAdd.subtaskAddedRecurring', 'Subtask added — repeats {recurrence}.', {
                recurrence: describeRecurrence(t, task.recurrence).toLowerCase(),
              })
            : t('tasks.quickAdd.addedRecurring', 'Task added — repeats {recurrence}.', {
                recurrence: describeRecurrence(t, task.recurrence).toLowerCase(),
              })
          : parentTask
            ? t('tasks.quickAdd.subtaskAdded', 'Subtask added.')
            : t('tasks.quickAdd.added', 'Task added.'),
        'success',
      )

      reset()
      onCreated?.()
      if (!parentTask) {
        router.push(createdTaskDestination(pathname, searchParams.toString(), task))
      }
    } catch (error) {
      flash(
        error instanceof Error && error.message
          ? error.message
          : t('tasks.quickAdd.addFailed', 'Could not add the task.'),
        'error',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-xl',
        parentTask ? 'bg-surface-muted' : floating ? 'bg-surface shadow-xl' : 'bg-modal-muted shadow-sm',
      )}
    >
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pt-3">
        {/* The menu is portalled rather than absolutely positioned: this column
            scrolls, and an in-flow menu would be cropped at its edge. */}
        <Popover open={menuOpen} onOpenChange={(next) => (next ? undefined : setMention(null))}>
          <PopoverAnchor asChild>
            <div className="relative -mx-1">
              {/* An overlay tints the spans the parser claimed while the real
                  textarea sits on top with transparent text, so the caret, IME
                  and selection all stay native. */}
              {segments && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-1 py-1 text-lg font-bold text-foreground"
                >
                  {segments.map((segment, index) =>
                    segment.token ? (
                      <span
                        key={index}
                        className="-ml-1 -mr-0.5 rounded-md bg-primary-soft py-0.5 pl-1 pr-0.5 text-primary"
                      >
                        {segment.text}
                      </span>
                    ) : (
                      <span key={index}>{segment.text}</span>
                    ),
                  )}
                </div>
              )}

              <textarea
                ref={inputRef}
                rows={1}
                maxLength={QUICK_ADD_TEXT_MAX_LENGTH}
                value={text}
                onChange={(event) => {
                  // Newlines would break the one-line contract and the overlay's
                  // offset maths along with it.
                  const value = event.target.value.replace(/\n+/g, ' ')
                  setText(value)
                  setOverrides(NO_OVERRIDES)
                  syncMention(value, event.target.selectionStart)
                }}
                onKeyUp={(event) => syncMention(event.currentTarget.value, event.currentTarget.selectionStart)}
                onClick={(event) => syncMention(event.currentTarget.value, event.currentTarget.selectionStart)}
                onKeyDown={onInputKeyDown}
                autoFocus={autoFocus}
                placeholder={
                  parentTask
                    ? t('tasks.quickAdd.subtaskPlaceholder', 'Subtask name')
                    : t('tasks.quickAdd.placeholder', '"Plan lunch with @team by tomorrow 3pm +design"')
                }
                aria-label={
                  parentTask
                    ? t('tasks.quickAdd.subtaskNameLabel', 'Subtask name')
                    : t('tasks.quickAdd.taskNameLabel', 'Task name')
                }
                className={cn(
                  'relative min-h-16 w-full resize-none overflow-hidden whitespace-pre-wrap break-words border-0 bg-transparent px-1 py-1 text-lg font-semibold caret-foreground placeholder:text-muted-foreground focus:outline-none',
                  segments ? 'text-transparent' : 'text-foreground',
                )}
              />
            </div>
          </PopoverAnchor>

          <PopoverContent
            role="listbox"
            aria-label={t('tasks.quickAdd.suggestions', 'Mention suggestions')}
            align="start"
            className="max-h-64 w-[var(--radix-popover-trigger-width)] overflow-y-auto bg-surface p-2 text-foreground"
            // The caret has to stay in the textarea — it is what drives the menu.
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            // Clicking back into the textarea is not a dismissal; its own handler
            // re-reads the caret and decides whether the mention is still live.
            onPointerDownOutside={(event) => {
              if (inputRef.current?.contains(event.target as Node)) event.preventDefault()
            }}
          >
            {menuItems.map((item, index) => (
              <button
                key={item.kind === 'create' ? '__create' : item.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectMenuItem(item)}
                role="option"
                aria-selected={index === activeIndex}
                className={cn(
                  menuRowVariants({ active: index === activeIndex }),
                  'font-medium',
                )}
              >
                {item.kind === 'user' && (
                  <>
                    <UserAvatar name={item.name} size="xs" />
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{item.email}</span>
                  </>
                )}
                {item.kind === 'label' && (
                  <>
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  </>
                )}
                {item.kind === 'create' && (
                  <>
                    <Plus className="size-4 text-primary" aria-hidden="true" />
                    <span className="truncate text-primary">
                      {t('tasks.quickAdd.createLabel', 'Create “{name}”', { name: item.name })}
                    </span>
                  </>
                )}
              </button>
            ))}
          </PopoverContent>
        </Popover>

        <div className="-mx-3 border-t border-border px-3 pt-3">
          <div className="-mx-1 px-1 text-sm">
            <RichTextEditor
              variant="minimal"
              minRows={3}
              value={description.html}
              onChange={setDescription}
              placeholder={t('tasks.quickAdd.descriptionPlaceholder', 'Description')}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="min-w-34">
            <DateInput
              value={effectiveDueDate ?? ''}
              onChange={(value) => setOverrides((current) => ({ ...current, dueDate: value || null }))}
              ariaLabel={t('tasks.quickAdd.dueDateLabel', 'Due date')}
              placeholder={t('tasks.quickAdd.datePlaceholder', 'Date')}
              variant="compact"
            />
          </div>
          <div className="min-w-26">
            <TimeInput
              value={effectiveDueTime ?? ''}
              onChange={(value) => setOverrides((current) => ({ ...current, dueTime: value || null }))}
              disabled={!effectiveDueDate}
              ariaLabel={t('tasks.quickAdd.dueTimeLabel', 'Due time')}
              placeholder={t('tasks.quickAdd.timePlaceholder', 'Time')}
              variant="compact"
            />
          </div>
          <div className="min-w-38">
            <RecurrencePicker
              value={effectiveRecurrence}
              onChange={(value) => setOverrides((current) => ({ ...current, recurrence: value }))}
            />
          </div>
          <div className="min-w-34">
            <TaskPriorityPicker
              value={effectivePriority}
              onChange={(value) => setOverrides((current) => ({ ...current, priority: value }))}
            />
          </div>
          <div className="min-w-42">
            <UserPicker
              value={effectiveAssigneeId}
              onChange={(value) => setOverrides((current) => ({ ...current, assigneeId: value }))}
              users={users}
            />
          </div>
          <TaskLabelPicker
            value={effectiveLabelIds}
            onChange={(value) => setOverrides((current) => ({ ...current, labelIds: value }))}
          />
        </div>

        {warnings.length > 0 && text.trim().length > 0 && (
          <ul className="space-y-0.5 text-xs text-status-error-text" role="status">
            {warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`}>{renderWarning(warning)}</li>
            ))}
          </ul>
        )}

        {effectiveDueDate && (
          <p className="text-xs text-muted-foreground">
            {t('tasks.quickAdd.due', 'Due {date}', { date: formatTaskDate(effectiveDueDate) })}
            {effectiveRecurrence ? ` · ${describeRecurrence(t, effectiveRecurrence)}` : ''}
          </p>
        )}
      </div>

      <div className="mt-2 flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-2">
        <div className="min-w-0">
          {parentTask ? (
            <Chip
              size="md"
              title={t('tasks.common.subtaskOf', 'Subtask of {ref} {title}', {
                ref: taskRef(parentTask.projectKey, parentTask.number),
                title: '',
              })}
            >
              <CornerDownRight className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate font-mono">
                {taskRef(parentTask.projectKey, parentTask.number)}
              </span>
            </Chip>
          ) : (
            <ProjectPicker
              value={effectiveProjectId}
              onChange={(value) => setOverrides((current) => ({ ...current, projectId: value }))}
              projects={projects}
              inboxLabel={t('tasks.quickAdd.inbox', '📥 Inbox')}
            />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onClose && (
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              {t('tasks.common.cancel', 'Cancel')}
            </Button>
          )}
          <Button type="button" size="sm" onClick={() => void submit()} disabled={!canSubmit}>
            {parentTask
              ? t('tasks.quickAdd.submitSubtask', 'Add subtask')
              : t('tasks.quickAdd.submit', 'Add task')}
          </Button>
        </div>
      </div>
    </div>
  )
}
