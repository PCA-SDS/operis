"use client"

import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ProjectDetailDto } from '../data/types'
import {
  CARD_CAPTION_CLASS,
  ErrorState,
  ProgressBar,
  Section,
  SkeletonBlock,
  UserAvatar,
} from './ui-bits'
import { MILESTONE_STATUS_META, formatTaskDate } from './format'
import { useMilestones, useTaskError } from './hooks'

/** The project at a glance: what it is, how far along it is, and who is on it. */
export function OverviewTab({ project }: { project: ProjectDetailDto }) {
  const t = useT()
  const { milestones, isLoading, error, retry } = useMilestones(project.id)
  const errorMessage = useTaskError(error, t('tasks.common.loadFailed', "This didn't load"))

  const done = project.taskCount - project.openTaskCount
  const progress = project.taskCount === 0 ? 0 : Math.round((done / project.taskCount) * 100)

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <div className="space-y-4">
        <Section title={t('tasks.overview.about', 'About')}>
          {project.description ? (
            <p className="text-sm leading-relaxed text-foreground">{project.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('tasks.overview.noDescription', 'No description for this project yet.')}
            </p>
          )}
          <div className="grid gap-3 pt-1 sm:grid-cols-2">
            <div>
              <p className={CARD_CAPTION_CLASS}>{t('tasks.overview.startDate', 'Start date')}</p>
              <p className="mt-0.5 text-sm text-foreground">{formatTaskDate(project.startDate)}</p>
            </div>
          </div>
        </Section>

        <Section
          title={t('tasks.overview.progress', 'Progress')}
          actions={
            <span className="text-sm text-muted-foreground">
              {t('tasks.overview.progressSummary', '{done}/{total} tasks done', {
                done,
                total: project.taskCount,
              })}
            </span>
          }
        >
          <ProgressBar value={progress} />
        </Section>

        <Section title={t('tasks.overview.milestones', 'Milestones')}>
          {errorMessage ? (
            <ErrorState message={errorMessage} onRetry={retry} />
          ) : isLoading ? (
            <SkeletonBlock className="h-20" />
          ) : milestones.length === 0 ? (
            <EmptyState
              variant="subtle"
              title={t('tasks.overview.noMilestones', 'No milestones yet')}
              description={t(
                'tasks.overview.noMilestonesHint',
                'Add one on the Milestones tab to track progress toward a dated goal.',
              )}
            />
          ) : (
            <ul className="space-y-2.5">
              {milestones.map((milestone) => {
                const meta = MILESTONE_STATUS_META[milestone.status]
                return (
                  <li key={milestone.id} className="flex items-center gap-3">
                    <span className="w-40 shrink-0 truncate text-sm text-foreground">{milestone.name}</span>
                    <div className="flex-1">
                      <ProgressBar value={milestone.progress} />
                    </div>
                    <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
                      {t(meta.labelKey, meta.fallback)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
      </div>

      <aside className="space-y-4">
        <Section title={t('tasks.overview.owner', 'Owner')}>
          <div className="flex items-center gap-2">
            <UserAvatar name={project.owner?.name ?? null} />
            <span className="text-sm text-foreground">
              {project.owner?.name ?? t('tasks.common.unassigned', 'Unassigned')}
            </span>
          </div>
        </Section>

        <Section
          title={t('tasks.overview.members', 'Members ({count})', { count: project.members.length })}
        >
          {project.members.length === 0 ? (
            <EmptyState
              variant="subtle"
              title={t('tasks.overview.noMembers', 'No members yet')}
              description={t(
                'tasks.overview.noMembersHint',
                'Edit the project to add the people who work on it.',
              )}
            />
          ) : (
            <ul className="space-y-2">
              {project.members.map((member) => (
                <li key={member.id} className="flex items-center gap-2">
                  <UserAvatar name={member.name} size="xs" />
                  <span className="min-w-0 truncate text-sm text-foreground">{member.name}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </aside>
    </div>
  )
}
