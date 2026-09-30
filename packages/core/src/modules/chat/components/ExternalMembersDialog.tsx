'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Globe } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
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
import {
  InlineSelectTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@open-mercato/ui/primitives/inline-select'
import { SelectTrigger } from '@open-mercato/ui/primitives/select'
import { Label } from '@open-mercato/ui/primitives/label'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type {
  ChatConversationDto,
  ChatDirectoryEntryDto,
  ChatExternalMemberDto,
  ChatParticipantAccess,
} from '../data/types'
import { MAX_SPACE_MEMBERS_PER_REQUEST } from '../data/validators'
import { accessOf, CHAT_ACCESS_LEVELS, isChatAccess } from '../lib/access'
import { networkLabel } from './externalNetwork'
import { CrmLinkPicker } from './CrmLinkPicker'
import { MemberPicker } from './MemberPicker'
import { useContactCrmLink, useSpaceMembers, useSpaceMutations } from './hooks'

type Translate = ReturnType<typeof useT>

function accessLabel(t: Translate, access: ChatParticipantAccess): string {
  if (access === 'viewer') return t('chat.access.viewer', 'Viewer')
  if (access === 'participant') return t('chat.access.participant', 'Participant')
  return t('chat.access.manager', 'Manager')
}

function accessDescription(t: Translate, access: ChatParticipantAccess): string {
  if (access === 'viewer') return t('chat.access.viewerDescription', 'Reads the chat and leaves internal notes.')
  if (access === 'participant') return t('chat.access.participantDescription', 'Also replies to the client.')
  return t('chat.access.managerDescription', 'Also decides who is in the chat and what they can do.')
}

/**
 * An outsider's CRM side: the record they are linked to — named only when the
 * CRM lets this colleague open it — or, while unlinked, the CRM person with
 * their number, or a way to find one.
 */
function ContactCrm({
  member,
  canLink,
  busy,
  onLink,
  onUnlink,
  onFind,
  onOpen,
}: {
  member: ChatExternalMemberDto
  canLink: boolean
  busy: boolean
  onLink: (member: ChatExternalMemberDto, customerEntityId: string) => void
  onUnlink: (member: ChatExternalMemberDto) => void
  onFind: (member: ChatExternalMemberDto) => void
  onOpen: () => void
}) {
  const t = useT()
  if (member.customer) {
    const { href, name } = member.customer
    return (
      <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground" data-testid="chat-crm-linked">
        {href && name ? (
          <>
            <span>{t('chat.crm.label', 'CRM')}</span>
            <LinkButton size="sm" asChild>
              <Link href={href} onClick={onOpen}>
                {name}
              </Link>
            </LinkButton>
          </>
        ) : (
          <span>{t('chat.crm.linkedHidden', 'Linked to a CRM record you can’t open')}</span>
        )}
        {canLink ? (
          <LinkButton size="sm" variant="gray" disabled={busy} onClick={() => onUnlink(member)}>
            {t('chat.crm.unlink', 'Unlink')}
          </LinkButton>
        ) : null}
      </span>
    )
  }
  if (!canLink) return null
  const suggestion = member.suggestion
  if (suggestion?.name) {
    return (
      <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground" data-testid="chat-crm-suggestion">
        <span>{t('chat.crm.suggest', 'Is this {name} from the CRM?', { name: suggestion.name })}</span>
        <LinkButton size="sm" disabled={busy} onClick={() => onLink(member, suggestion.id)}>
          {t('chat.crm.linkSuggested', 'Link')}
        </LinkButton>
        <LinkButton size="sm" variant="gray" disabled={busy} onClick={() => onFind(member)}>
          {t('chat.crm.findOther', 'Someone else')}
        </LinkButton>
      </span>
    )
  }
  return (
    <span className="text-xs">
      <LinkButton size="sm" disabled={busy} onClick={() => onFind(member)} data-testid="chat-crm-link">
        {t('chat.crm.link', 'Link to CRM')}
      </LinkButton>
    </span>
  )
}

/**
 * Who is in a client (external) conversation, and handing it over.
 *
 * Colleagues first, each with their level, then the people outside, each named
 * with the network they are on. A manager brings colleagues in — they are told
 * they were added — sets what each can do, and removes them; anyone can leave.
 * The last colleague cannot, because a customer must never be left writing to
 * nobody, and neither can the last manager while others remain. The server
 * holds both rules; this only stops offering what it would refuse. The
 * outsiders come from the chat itself and cannot be added or removed here.
 */
export function ExternalMembersDialog({
  open,
  onClose,
  conversation,
  currentUserId,
}: {
  open: boolean
  onClose: () => void
  conversation: ChatConversationDto
  currentUserId: string
}) {
  const t = useT()
  const router = useRouter()
  const { members, externalMembers, crm, isLoading, error } = useSpaceMembers(conversation.id, '', open)
  const { addMembers, removeMember, setMemberAccess } = useSpaceMutations(conversation.id)
  const crmLink = useContactCrmLink(conversation.id)
  const [linking, setLinking] = React.useState<ChatExternalMemberDto | null>(null)
  // Removing someone, or leaving, asks first — as a step of this dialog: a
  // second modal over it would be hidden from assistive technology.
  const [removing, setRemoving] = React.useState<{ userId: string; name: string } | null>(null)
  const [adding, setAdding] = React.useState(false)
  const [additions, setAdditions] = React.useState<ChatDirectoryEntryDto[]>([])
  const [additionAccess, setAdditionAccess] = React.useState<ChatParticipantAccess>('viewer')
  const [actionError, setActionError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) return
    setAdding(false)
    setAdditions([])
    setAdditionAccess('viewer')
    setLinking(null)
    setRemoving(null)
    setActionError(null)
  }, [open])

  const canManage = accessOf({ access: conversation.viewerAccess }) === 'manager'
  const onlyColleague = members.length <= 1
  const busy = addMembers.isPending || removeMember.isPending || setMemberAccess.isPending || crmLink.isPending

  const run = React.useCallback(async (work: () => Promise<unknown>, fallback: string) => {
    setActionError(null)
    try {
      await work()
      return true
    } catch (err) {
      setActionError(err instanceof Error && err.message ? err.message : fallback)
      return false
    }
  }, [])

  const submitAdditions = React.useCallback(async () => {
    if (additions.length === 0) return
    const ok = await run(
      () => addMembers.mutateAsync({ memberIds: additions.map((person) => person.id), access: additionAccess }),
      t('chat.external.addFailed', "Couldn't add those colleagues."),
    )
    if (ok) {
      setAdditions([])
      setAdditionAccess('viewer')
      setAdding(false)
    }
  }, [addMembers, additionAccess, additions, run, t])

  const linkCustomer = React.useCallback(
    async (member: ChatExternalMemberDto, customerEntityId: string | null) => {
      const ok = await run(
        () => crmLink.mutateAsync({ contactId: member.id, customerEntityId }),
        customerEntityId
          ? t('chat.crm.linkFailed', "Couldn't link that record.")
          : t('chat.crm.unlinkFailed', "Couldn't unlink it."),
      )
      if (ok) setLinking(null)
    },
    [crmLink, run, t],
  )

  const changeAccess = React.useCallback(
    (userId: string, next: string) => {
      if (!isChatAccess(next)) return
      void run(
        () => setMemberAccess.mutateAsync({ userId, access: next }),
        t('chat.access.changeFailed', "Couldn't change what they can do."),
      )
    },
    [run, setMemberAccess, t],
  )

  const leaving = removing?.userId === currentUserId

  const confirmRemove = React.useCallback(async () => {
    if (!removing) return
    const self = removing.userId === currentUserId
    const ok = await run(
      () => removeMember.mutateAsync(removing.userId),
      self
        ? t('chat.external.leaveFailed', "Couldn't leave this chat.")
        : t('chat.space.removeFailed', "Couldn't remove that person."),
    )
    if (!ok) return
    setRemoving(null)
    if (self) {
      onClose()
      router.push('/backend/chat')
    }
  }, [currentUserId, onClose, removeMember, removing, router, run, t])

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        size="default"
        className="flex flex-col overflow-hidden"
        onKeyDown={(event) => {
          if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return
          if (removing) {
            event.preventDefault()
            void confirmRemove()
          } else if (adding) {
            event.preventDefault()
            void submitAdditions()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {removing
              ? leaving
                ? t('chat.external.leaveTitle', 'Leave this chat?')
                : t('chat.space.removeTitle', 'Remove {name}?', { name: removing.name })
              : conversation.title}
          </DialogTitle>
          <DialogDescription>
            {removing
              ? leaving
                ? t(
                    'chat.external.leaveDescription',
                    'It disappears from your chat list. The customer keeps talking to the colleagues who stay.',
                  )
                : t(
                    'chat.external.removeDescription',
                    'They lose access to this chat immediately. Messages they already sent stay in it.',
                  )
              : conversation.external?.account
              ? t(
                  'chat.external.membersDescriptionAccount',
                  'Messages here go to the people under External, from {account}.',
                  { account: conversation.external.account.name },
                )
              : t(
                  'chat.external.membersDescription',
                  'Messages here go to the people under External, outside your organization.',
                )}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {error ? <ErrorMessage label={t('chat.space.membersError', "Couldn't load the members")} /> : null}
          {actionError ? <ErrorMessage label={actionError} /> : null}
          {removing ? null : isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : linking ? (
            <CrmLinkPicker
              conversationId={conversation.id}
              contactName={linking.name}
              disabled={busy}
              onPick={(record) => void linkCustomer(linking, record.id)}
            />
          ) : adding ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="chat-external-add">
              <p className="text-sm text-muted-foreground">
                {t('chat.external.addHint', 'They are added to this chat and told about it.')}
              </p>
              <MemberPicker
                selected={additions}
                onChange={setAdditions}
                excludeIds={members.map((member) => member.id)}
                enabled={open && adding}
                disabled={busy}
                autoFocus
                max={MAX_SPACE_MEMBERS_PER_REQUEST}
              />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="chat-external-add-access">{t('chat.access.addLabel', 'What they can do')}</Label>
                <Select
                  value={additionAccess}
                  onValueChange={(next) => {
                    if (isChatAccess(next)) setAdditionAccess(next)
                  }}
                  disabled={busy}
                >
                  <SelectTrigger id="chat-external-add-access" data-testid="chat-external-add-access">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHAT_ACCESS_LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>
                        {accessLabel(t, level)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{accessDescription(t, additionAccess)}</p>
              </div>
            </div>
          ) : (
            <>
              <section aria-labelledby="chat-external-members-colleagues" className="flex flex-col gap-1">
                <h3 id="chat-external-members-colleagues" className="text-overline text-muted-foreground">
                  {t('chat.space.membersLabel', 'People')}
                </h3>
                <ul className="flex flex-col gap-1">
                  {members.map((member) => {
                    const self = member.id === currentUserId
                    const level = accessOf(member)
                    return (
                      <li
                        key={member.id}
                        className="flex items-center gap-3 rounded-lg px-3 py-2.5"
                        data-testid="chat-external-colleague"
                        data-access={level}
                      >
                        <Avatar label={member.name} size="md" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-foreground">{member.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{member.email}</span>
                        </span>
                        {canManage ? (
                          <Select value={level} onValueChange={(next) => changeAccess(member.id, next)} disabled={busy}>
                            <InlineSelectTrigger
                              className="w-auto shrink-0"
                              aria-label={t('chat.access.memberAria', 'What {name} can do', { name: member.name })}
                              data-testid="chat-external-access"
                            >
                              <SelectValue />
                            </InlineSelectTrigger>
                            <SelectContent align="end">
                              {CHAT_ACCESS_LEVELS.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {accessLabel(t, option)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="shrink-0 text-xs text-muted-foreground">{accessLabel(t, level)}</span>
                        )}
                        {onlyColleague || (!self && !canManage) ? null : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              setActionError(null)
                              setRemoving({ userId: member.id, name: member.name })
                            }}
                          >
                            {self ? t('chat.external.leave', 'Leave') : t('chat.space.remove', 'Remove')}
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
                <p className="px-3 text-xs text-muted-foreground">
                  {t(
                    'chat.access.legend',
                    'Viewers read the chat and leave internal notes. Participants also reply to the client. Managers also decide who is in the chat.',
                  )}
                </p>
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
                    <li
                      key={member.id}
                      className="flex items-start gap-3 rounded-lg px-3 py-2.5"
                      data-testid="chat-external-contact"
                      data-contact-id={member.id}
                    >
                      <Avatar label={member.name} size="md" icon={<Globe className="size-4" aria-hidden="true" />} />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm font-semibold text-foreground">{member.name}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {member.handle
                            ? `${networkLabel(t, member.network)} · ${member.handle}`
                            : networkLabel(t, member.network)}
                        </span>
                        {crm.available ? (
                          <ContactCrm
                            member={member}
                            canLink={crm.canLink}
                            busy={busy}
                            onLink={(target, customerEntityId) => void linkCustomer(target, customerEntityId)}
                            onUnlink={(target) => void linkCustomer(target, null)}
                            onFind={setLinking}
                            onOpen={onClose}
                          />
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </DialogBody>

        <DialogFooter bordered>
          {removing ? (
            <>
              <Button type="button" variant="soft" onClick={() => setRemoving(null)} disabled={busy}>
                {t('chat.actions.cancel', 'Cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive-solid"
                onClick={() => void confirmRemove()}
                disabled={busy}
                data-testid="chat-external-remove-confirm"
              >
                {leaving ? t('chat.space.leaveConfirm', 'Leave') : t('chat.space.removeConfirm', 'Remove')}
              </Button>
            </>
          ) : linking ? (
            <Button type="button" variant="soft" onClick={() => setLinking(null)} disabled={busy}>
              {t('chat.actions.cancel', 'Cancel')}
            </Button>
          ) : adding ? (
            <>
              <Button type="button" variant="soft" onClick={() => setAdding(false)} disabled={busy}>
                {t('chat.actions.cancel', 'Cancel')}
              </Button>
              <Button type="button" onClick={() => void submitAdditions()} disabled={busy || additions.length === 0}>
                {addMembers.isPending ? t('chat.space.adding', 'Adding…') : t('chat.external.addConfirm', 'Add to chat')}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={onClose}>
                {t('chat.actions.close', 'Close')}
              </Button>
              {canManage ? (
                <Button type="button" onClick={() => setAdding(true)} data-testid="chat-external-add-button">
                  {t('chat.external.addColleague', 'Add a colleague')}
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
