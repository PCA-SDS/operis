"use client"

import * as React from 'react'
import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useTaskSources } from '../../../components/hooks'

type SidebarContext = {
  entityId: string
  recordId: string
}

function isSidebarContext(context: unknown): context is SidebarContext {
  if (!context || typeof context !== 'object') return false
  const candidate = context as Partial<SidebarContext>
  return candidate.entityId === 'tasks:tasks_task' && typeof candidate.recordId === 'string'
}

/**
 * "Raised from" in the task panel's properties rail.
 *
 * Fills the tasks module's existing `tasks:task-panel:sidebar` spot — the tasks module
 * imports nothing from here and renders nothing when this is absent.
 *
 * The list is empty for anyone who is not currently a member of the conversation, and
 * it renders **nothing at all** in that case — no heading, no "1 hidden source". A
 * count would tell somebody with full task access that a private conversation about
 * this task exists, which is the relationship this is protecting.
 */
export default function ChatTaskSourcesWidget({ context }: InjectionWidgetComponentProps<unknown, unknown>) {
  const t = useT()
  const valid = isSidebarContext(context) ? context : null
  const { sources, isLoading } = useTaskSources(valid?.recordId)

  if (!valid) return null
  if (isLoading) return <Skeleton className="h-8 w-full" />
  if (sources.length === 0) return null

  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">
        {t('chat_tasks.sources.title', 'Raised from')}
      </p>
      <ul className="space-y-1">
        {sources.map((source) => (
          <li key={source.linkId}>
            <Link
              href={
                // The message anchor only when the message is still there. The tasks
                // panel is a different surface from the transcript, so a link that
                // scrolled nowhere would be worse than a link to the conversation.
                source.messageId ? `${source.href}?message=${source.messageId}` : source.href
              }
              className="flex items-center gap-1.5 text-xs text-foreground underline-offset-2 hover:underline"
            >
              <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 truncate">{source.conversationTitle}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
