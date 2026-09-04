"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MessageSquare } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { NotificationCountBadge } from '@open-mercato/ui/backend/notifications'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { formatListTimestamp } from './format'
import { useChatLiveRefresh, useChatUnreadCount, useConversations, useMarkAllRead } from './hooks'

export type ChatUnreadIconProps = {
  className?: string
}

/**
 * The topbar entry to chat: the unread count, and the conversations behind it.
 *
 * It lives in the topbar rather than on the sidebar row because sidebar rows
 * cannot carry a badge without changing `AppShell` — and the topbar is already
 * where Operis puts unread counts (messages, notifications), so this reads as
 * the same affordance rather than a new one.
 *
 * A popover rather than the `Sheet` the notification bell uses: this is a short
 * list of people with one action each, not a triaging surface with tabs and
 * undo. `NotificationCountBadge` is still the shared primitive, so the count
 * looks and truncates identically to every other badge in the shell.
 */
export function ChatUnreadIcon({ className }: ChatUnreadIconProps) {
  const t = useT()
  const locale = useLocale()
  const pathname = usePathname()
  const [open, setOpen] = React.useState(false)

  // Live, not polled: the same SSE events that update an open conversation move
  // this badge, so an idle tab does not send a request every few seconds.
  useChatLiveRefresh()
  const { unreadCount } = useChatUnreadCount(true)
  // Only fetched while the panel is open — the badge alone needs the count, not
  // the list behind it.
  const { conversations } = useConversations(open)
  const markAllRead = useMarkAllRead()

  // Navigating away is the end of this panel's job. Without it the popover
  // survived the route change and hung over the conversation it just opened.
  React.useEffect(() => {
    setOpen(false)
  }, [pathname])

  const unread = React.useMemo(
    () => conversations.filter((conversation) => conversation.unreadCount > 0),
    [conversations],
  )

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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          type="button"
          variant="ghost"
          size="lg"
          aria-label={label}
          className={cn('relative', className)}
        >
          <MessageSquare className="size-5" aria-hidden="true" />
          <NotificationCountBadge count={unreadCount} />
        </IconButton>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <p className="text-sm font-semibold text-foreground">
            {t('chat.nav.title', 'Chat')}
          </p>
          {/* "Clear" for a chat notification is catching up, not deleting: the
              messages stay, the badge goes. One request moves every cursor, and
              it is hidden entirely when there is nothing to clear rather than
              offered as a control that would do nothing. */}
          {unread.length > 0 ? (
            <Button
              type="button"
              variant="link"
              size="2xs"
              disabled={markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            >
              {markAllRead.isPending
                ? t('chat.notifications.clearing', 'Clearing…')
                : t('chat.notifications.clearAll', 'Mark all read')}
            </Button>
          ) : null}
        </div>

        <div className="max-h-80 overflow-y-auto p-1">
          {unread.length === 0 ? (
            <EmptyState
              variant="subtle"
              size="sm"
              title={t('chat.notifications.emptyTitle', "You're all caught up")}
              description={t(
                'chat.notifications.emptyDescription',
                'New messages will show up here.',
              )}
            />
          ) : (
            <ul className="flex flex-col gap-0.5">
              {unread.map((conversation) => {
                const name =
                  conversation.counterpart?.name ??
                  t('chat.list.unknownPerson', 'Former colleague')
                return (
                  <li key={conversation.id}>
                    {/* Opening the conversation is what clears it, exactly as it
                        would if the user reached it from the rail — there is no
                        separate "dismiss" that would leave the message unread
                        but the badge gone. */}
                    <Link
                      href={`/backend/chat/${conversation.id}`}
                      className="flex items-start gap-2 rounded-md px-2 py-2 outline-none transition-colors hover:bg-surface-muted focus-visible:shadow-focus"
                    >
                      <Avatar label={name} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                            {name}
                          </span>
                          {conversation.lastMessageAt ? (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {formatListTimestamp(locale, new Date(conversation.lastMessageAt))}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {conversation.lastMessagePreview ??
                            t('chat.list.noMessages', 'No messages yet')}
                        </span>
                      </span>
                      <span className="sr-only">
                        {t(
                          `chat.list.unreadLabel${conversation.unreadCount === 1 ? '' : '_plural'}`,
                          '{count} unread messages',
                          { count: conversation.unreadCount },
                        )}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border p-1">
          <Button type="button" variant="ghost" size="sm" className="w-full" asChild>
            <Link href="/backend/chat">{t('chat.notifications.openAll', 'Open chat')}</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
