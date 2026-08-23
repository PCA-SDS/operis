"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import {
  PROJECT_DEFAULT_ICON,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_KEY_MAX_LENGTH,
  PROJECT_KEY_REGEX,
  PROJECT_NAME_MAX_LENGTH,
} from '../data/types'
import { UserPicker } from './pickers'
import { CARD_CAPTION_CLASS, ErrorBanner, Field, SkeletonBlock, TextArea, TextInput } from './ui-bits'
import { useAssignableUsers, useProject, useProjectMutations } from './hooks'

const ICON_PRESETS = [
  '📋', '🚀', '🛠️', '🎯', '📦', '💡', '📊', '🧪', '🎨',
  '🗂️', '🔧', '🌐', '📝', '⚙️', '🔥', '🧭', '🔒', '🧱',
] as const

/** Beyond a handful of people a full checklist is noise, so the member list
 *  shows the first few and hands the rest to search. */
const MEMBER_PREVIEW_COUNT = 5

type FormState = {
  key: string
  name: string
  description: string
  icon: string
  ownerId: string | null
  memberIds: string[]
}

function initialForm(): FormState {
  return { key: '', name: '', description: '', icon: PROJECT_DEFAULT_ICON, ownerId: null, memberIds: [] }
}

/** Create or edit a project. The key is immutable in spirit — it prefixes every
 *  task reference — so it is validated hard rather than silently normalised. */
export function ProjectFormDialog({
  projectId,
  onClose,
}: {
  projectId: string | null
  onClose: () => void
}) {
  const t = useT()
  const router = useRouter()
  const isEdit = projectId !== null

  const { users } = useAssignableUsers()
  const { create, update } = useProjectMutations()
  const { project, isLoading: isLoadingProject } = useProject(projectId ?? undefined)

  const [form, setForm] = React.useState<FormState>(initialForm)
  const [submitted, setSubmitted] = React.useState(false)
  const [banner, setBanner] = React.useState<string | null>(null)
  const [hydratedId, setHydratedId] = React.useState<string | null>(null)
  const [memberQuery, setMemberQuery] = React.useState('')

  const busy = create.isPending || update.isPending

  React.useEffect(() => {
    if (!isEdit || !project || hydratedId === project.id) return
    setForm({
      key: project.key,
      name: project.name,
      description: project.description ?? '',
      icon: project.icon,
      ownerId: project.owner?.id ?? null,
      memberIds: project.members.map((member) => member.id),
    })
    setHydratedId(project.id)
  }, [isEdit, project, hydratedId])

  // Errors only appear after a submit attempt — flagging an empty required
  // field before anyone has tried to save is nagging, not helping.
  const errors = React.useMemo(() => {
    if (!submitted) return {} as Record<string, string>
    const result: Record<string, string> = {}
    if (!PROJECT_KEY_REGEX.test(form.key.trim())) {
      result.key = t('tasks.projectForm.keyError', '2–10 uppercase letters/digits, starting with a letter.')
    }
    if (form.name.trim() === '') {
      result.name = t('tasks.projectForm.nameError', 'Enter a project name.')
    }
    return result
  }, [submitted, form, t])

  const sortedUsers = React.useMemo(
    () => [...users].sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  )
  const memberSearchable = users.length > MEMBER_PREVIEW_COUNT
  const memberNeedle = memberQuery.trim().toLowerCase()
  const visibleUsers = memberNeedle
    ? sortedUsers.filter((user) => user.name.toLowerCase().includes(memberNeedle))
    : sortedUsers.slice(0, MEMBER_PREVIEW_COUNT)
  const selectedMemberCount = React.useMemo(() => {
    const ids = new Set(form.memberIds)
    if (form.ownerId) ids.add(form.ownerId)
    return ids.size
  }, [form.memberIds, form.ownerId])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }))

  const toggleMember = (userId: string) =>
    setForm((previous) => ({
      ...previous,
      memberIds: previous.memberIds.includes(userId)
        ? previous.memberIds.filter((id) => id !== userId)
        : [...previous.memberIds, userId],
    }))

  const submit = async () => {
    setSubmitted(true)
    setBanner(null)
    if (!PROJECT_KEY_REGEX.test(form.key.trim()) || form.name.trim() === '') return

    const body = {
      key: form.key.trim().toUpperCase(),
      name: form.name.trim(),
      description: form.description.trim() || null,
      icon: form.icon,
      ownerId: form.ownerId,
      memberIds: form.memberIds,
    }

    try {
      if (isEdit && projectId) {
        await update.mutateAsync({ id: projectId, body, updatedAt: project?.updatedAt })
        flash(t('tasks.projects.updated', 'Project updated.'), 'success')
        onClose()
      } else {
        const created = await create.mutateAsync(body)
        flash(t('tasks.projects.created', 'Project created.'), 'success')
        router.push(`/backend/tasks/projects/${created.id}`)
      }
    } catch (error) {
      setBanner(
        error instanceof Error && error.message
          ? error.message
          : t('tasks.projectForm.saveFailed', 'Could not save the project.'),
      )
    }
  }

  const loadingEdit = isEdit && isLoadingProject && hydratedId === null

  return (
    <Dialog open onOpenChange={(open) => (open || busy ? undefined : onClose())}>
      <DialogContent className="flex max-h-[calc(100dvh-4rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="px-5 pb-2 pt-5 sm:px-6">
          <DialogTitle>
            {isEdit
              ? t('tasks.projectForm.editTitle', 'Edit Project')
              : t('tasks.projectForm.newTitle', 'New Project')}
          </DialogTitle>
        </DialogHeader>

        {loadingEdit ? (
          <div className="space-y-3 p-6">
            <SkeletonBlock className="h-8 w-40" />
            <SkeletonBlock className="h-24" />
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-3 sm:px-6">
            {banner && <ErrorBanner>{banner}</ErrorBanner>}

            <div className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <section className="space-y-4">
                <h4 className={CARD_CAPTION_CLASS}>{t('tasks.projectForm.details', 'Details')}</h4>

                <Field label={t('tasks.projectForm.icon', 'Icon')}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {ICON_PRESETS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        aria-label={t('tasks.projectForm.iconOption', 'Icon {emoji}', { emoji })}
                        aria-pressed={form.icon === emoji}
                        onClick={() => set('icon', emoji)}
                        className={cn(
                          'flex size-9 items-center justify-center rounded-lg text-lg transition-transform hover:scale-110 focus:outline-none focus-visible:shadow-focus',
                          form.icon === emoji ? 'bg-primary-soft' : 'bg-surface-muted hover:bg-surface-strong',
                        )}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </Field>

                <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
                  <Field label={t('tasks.projectForm.key', 'Key')} required error={errors.key}>
                    <TextInput
                      value={form.key}
                      onChange={(value) => set('key', value.toUpperCase().slice(0, PROJECT_KEY_MAX_LENGTH))}
                      placeholder={t('tasks.projectForm.keyPlaceholder', 'ENG')}
                      invalid={!!errors.key}
                      disabled={busy}
                    />
                  </Field>
                  <Field label={t('tasks.projectForm.name', 'Name')} required error={errors.name}>
                    <TextInput
                      value={form.name}
                      onChange={(value) => set('name', value)}
                      placeholder={t('tasks.projectForm.namePlaceholder', 'Engineering')}
                      maxLength={PROJECT_NAME_MAX_LENGTH}
                      invalid={!!errors.name}
                      disabled={busy}
                    />
                  </Field>
                </div>

                <Field label={t('tasks.projectForm.description', 'Description')}>
                  <TextArea
                    value={form.description}
                    onChange={(value) => set('description', value)}
                    placeholder={t('tasks.projectForm.descriptionPlaceholder', 'What is this project about?')}
                    maxLength={PROJECT_DESCRIPTION_MAX_LENGTH}
                    rows={3}
                    disabled={busy}
                  />
                </Field>

                <Field label={t('tasks.projectForm.owner', 'Owner')}>
                  <UserPicker
                    value={form.ownerId}
                    onChange={(value) => set('ownerId', value)}
                    users={users}
                    unassignedLabel={t('tasks.projectForm.noOwner', 'No owner')}
                  />
                </Field>
              </section>

              <section className="space-y-4">
                <h4 className={CARD_CAPTION_CLASS}>{t('tasks.projectForm.members', 'Members')}</h4>

                {users.length === 0 ? (
                  <EmptyState
                    variant="subtle"
                    size="sm"
                    title={t('tasks.projectForm.noMembers', 'No one to add yet')}
                    description={t(
                      'tasks.projectForm.noMembersHint',
                      'Invite people to your company and they can be added here.',
                    )}
                  />
                ) : (
                  <div className="space-y-2">
                    {memberSearchable && (
                      <SearchInput
                        value={memberQuery}
                        onChange={setMemberQuery}
                        placeholder={t('tasks.projectForm.searchMembers', 'Search members')}
                        aria-label={t('tasks.projectForm.searchMembers', 'Search members')}
                        size="sm"
                      />
                    )}

                    {visibleUsers.length === 0 ? (
                      <EmptyState
                        variant="subtle"
                        size="sm"
                        title={t('tasks.projectForm.noMemberMatch', 'No members match your search')}
                        description={t(
                          'tasks.projectForm.noMemberMatchHint',
                          'Nobody matches “{query}”. Try a shorter word.',
                          { query: memberQuery.trim() },
                        )}
                      />
                    ) : (
                      <div className="grid max-h-72 gap-1 overflow-y-auto">
                        {visibleUsers.map((user) => {
                          // The owner is a member by definition, so their row is
                          // shown ticked and locked rather than quietly missing.
                          const isOwner = form.ownerId === user.id
                          const checked = form.memberIds.includes(user.id) || isOwner
                          return (
                            <label
                              key={user.id}
                              className={cn(
                                'flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm',
                                isOwner ? 'opacity-70' : 'hover:bg-surface-muted',
                              )}
                            >
                              <Checkbox
                                checked={checked}
                                disabled={isOwner || busy}
                                onCheckedChange={() => toggleMember(user.id)}
                              />
                              <span className="min-w-0 truncate">
                                <span className="font-medium text-foreground">{user.name}</span>
                                {isOwner && (
                                  <span className="ml-1 text-xs text-muted-foreground">
                                    {t('tasks.projectForm.ownerBadge', '(owner)')}
                                  </span>
                                )}
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    )}

                    {memberSearchable && !memberNeedle && (
                      <p className="px-1 text-xs text-muted-foreground">
                        {selectedMemberCount > 0
                          ? t(
                              'tasks.projectForm.memberSummarySelected',
                              'Showing top {shown} of {total} · {selected} selected. Search to find anyone.',
                              {
                                shown: MEMBER_PREVIEW_COUNT,
                                total: users.length,
                                selected: selectedMemberCount,
                              },
                            )
                          : t(
                              'tasks.projectForm.memberSummary',
                              'Showing top {shown} of {total}. Search to find anyone.',
                              { shown: MEMBER_PREVIEW_COUNT, total: users.length },
                            )}
                      </p>
                    )}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        <DialogFooter className="px-5 pb-4 pt-1.5 sm:px-6">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            {t('tasks.common.cancel', 'Cancel')}
          </Button>
          <Button type="button" size="sm" onClick={() => void submit()} disabled={busy || loadingEdit}>
            {isEdit
              ? t('tasks.projectForm.save', 'Save changes')
              : t('tasks.projectForm.create', 'Create project')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
