"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Users } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useDirectorySearch, useOpenConversation } from './hooks'

/** Long enough that a typist does not fire a request per keystroke, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 250

export type StartConversationDialogProps = {
  onClose: () => void
}

function DirectorySkeleton() {
  return (
    <div className="space-y-1" aria-busy="true">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-3 px-2 py-2">
          <Skeleton shape="circle" className="size-9" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * "Start a chat": find a colleague, open the conversation with them.
 *
 * The search is debounced so a typist fires one request rather than one per
 * keystroke, and the results come from an endpoint that only ever sees the
 * caller's own organization — the scoping is not a filter applied here.
 *
 * Picking someone routes to the conversation rather than opening it inline, so
 * the result is a real URL the user can come back to.
 */
export function StartConversationDialog({ onClose }: StartConversationDialogProps) {
  const t = useT()
  const router = useRouter()
  const [term, setTerm] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  const [openError, setOpenError] = React.useState<string | null>(null)
  const openConversation = useOpenConversation()

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [term])

  const { people, truncated, isLoading, error, retry } = useDirectorySearch(debounced, true)

  const handlePick = React.useCallback(
    async (userId: string) => {
      setOpenError(null)
      try {
        const conversation = await openConversation.mutateAsync(userId)
        onClose()
        router.push(`/backend/chat/${conversation.id}`)
      } catch (err) {
        setOpenError(
          err instanceof Error && err.message
            ? err.message
            : t('chat.start.failed', "Couldn't open that conversation."),
        )
      }
    },
    [onClose, openConversation, router, t],
  )

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[calc(100dvh-6rem)] max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t('chat.start.title', 'Start a chat')}</DialogTitle>
          <DialogDescription>
            {t('chat.start.description', 'Search for someone in your organization.')}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <SearchInput
            value={term}
            onChange={setTerm}
            loading={isLoading}
            autoFocus
            aria-label={t('chat.start.searchLabel', 'Search colleagues')}
            placeholder={t('chat.start.searchPlaceholder', 'Name, email or role…')}
          />

          {openError ? <ErrorMessage label={openError} /> : null}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <DirectorySkeleton />
            ) : error ? (
              <ErrorMessage
                label={t('chat.start.searchError', "Couldn't search your organization")}
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => retry()}>
                    {t('chat.actions.retry', 'Try again')}
                  </Button>
                }
              />
            ) : people.length === 0 ? (
              <EmptyState
                variant="subtle"
                size="sm"
                icon={<Users className="size-5" aria-hidden="true" />}
                title={
                  debounced
                    ? t('chat.start.noMatchTitle', 'Nobody matches that')
                    : t('chat.start.noColleaguesTitle', 'No colleagues to chat with yet')
                }
                description={
                  debounced
                    ? t('chat.start.noMatchDescription', 'No active member of your organization matches “{query}”.', {
                        query: debounced,
                      })
                    : t(
                        'chat.start.noColleaguesDescription',
                        'Once other people join your organization they will show up here.',
                      )
                }
              />
            ) : (
              <ul className="flex flex-col gap-0.5">
                {people.map((person) => (
                  <li key={person.id}>
                    <button
                      type="button"
                      disabled={openConversation.isPending}
                      onClick={() => void handlePick(person.id)}
                      className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-muted disabled:opacity-50 outline-none focus-visible:shadow-focus"
                    >
                      <Avatar label={person.name} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {person.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {person.roleNames.length > 0
                            ? `${person.email} — ${person.roleNames.join(', ')}`
                            : person.email}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {truncated ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">
                {t('chat.start.truncated', 'Showing the closest matches. Keep typing to narrow them down.')}
              </p>
            ) : null}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
