'use client'

import * as React from 'react'
import { ExternalLink, MapPin } from 'lucide-react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InteractionSummary } from './types'
import { ActivityHistoryRow, ActivityMeta, activityTypeLabel } from './ActivityHistoryParts'
import { EmailCardActions, type EmailCardWidgetData } from './EmailCardActions'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customers')

type GuardedMutationRunner = <T,>(
  operation: () => Promise<T>,
  mutationPayload?: Record<string, unknown>,
) => Promise<T>

type ActivityCardProps = {
  activity: InteractionSummary
  onOpen?: (activity: InteractionSummary) => void
  /** Called after a successful mark-done so the parent can refresh the timeline. */
  onChanged?: () => void
  /**
   * Optional guarded-mutation runner. When provided, mutations route through the parent's
   * `useGuardedMutation` so retry-last-mutation and the global injection contract apply.
   * When omitted, mutations run directly via `apiCallOrThrow` (e.g. read-only contexts
   * or jest unit tests that don't supply a guarded runner).
   */
  runMutation?: GuardedMutationRunner
  /** The first row of a run draws no rule above it. */
  first?: boolean
}

function trimSnippet(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  if (!normalized) return null
  if (normalized.length <= 200) return normalized
  return `${normalized.slice(0, 197)}...`
}

/**
 * Build the `EmailCardWidgetData` for the email-card-actions injection spot.
 * Email metadata (rfcMessageId, addresses, threading headers, current visibility,
 * and the author flag) is populated server-side by `interactionEmailCardEnricher`
 * and surfaced via the `_integrations.email` passthrough; missing values fall
 * back to null.
 */
function buildEmailCardWidgetData(activity: InteractionSummary): EmailCardWidgetData {
  const integrations = activity._integrations as Record<string, unknown> | undefined
  const emailMeta = (integrations?.email ?? {}) as Record<string, unknown>
  return {
    interactionId: activity.id,
    // The MessageChannelLink UUID stored on the interaction row.
    externalMessageId:
      typeof emailMeta.externalMessageId === 'string' ? emailMeta.externalMessageId : null,
    // RFC2822 Message-ID (e.g. "<abc@mail.gmail.com>") for In-Reply-To / References headers.
    rfcMessageId:
      typeof emailMeta.rfcMessageId === 'string' ? emailMeta.rfcMessageId : null,
    // entityId is the CustomerEntity id — on a person detail page this IS the personId.
    personId: activity.entityId ?? null,
    fromAddress:
      typeof emailMeta.fromAddress === 'string' ? emailMeta.fromAddress : null,
    toAddresses: Array.isArray(emailMeta.toAddresses) ? (emailMeta.toAddresses as string[]) : null,
    ccAddresses: Array.isArray(emailMeta.ccAddresses) ? (emailMeta.ccAddresses as string[]) : null,
    subject: activity.title ?? null,
    inReplyTo:
      typeof emailMeta.inReplyTo === 'string' ? emailMeta.inReplyTo : null,
    references: Array.isArray(emailMeta.references) ? (emailMeta.references as string[]) : null,
    currentVisibility:
      emailMeta.currentVisibility === 'private' || emailMeta.currentVisibility === 'shared'
        ? emailMeta.currentVisibility
        : null,
    isAuthor: typeof emailMeta.isAuthor === 'boolean' ? emailMeta.isAuthor : null,
  }
}

export function ActivityCard({ activity, onOpen, onChanged, runMutation, first = false }: ActivityCardProps) {
  const t = useT()
  const title = activity.title?.trim() || activityTypeLabel(activity.interactionType, t)
  const snippet = trimSnippet(activity.body)
  const showExternalLink = Boolean(activity._integrations && Object.keys(activity._integrations).length > 0)
  const [markingDone, setMarkingDone] = React.useState(false)

  const handleMarkDone = React.useCallback(async () => {
    if (markingDone) return
    setMarkingDone(true)
    try {
      const operation = () =>
        apiCallOrThrow('/api/customers/interactions/complete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: activity.id, occurredAt: new Date().toISOString() }),
        })
      if (runMutation) {
        await runMutation(operation, {
          id: activity.id,
          status: 'done',
          operation: 'completeActivity',
        })
      } else {
        await operation()
      }
      flash(t('customers.activities.actions.markDoneSuccess', 'Activity marked done'), 'success')
      onChanged?.()
    } catch (err) {
      logger.warn('Mark done failed', { component: 'ActivityCard', activityId: activity.id, err })
      flash(t('customers.activities.actions.markDoneError', 'Could not mark activity as done'), 'error')
    } finally {
      setMarkingDone(false)
    }
  }, [activity.id, markingDone, onChanged, runMutation, t])

  return (
    <ActivityHistoryRow
      activity={activity}
      first={first}
      title={title}
      titleAdornment={showExternalLink ? <ExternalLink aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /> : null}
      body={snippet}
      details={(
        <>
          {activity.location ? (
            <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{activity.location}</span>
            </p>
          ) : null}
          {activity.interactionType === 'email' ? (
            <div
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              role="presentation"
            >
              <EmailCardActions data={buildEmailCardWidgetData(activity)} />
            </div>
          ) : null}
        </>
      )}
      meta={<ActivityMeta activity={activity} />}
      onOpen={onOpen}
      onMarkDone={() => { void handleMarkDone() }}
      markingDone={markingDone}
    />
  )
}

export default ActivityCard
