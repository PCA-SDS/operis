"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { useMyTasks } from '@open-mercato/core/modules/tasks/components/hooks'
import { taskRef } from '@open-mercato/core/modules/tasks/components/format'
import { useChatTaskMutations } from './hooks'

/**
 * Link a task that already exists.
 *
 * The candidate list is the tasks module's own `all` view, searched with its own
 * search parameter — so the only tasks offered are ones the caller may already read,
 * decided by the module that owns that question. This dialog never queries tasks
 * directly and has no list of its own to keep in step.
 */
export function LinkExistingTaskDialog({
  conversationId,
  onClose,
  onLinked,
}: {
  conversationId: string
  onClose: () => void
  onLinked: () => void
}) {
  const t = useT()
  const [search, setSearch] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  const { link } = useChatTaskMutations()

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  const { data, isLoading } = useMyTasks('all', { page: 1, search: debounced })
  const tasks = data?.items ?? []

  const onPick = (taskId: string) => {
    link.mutate(
      { conversationId, body: { taskId, publishCard: true } },
      {
        onSuccess: (result) => {
          flash(
            result.cardPublished
              ? t('chat_tasks.link.linked', 'Task linked.')
              : t(
                  'chat_tasks.link.linkedWithoutCard',
                  'Task linked. The card could not be posted here — try again from the Tasks panel.',
                ),
            result.cardPublished ? 'success' : 'warning',
          )
          onLinked()
          onClose()
        },
        onError: (error) =>
          flash(
            error instanceof Error && error.message
              ? error.message
              : t('chat_tasks.link.failed', 'Could not link the task.'),
            'error',
          ),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('chat_tasks.link.title', 'Link an existing task')}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('chat_tasks.link.searchPlaceholder', 'Search tasks…')}
            aria-label={t('chat_tasks.link.searchLabel', 'Search tasks')}
            autoFocus
          />
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : tasks.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {debounced
                ? t('chat_tasks.link.noMatch', 'No tasks match “{query}”.', { query: debounced })
                : t('chat_tasks.link.empty', 'There are no open tasks to link yet.')}
            </p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {tasks.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    disabled={link.isPending}
                    onClick={() => onPick(task.id)}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                      'hover:bg-surface-muted disabled:opacity-60',
                    )}
                  >
                    <span className="mt-0.5 shrink-0 font-mono text-xs text-muted-foreground">
                      {taskRef(task.projectKey, task.number)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{task.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="soft" onClick={onClose} disabled={link.isPending}>
            {t('chat_tasks.link.cancel', 'Cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
