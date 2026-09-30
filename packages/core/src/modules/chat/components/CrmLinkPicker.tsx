'use client'

import * as React from 'react'
import { Building2, Search, User } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Input } from '@open-mercato/ui/primitives/input'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ChatCrmSearchResultDto } from '../data/types'
import { useCrmSearch } from './hooks'

const SEARCH_DEBOUNCE_MS = 250

export type CrmRecord = ChatCrmSearchResultDto['items'][number]

/**
 * Find the CRM person or company an outsider is, and pick it.
 *
 * Searches names and phone numbers among the records the colleague may open in
 * the CRM; the server decides which those are. Picking is the whole action —
 * the dialog around it links at once.
 */
export function CrmLinkPicker({
  conversationId,
  contactName,
  disabled,
  onPick,
}: {
  conversationId: string
  contactName: string
  disabled?: boolean
  onPick: (record: CrmRecord) => void
}) {
  const t = useT()
  const [term, setTerm] = React.useState('')
  const [debounced, setDebounced] = React.useState('')

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [term])

  const { records, isLoading, error, retry } = useCrmSearch(conversationId, debounced, true)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="chat-crm-picker">
      <p className="text-sm text-muted-foreground">
        {t(
          'chat.crm.pickHint',
          'Link {name} to their person or company in the CRM. Everyone in chats with them sees it.',
          { name: contactName },
        )}
      </p>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={term}
          disabled={disabled}
          autoFocus
          onChange={(event) => setTerm(event.target.value)}
          aria-label={t('chat.crm.searchLabel', 'Search the CRM')}
          placeholder={t('chat.crm.searchPlaceholder', 'Name or phone number…')}
          className="pl-9"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!debounced ? null : isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : error ? (
          <ErrorMessage
            label={t('chat.crm.searchFailed', "Couldn't search the CRM.")}
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => retry()}>
                {t('chat.actions.retry', 'Try again')}
              </Button>
            }
          />
        ) : records.length === 0 ? (
          <EmptyState
            variant="subtle"
            size="sm"
            icon={<Search className="size-5" aria-hidden="true" />}
            title={t('chat.crm.noMatchTitle', 'Nothing in the CRM matches')}
            description={t('chat.crm.noMatchDescription', 'No person or company you can open matches “{query}”.', {
              query: debounced,
            })}
          />
        ) : (
          <ul className="flex flex-col gap-1">
            {records.map((record) => (
              <li key={record.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(record)}
                  className="flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left outline-none transition-colors hover:bg-surface-muted focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="chat-crm-result"
                >
                  <Avatar
                    label={record.name}
                    size="md"
                    icon={
                      record.kind === 'person' ? (
                        <User className="size-4" aria-hidden="true" />
                      ) : (
                        <Building2 className="size-4" aria-hidden="true" />
                      )
                    }
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{record.name}</span>
                  <Tag>
                    {record.kind === 'person'
                      ? t('chat.crm.person', 'Person')
                      : t('chat.crm.company', 'Company')}
                  </Tag>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
