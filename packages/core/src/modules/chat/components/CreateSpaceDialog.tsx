"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Users } from 'lucide-react'
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
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ChatDirectoryEntryDto } from '../data/types'
import { MAX_SPACE_MEMBERS_PER_REQUEST, MAX_SPACE_TITLE_LENGTH } from '../data/validators'
import { MemberPicker } from './MemberPicker'
import { useSpaceMutations } from './hooks'

export type CreateSpaceDialogProps = {
  /** Kept mounted so closing restores focus to whatever opened it. */
  open: boolean
  onClose: () => void
}

/**
 * Create a space: name it, pick who is in it.
 *
 * Members are optional — "create it now, add people in a minute" is a real way
 * to work, and requiring a second person would make a space you set up before a
 * project starts impossible. The creator is added as owner server-side, so there
 * is no state where a space exists that its creator cannot see.
 *
 * On success it routes to the new space rather than closing back to the list,
 * which is what "create" is for and gives the space a real URL immediately.
 */
export function CreateSpaceDialog({ open, onClose }: CreateSpaceDialogProps) {
  const t = useT()
  const router = useRouter()
  const [title, setTitle] = React.useState('')
  const [members, setMembers] = React.useState<ChatDirectoryEntryDto[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const { createSpace } = useSpaceMutations()

  // The dialog outlives one opening, so it clears itself rather than carrying
  // the previous attempt's name and selection into the next.
  React.useEffect(() => {
    if (open) return
    setTitle('')
    setMembers([])
    setError(null)
  }, [open])

  const trimmed = title.trim()
  const canSubmit = trimmed.length > 0 && !createSpace.isPending

  const submit = React.useCallback(async () => {
    if (!canSubmit) return
    setError(null)
    try {
      const space = await createSpace.mutateAsync({
        title: trimmed,
        memberIds: members.map((person) => person.id),
      })
      onClose()
      router.push(`/backend/chat/${space.id}`)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : t('chat.space.createFailed', "Couldn't create that space."),
      )
    }
  }, [canSubmit, createSpace, members, onClose, router, t, trimmed])

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      {/* `size`, not a `max-w-*` override: `default` already resolves to the
          DS's `sm:max-w-lg`, and the primitive owns the mobile bottom-sheet
          reflow that a hand-rolled max-width silently opts out of. */}
      <DialogContent
        size="default"
        className="flex flex-col overflow-hidden"
        // The module's dialog convention: Cmd/Ctrl+Enter submits from anywhere
        // inside, including the search field, so the name and the picker do not
        // need different muscle memory.
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void submit()
          }
        }}
      >
        {/* The header's own icon badge, rather than a bare title — the DS slot
            exists for exactly this and keeps the badge, the title's first line
            and the close button on one band. */}
        <DialogHeader leading={<Users aria-hidden="true" />}>
          <DialogTitle>{t('chat.space.createTitle', 'New space')}</DialogTitle>
          <DialogDescription>
            {t('chat.space.createDescription', 'Name it, then add people from your organization.')}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          {/* `FormField` owns the id and clones it onto the child, so the label
              is wired to the input without either side naming it. */}
          <FormField label={t('chat.space.nameLabel', 'Space name')} required>
            <Input
              value={title}
              autoFocus
              maxLength={MAX_SPACE_TITLE_LENGTH}
              disabled={createSpace.isPending}
              placeholder={t('chat.space.namePlaceholder', 'Project Alpha')}
              onChange={(event) => setTitle(event.target.value)}
            />
          </FormField>

          {error ? <ErrorMessage label={error} /> : null}

          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
            <p className="text-sm font-medium text-foreground">
              {t('chat.space.membersLabel', 'People')}
            </p>
            <MemberPicker
              selected={members}
              onChange={setMembers}
              enabled={open}
              disabled={createSpace.isPending}
              max={MAX_SPACE_MEMBERS_PER_REQUEST}
            />
          </div>
        </DialogBody>

        {/* `bordered`, because the body scrolls: without the rule the button
            row floats over the last member in the list. */}
        <DialogFooter bordered>
          <Button type="button" variant="outline" onClick={onClose} disabled={createSpace.isPending}>
            {t('chat.actions.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={!canSubmit}>
            {createSpace.isPending
              ? t('chat.space.creating', 'Creating…')
              : t('chat.space.create', 'Create space')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
