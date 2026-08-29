"use client"

import * as React from 'react'
import { Check, Plus, Users } from 'lucide-react'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { MENU_ROW_HOVER, menuRowVariants } from '@open-mercato/ui/primitives/menu'
import type { TaskAssignmentTargetInput } from './assignmentTypes'
import { AvatarStack, CHIP_ADD_CLASS, Chip } from './badges'
import { UserAvatar } from './ui-bits'
import { useAssignableUsers, useAssignmentOptions } from './hooks'

/**
 * Assigns a task to people, to role audiences, or to both. A role target hands
 * the task to whoever holds that role at read time, so "all Interns" keeps
 * working as the interns change.
 */
export function AssignPicker({
  assigneeIds,
  targets,
  onChange,
}: {
  assigneeIds: string[]
  targets: TaskAssignmentTargetInput[]
  onChange: (assigneeIds: string[], targets: TaskAssignmentTargetInput[]) => void
}) {
  const t = useT()
  const { users } = useAssignableUsers()
  const { roles } = useAssignmentOptions()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')

  const selectedUsers = React.useMemo(() => new Set(assigneeIds), [assigneeIds])
  const roleIds = React.useMemo(
    () => new Set(targets.filter((target) => target.roleId).map((target) => target.roleId as string)),
    [targets],
  )

  const toggleUser = (id: string) => {
    onChange(
      selectedUsers.has(id) ? assigneeIds.filter((value) => value !== id) : [...assigneeIds, id],
      targets,
    )
  }

  const toggleRole = (id: string) => {
    const next = new Set(roleIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(
      assigneeIds,
      [...next].map((roleId) => ({ kind: 'role' as const, roleId })),
    )
  }

  const needle = query.trim().toLowerCase()
  const matchedUsers = users.filter((user) => user.name.toLowerCase().includes(needle))
  const matchedRoles = roles.filter((role) => role.name.toLowerCase().includes(needle))

  const nameOfUser = (id: string) => users.find((user) => user.id === id)?.name ?? ''
  const nameOfRole = (id: string) => roles.find((role) => role.id === id)?.name ?? ''

  const selectedPeople = assigneeIds
    .map((id) => ({ id, name: nameOfUser(id) }))
    .filter((person) => person.name.length > 0)
  const selectedRoles = [...roleIds]
  const empty = assigneeIds.length === 0 && selectedRoles.length === 0
  const summary = [
    ...selectedPeople.map((person) => person.name),
    ...selectedRoles.map((id) => t('tasks.common.roleTarget', 'Role: {name}', { name: nameOfRole(id) })),
  ].join(', ')

  return (
    <div className="flex min-h-8 items-center">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            title={empty ? t('tasks.assign.trigger', 'Assign people or roles') : summary}
            className={
              empty
                ? CHIP_ADD_CLASS
                : 'inline-flex min-h-8 max-w-full flex-wrap items-center gap-1.5 rounded-full px-1.5 py-1 text-left transition-colors hover:bg-surface-muted focus:outline-none focus-visible:shadow-focus'
            }
          >
            {empty ? (
              <>
                <Plus className="size-3.5" aria-hidden="true" />
                {t('tasks.assign.assign', 'Assign')}
              </>
            ) : (
              <>
                <AvatarStack people={selectedPeople} max={5} />
                {selectedRoles.map((id) => (
                  <Chip key={id} title={t('tasks.common.roleTarget', 'Role: {name}', { name: nameOfRole(id) })}>
                    <Users className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{nameOfRole(id)}</span>
                  </Chip>
                ))}
                <span className="sr-only">{t('tasks.assign.change', 'Change assignees')}</span>
              </>
            )}
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          className="flex max-h-80 w-72 flex-col p-2"
          role="listbox"
          aria-label={t('tasks.assign.menuLabel', 'Assign people and roles')}
        >
          <div className="mb-1 pb-1">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder={t('tasks.assign.searchPlaceholder', 'Search people, roles…')}
              aria-label={t('tasks.assign.searchLabel', 'Search people and roles')}
              size="sm"
              autoFocus
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <PickerSection title={t('tasks.assign.people', 'People')} hidden={matchedUsers.length === 0}>
              {matchedUsers.map((user) => (
                <PickerRow
                  key={user.id}
                  checked={selectedUsers.has(user.id)}
                  onToggle={() => toggleUser(user.id)}
                >
                  <UserAvatar name={user.name} size="xs" />
                  <span className="truncate">{user.name}</span>
                </PickerRow>
              ))}
            </PickerSection>

            <PickerSection title={t('tasks.assign.roles', 'Roles')} hidden={matchedRoles.length === 0}>
              {matchedRoles.map((role) => (
                <PickerRow key={role.id} checked={roleIds.has(role.id)} onToggle={() => toggleRole(role.id)}>
                  <Users className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{role.name}</span>
                </PickerRow>
              ))}
            </PickerSection>

            {matchedUsers.length === 0 && matchedRoles.length === 0 && (
              <div className="px-2">
                <EmptyState
                  variant="subtle"
                  size="sm"
                  title={
                    needle === ''
                      ? t('tasks.assign.empty', 'Nobody to assign yet')
                      : t('tasks.assign.noMatch', 'No people or roles match')
                  }
                  description={
                    needle === ''
                      ? t('tasks.assign.emptyHint', 'Once your company has users and roles, they show up here.')
                      : t('tasks.assign.noMatchHint', 'Nothing matches “{query}”. Try a shorter word.', {
                          query: query.trim(),
                        })
                  }
                />
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function PickerSection({
  title,
  hidden,
  children,
}: {
  title: string
  hidden: boolean
  children: React.ReactNode
}) {
  if (hidden) return null
  return (
    <div className="mb-1">
      <p className="px-3 pb-1 pt-2 text-overline font-semibold uppercase tracking-widest text-disabled-foreground">
        {title}
      </p>
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

function PickerRow({
  checked,
  onToggle,
  children,
}: {
  checked: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      role="option"
      aria-selected={checked}
      className={cn(
        menuRowVariants({ selected: checked }),
        'font-medium',
        !checked && MENU_ROW_HOVER,
      )}
    >
      {children}
      {checked && <Check className="ml-auto size-3.5 shrink-0 text-accent-strong" aria-hidden="true" />}
    </button>
  )
}
