"use client"

import * as React from 'react'
import Link from 'next/link'
import { Info, Plus } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { taskRef } from '@open-mercato/core/modules/tasks/components/format'
import { TASK_TITLE_MAX_LENGTH } from '@open-mercato/core/modules/tasks/data/types'
import { tasksApi } from '@open-mercato/core/modules/tasks/components/api'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useChatTaskLiveRefresh, useChatTaskMutations, useWorkspaceTasks } from './hooks'
import { browserTimeZone } from './format'
import { CHAT_TASKS_ASSIGNED_HREF } from '../lib/routes'
import { taskHref } from '../lib/routes'

/**
 * My workspace — a place in chat for your own work, and not a conversation.
 *
 * There is no `chat_conversations` row behind this, no participant list and no
 * `direct_key`. That is the whole design: "one workspace per person per tenant and
 * organization" is true because the workspace IS that triple, so there is nothing to
 * create, nothing for two simultaneous visits to race over, no row another employee
 * or administrator could read, no unread state to manufacture and nothing for the
 * Matrix transport to provision or publish. Faking a direct conversation with
 * yourself would have meant a second participant row and a weakened
 * exactly-two-people constraint — a real hole in chat's access model for a cosmetic
 * gain.
 *
 * It is also not an assistant, and it is not a private task list. A task made here
 * is an ordinary task, and the notice below says so where somebody is about to type.
 */
export function WorkspaceView() {
  const t = useT()
  const [search, setSearch] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  const [text, setText] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const idempotencyKey = React.useRef(newKey())
  const { data, isLoading, error, retry } = useWorkspaceTasks({
    search: debounced || undefined,
    tz: browserTimeZone(),
  })
  const { createWorkspaceTask } = useChatTaskMutations()
  useChatTaskLiveRefresh()

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  const submit = async () => {
    const line = text.trim()
    if (line.length === 0 || submitting) return
    setSubmitting(true)
    try {
      // The tasks module's own parser, server-side, for the same reason the
      // conversation composer uses it: the interpretation that gets stored has to be
      // the authoritative one.
      const final = await tasksApi.parseQuickAdd({ text: line, tz: browserTimeZone() })
      await createWorkspaceTask.mutateAsync({
        idempotencyKey: idempotencyKey.current,
        title: (final.title.length > 0 ? final.title : line).slice(0, TASK_TITLE_MAX_LENGTH),
        priority: final.priority ?? 'none',
        // Omitted rather than sent as the caller's id: the server defaults a
        // workspace task to its creator, so `tasks.assign` is not required to make
        // one for yourself.
        assigneeIds: [],
        projectId: final.project && !final.project.isInbox ? final.project.id : null,
        dueDate: final.dueDate,
        dueTime: final.dueDate ? final.dueTime : null,
        recurrence: final.recurrence,
        labelIds: final.labels.map((label) => label.id),
        tz: browserTimeZone(),
      })
      flash(t('chat_tasks.workspace.created', 'Task added.'), 'success')
      setText('')
      // A new key for the next task: the old one is spent, and reusing it would make
      // the second task look like a retry of the first.
      idempotencyKey.current = newKey()
    } catch (submitError) {
      flash(
        submitError instanceof Error && submitError.message
          ? submitError.message
          : t('chat_tasks.workspace.createFailed', 'Could not add the task.'),
        'error',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const tasks = data?.items ?? []

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-col gap-4 p-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">
          {t('chat_tasks.workspace.title', 'My workspace')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            'chat_tasks.workspace.subtitle',
            'A place to note your own work without starting a conversation.',
          )}
        </p>
      </div>

      {/* Stated where the typing happens, not buried in a help page. Somebody who
          believed this was private would be putting confidential detail into an
          ordinary task record. */}
      <p className="flex items-start gap-2 rounded-lg bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {t(
          'chat_tasks.workspace.sharedNotice',
          'Tasks you add here are normal tasks. Anyone with task access in your organization can read them — this workspace is private, the tasks are not.',
        )}
      </p>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-foreground" htmlFor="workspace-quick-add">
          {t('chat_tasks.workspace.addLabel', 'Add a task for yourself')}
        </label>
        <Textarea
          id="workspace-quick-add"
          rows={2}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            // An IME confirms its candidate with Enter, so while one is composing this
            // key is not a submit.
            if (event.nativeEvent.isComposing) return
            event.preventDefault()
            void submit()
          }}
          placeholder={t(
            'chat_tasks.workspace.addPlaceholder',
            'Draft the summary tomorrow 9am +writing p2',
          )}
          className="resize-none text-sm"
        />
        <Button type="button" onClick={() => void submit()} disabled={submitting || text.trim().length === 0}>
          <Plus className="size-4" aria-hidden="true" />
          {t('chat_tasks.workspace.add', 'Add task')}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">
          {t('chat_tasks.workspace.assignedTitle', 'Assigned to me')}
        </h2>
        {/* The tasks module's own view, linked rather than reproduced. */}
        <Button asChild type="button" variant="ghost" size="sm">
          <Link href={CHAT_TASKS_ASSIGNED_HREF}>
            {t('chat_tasks.workspace.openInTasks', 'Open in Tasks')}
          </Link>
        </Button>
      </div>

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder={t('chat_tasks.workspace.searchPlaceholder', 'Search my tasks…')}
        aria-label={t('chat_tasks.workspace.searchLabel', 'Search my tasks')}
      />

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error ? (
        <div className="space-y-2">
          <ErrorMessage label={t('chat_tasks.workspace.loadFailed', "Your tasks didn't load")} />
          <Button type="button" variant="outline" size="sm" onClick={() => void retry()}>
            {t('chat_tasks.workspace.retry', 'Try again')}
          </Button>
        </div>
      ) : tasks.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {debounced
            ? t('chat_tasks.workspace.noMatch', 'Nothing matches “{query}”.', { query: debounced })
            : t('chat_tasks.workspace.empty', 'Nothing is assigned to you right now.')}
        </p>
      ) : (
        <ul className="space-y-1">
          {tasks.map((task) => (
            <li key={task.id}>
              <Link
                href={taskHref(task.projectId, task.id)}
                className="flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-muted"
              >
                <span className="mt-0.5 shrink-0 font-mono text-xs text-muted-foreground">
                  {taskRef(task.projectKey, task.number)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{task.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function newKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}
