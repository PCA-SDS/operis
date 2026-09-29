'use client'

import * as React from 'react'
import { Globe } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ChatConversationDto } from '../data/types'
import { networkLabel } from './externalNetwork'
import { useSpaceMembers } from './hooks'

/**
 * Who is in an external conversation — read-only.
 *
 * Colleagues first, then the people outside, each named with the network they
 * are on. Nothing here changes membership: an external conversation's people
 * come from the room it is linked to, not from a picker, so there is no add,
 * remove or promote to offer. Escape closes it; there is nothing to submit.
 */
export function ExternalMembersDialog({
  open,
  onClose,
  conversation,
}: {
  open: boolean
  onClose: () => void
  conversation: ChatConversationDto
}) {
  const t = useT()
  const { members, externalMembers, isLoading, error } = useSpaceMembers(conversation.id, '', open)

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="default" className="flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{conversation.title}</DialogTitle>
          <DialogDescription>
            {t(
              'chat.external.membersDescription',
              'Messages here go to the people under External, outside your organization.',
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {error ? <ErrorMessage label={t('chat.space.membersError', "Couldn't load the members")} /> : null}
          {isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <>
              <section aria-labelledby="chat-external-members-colleagues" className="flex flex-col gap-1">
                <h3 id="chat-external-members-colleagues" className="text-overline text-muted-foreground">
                  {t('chat.space.membersLabel', 'People')}
                </h3>
                <ul className="flex flex-col gap-1">
                  {members.map((member) => (
                    <li key={member.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
                      <Avatar label={member.name} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-foreground">{member.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{member.email}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <section
                aria-labelledby="chat-external-members-outsiders"
                className="flex flex-col gap-1"
                data-testid="chat-external-members"
              >
                <h3 id="chat-external-members-outsiders" className="text-overline text-muted-foreground">
                  {t('chat.external.membersSection', 'External')}
                </h3>
                <ul className="flex flex-col gap-1">
                  {externalMembers.map((member) => (
                    <li key={member.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
                      <Avatar label={member.name} size="md" icon={<Globe className="size-4" aria-hidden="true" />} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-foreground">{member.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {networkLabel(t, member.network)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </DialogBody>

        <DialogFooter bordered>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('chat.actions.close', 'Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
