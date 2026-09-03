"use client"

import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { NotificationCountBadge } from '@open-mercato/ui/backend/notifications'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { useChatLiveRefresh, useChatUnreadCount } from './hooks'

export type ChatUnreadIconProps = {
  className?: string
}

/**
 * The topbar entry to chat, with the unread count.
 *
 * It lives in the topbar rather than on the sidebar row because sidebar rows
 * cannot carry a badge without changing `AppShell` — and the topbar is already
 * where Operis puts unread counts (messages, notifications), so this reads as
 * the same affordance rather than a new one.
 *
 * `NotificationCountBadge` is the shared primitive, so the count looks and
 * truncates identically to every other badge in the shell.
 */
export function ChatUnreadIcon({ className }: ChatUnreadIconProps) {
  const t = useT()
  // Live, not polled: the same SSE events that update an open conversation move
  // this badge, so an idle tab does not send a request every few seconds.
  useChatLiveRefresh()
  const { unreadCount } = useChatUnreadCount(true)

  const label =
    unreadCount > 0
      ? t(
          // The `_plural` suffix convention the tasks module uses; without it
          // the badge announced "1 unread chat messages".
          `chat.badge.unread${unreadCount === 1 ? '' : '_plural'}`,
          '{count} unread chat messages',
          { count: unreadCount },
        )
      : t('chat.nav.title', 'Chat')

  return (
    <IconButton variant="ghost" size="lg" asChild className={cn('relative', className)}>
      <Link href="/backend/chat" aria-label={label}>
        <MessageSquare className="size-5" aria-hidden="true" />
        <NotificationCountBadge count={unreadCount} />
      </Link>
    </IconButton>
  )
}
