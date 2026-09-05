"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, LogOut, Pencil, UserPlus, Users, X } from 'lucide-react'
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
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { tCount } from './plurals'
import type { ChatConversationDto, ChatDirectoryEntryDto } from '../data/types'
import { MAX_SPACE_MEMBERS_PER_REQUEST, MAX_SPACE_TITLE_LENGTH } from '../data/validators'
import { MemberPicker } from './MemberPicker'
import { useSpaceMembers, useSpaceMutations } from './hooks'

export type SpaceDetailsDialogProps = {
  open: boolean
  onClose: () => void
  conversation: ChatConversationDto
  currentUserId: string
}

/** Enough members that finding one is worth a search box. */
const MEMBER_SEARCH_THRESHOLD = 8

function MemberSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <Skeleton shape="circle" className="size-9" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  )
}

/**
 * Everything about a space in one place: its name, who is in it, and the actions
 * the viewer is actually allowed to take.
 *
 * Two modes rather than two dialogs — the member list, and the picker for adding
 * to it. Adding is a mode of this panel because it needs the current membership
 * to exclude, and a second dialog stacked on this one would put two focus traps
 * on screen at once.
 *
 * Every management control is hidden, not disabled, for a plain member: a
 * greyed-out "Remove" on every row is a column of dead controls that answers a
 * question nobody asked. What a member sees is the roster.
 */
export function SpaceDetailsDialog({
  open,
  onClose,
  conversation,
  currentUserId,
}: SpaceDetailsDialogProps) {
  const t = useT()
  const router = useRouter()
  const isOwner = conversation.viewerRole === 'owner'

  const [mode, setMode] = React.useState<'members' | 'add'>('members')
  const [search, setSearch] = React.useState('')
  const [renaming, setRenaming] = React.useState(false)
  const [title, setTitle] = React.useState(conversation.title)
  const [additions, setAdditions] = React.useState<ChatDirectoryEntryDto[]>([])
  const [error, setError] = React.useState<string | null>(null)

  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { members, total, isLoading, error: loadError, retry } = useSpaceMembers(
    conversation.id,
    search,
    open,
  )
  const { rename, addMembers, removeMember, setMemberRole } = useSpaceMutations(conversation.id)

  // Reset to the roster whenever the panel is put away, so reopening it never
  // resumes a half-finished add or a half-typed rename.
  React.useEffect(() => {
    if (open) return
    setMode('members')
    setSearch('')
    setRenaming(false)
    setAdditions([])
    setError(null)
  }, [open])

  // The name can change under this panel — someone else renames the space while
  // it is open — so the field follows the server value until the viewer starts
  // editing it.
  React.useEffect(() => {
    if (renaming) return
    setTitle(conversation.title)
  }, [conversation.title, renaming])

  const run = React.useCallback(
    async (work: () => Promise<unknown>, fallback: string) => {
      setError(null)
      try {
        await work()
        return true
      } catch (err) {
        setError(err instanceof Error && err.message ? err.message : fallback)
        return false
      }
    },
    [],
  )

  const submitRename = React.useCallback(async () => {
    const next = title.trim()
    if (next.length === 0) return
    if (next === conversation.title) {
      setRenaming(false)
      return
    }
    const ok = await run(
      () => rename.mutateAsync(next),
      t('chat.space.renameFailed', "Couldn't rename this space."),
    )
    if (ok) setRenaming(false)
  }, [conversation.title, rename, run, t, title])

  const submitAdditions = React.useCallback(async () => {
    if (additions.length === 0) return
    const ok = await run(
      () => addMembers.mutateAsync(additions.map((person) => person.id)),
      t('chat.space.addFailed', "Couldn't add those people."),
    )
    if (ok) {
      setAdditions([])
      setMode('members')
    }
  }, [addMembers, additions, run, t])

  const handleRemove = React.useCallback(
    async (userId: string, name: string) => {
      const confirmed = await confirm({
        title: t('chat.space.removeTitle', 'Remove {name}?', { name }),
        description: t(
          'chat.space.removeDescription',
          'They lose access to this space immediately. Messages they already sent stay in the conversation.',
        ),
        confirmText: t('chat.space.removeConfirm', 'Remove'),
        variant: 'destructive',
      }).catch(() => false)
      if (!confirmed) return
      await run(
        () => removeMember.mutateAsync(userId),
        t('chat.space.removeFailed', "Couldn't remove that person."),
      )
    },
    [confirm, removeMember, run, t],
  )

  const handleLeave = React.useCallback(async () => {
    const confirmed = await confirm({
      title: t('chat.space.leaveTitle', 'Leave {name}?', { name: conversation.title }),
      description: t(
        'chat.space.leaveDescription',
        'It disappears from your chat list and you stop receiving its messages. Someone can add you back later.',
      ),
      confirmText: t('chat.space.leaveConfirm', 'Leave'),
      variant: 'destructive',
    }).catch(() => false)
    if (!confirmed) return
    const ok = await run(
      () => removeMember.mutateAsync(currentUserId),
      t('chat.space.leaveFailed', "Couldn't leave this space."),
    )
    // Only on success, and only after the write: the space is gone from under
    // this panel, so staying on its URL would show "couldn't open this
    // conversation" for a thing the user just chose to do.
    if (ok) {
      onClose()
      router.push('/backend/chat')
    }
  }, [confirm, conversation.title, currentUserId, onClose, removeMember, router, run, t])

  const memberRows = (
    <>
      {total > MEMBER_SEARCH_THRESHOLD ? (
        <SearchInput
          value={search}
          onChange={setSearch}
          size="sm"
          aria-label={t('chat.space.searchMembers', 'Search members')}
          placeholder={t('chat.space.searchMembers', 'Search members')}
        />
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div aria-busy="true">
            <MemberSkeleton />
            <MemberSkeleton />
            <MemberSkeleton />
          </div>
        ) : loadError ? (
          <ErrorMessage
            label={t('chat.space.membersError', "Couldn't load the members")}
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => retry()}>
                {t('chat.actions.retry', 'Try again')}
              </Button>
            }
          />
        ) : (
          /* The same row box as the picker's — avatar, two lines, a trailing
             control — so switching between the roster and "Add people" does not
             change the shape of a person. */
          <ul className="flex flex-col gap-1">
            {members.map((member) => {
              const isSelf = member.id === currentUserId
              // Owner-only, and never pointed at yourself: stepping down is
              // `Leave`, and removing yourself through the roster would be a
              // second, unlabelled way to do it.
              const actions = isOwner && !isSelf
                ? [
                    member.role === 'owner'
                      ? {
                          id: 'demote',
                          label: t('chat.space.makeMember', 'Make member'),
                          // No `void`: `RowActions` disables an entry whose
                          // `onSelect` returns a promise, and discarding it
                          // opted out of the primitive's own double-fire guard.
                          onSelect: () =>
                            run(
                              () => setMemberRole.mutateAsync({ userId: member.id, role: 'member' }),
                              t('chat.space.roleFailed', "Couldn't change that role."),
                            ),
                        }
                      : {
                          id: 'promote',
                          label: t('chat.space.makeOwner', 'Make owner'),
                          onSelect: () =>
                            run(
                              () => setMemberRole.mutateAsync({ userId: member.id, role: 'owner' }),
                              t('chat.space.roleFailed', "Couldn't change that role."),
                            ),
                        },
                    {
                      id: 'remove',
                      label: t('chat.space.remove', 'Remove from space'),
                      destructive: true,
                      onSelect: () => handleRemove(member.id, member.name),
                    },
                  ]
                : []

              return (
                <li key={member.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
                  <Avatar label={member.name} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                        {member.name}
                      </span>
                      {member.role === 'owner' ? (
                        <Tag variant="info" shape="pill">
                          {t('chat.space.owner', 'Owner')}
                        </Tag>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{member.email}</span>
                  </span>
                  {actions.length > 0 ? <RowActions items={actions} /> : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
        <DialogContent
          size="default"
          className="flex flex-col overflow-hidden"
          onKeyDown={(event) => {
            if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return
            event.preventDefault()
            if (mode === 'add') void submitAdditions()
            else if (renaming) void submitRename()
          }}
        >
          <DialogHeader leading={mode === 'add' ? <UserPlus aria-hidden="true" /> : <Users aria-hidden="true" />}>
            <DialogTitle>
              {mode === 'add' ? t('chat.space.addPeople', 'Add people') : conversation.title}
            </DialogTitle>
            <DialogDescription>
              {mode === 'add'
                ? t('chat.space.addDescription', 'Only people from your organization can be added.')
                : tCount(t, 'chat.space.memberCount', total, '{count} members')}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            {error ? <ErrorMessage label={error} /> : null}

            {mode === 'add' ? (
              <MemberPicker
                selected={additions}
                onChange={setAdditions}
                // The roster the panel already loaded, so the picker never
                // offers someone who is in the space. The server refuses
                // duplicates anyway; this stops the useless click.
                excludeIds={members.map((member) => member.id)}
                enabled={open}
                disabled={addMembers.isPending}
                autoFocus
                max={MAX_SPACE_MEMBERS_PER_REQUEST}
              />
            ) : (
              <>
                {/* Renaming happens in place rather than in yet another dialog:
                    it is one field, and the name is right there. */}
                {renaming ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={title}
                      autoFocus
                      maxLength={MAX_SPACE_TITLE_LENGTH}
                      disabled={rename.isPending}
                      aria-label={t('chat.space.nameLabel', 'Space name')}
                      onChange={(event) => setTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void submitRename()
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          setTitle(conversation.title)
                          setRenaming(false)
                        }
                      }}
                    />
                    <IconButton
                      variant="primary"
                      size="sm"
                      disabled={rename.isPending || title.trim().length === 0}
                      aria-label={t('chat.space.saveName', 'Save name')}
                      onClick={() => void submitRename()}
                    >
                      <Check className="size-4" aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      variant="ghost"
                      size="sm"
                      disabled={rename.isPending}
                      aria-label={t('chat.actions.cancel', 'Cancel')}
                      onClick={() => {
                        setTitle(conversation.title)
                        setRenaming(false)
                      }}
                    >
                      <X className="size-4" aria-hidden="true" />
                    </IconButton>
                  </div>
                ) : isOwner ? (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setRenaming(true)}>
                      <Pencil className="size-4" aria-hidden="true" />
                      {t('chat.space.rename', 'Rename')}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setMode('add')}>
                      <UserPlus className="size-4" aria-hidden="true" />
                      {t('chat.space.addPeople', 'Add people')}
                    </Button>
                  </div>
                ) : null}

                {memberRows}
              </>
            )}
          </DialogBody>

          <DialogFooter bordered>
            {mode === 'add' ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={addMembers.isPending}
                  onClick={() => {
                    setAdditions([])
                    setMode('members')
                  }}
                >
                  {t('chat.actions.back', 'Back')}
                </Button>
                <Button
                  type="button"
                  disabled={additions.length === 0 || addMembers.isPending}
                  onClick={() => void submitAdditions()}
                >
                  {addMembers.isPending
                    ? t('chat.space.adding', 'Adding…')
                    : t('chat.space.addCount', 'Add {count}', { count: additions.length })}
                </Button>
              </>
            ) : (
              <>
                {/* Destructive and always available to a member — including an
                    owner, who is told to hand over ownership first rather than
                    being shown a control that is missing. */}
                <Button
                  type="button"
                  variant="outline"
                  disabled={removeMember.isPending}
                  onClick={() => void handleLeave()}
                >
                  <LogOut className="size-4" aria-hidden="true" />
                  {t('chat.space.leave', 'Leave space')}
                </Button>
                <Button type="button" onClick={onClose}>
                  {t('chat.actions.done', 'Done')}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {ConfirmDialogElement}
    </>
  )
}
