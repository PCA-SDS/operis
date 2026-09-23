"use client"

import * as React from 'react'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@open-mercato/ui/primitives/segmented-control'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useScheduleConflicts } from '../../lib/calendar/useScheduleConflicts'
import { RelatedToField } from './editor/RelatedToField'
import type { EditorRelatedTo } from '../../lib/calendar/editorPayload'
import type { DealOption } from './editor/lookups'

/**
 * Quick-create a meeting from a grid cell.
 *
 * The slim counterpart to `CalendarEventEditor`, the same way `QuickAddComposer`
 * is the slim counterpart to `TaskPanel` in the tasks module. The full editor
 * owns its own `<Dialog>` and cannot nest inside this one, and the fields a
 * grid click needs — when, how long, who with, where — are a small subset of
 * what it asks for. Anything beyond that is edited afterwards in the editor.
 *
 * It writes through the SAME endpoint and the same payload shape the editor
 * uses (`POST /api/customers/interactions`), so there is one server contract
 * behind both paths rather than a second way to create a meeting.
 */

const DEFAULT_DURATION_MINUTES = 60
const TITLE_MAX_LENGTH = 200

/* Conflicts are reported against meetings alone, and the SERVER does that
   narrowing. A call or an email at the same hour is a different kind of
   commitment, and a task is a deadline with no duration at all — counting
   those would make the warning fire constantly and so mean nothing. */
const CONFLICT_TYPES = ['meeting'] as const

type LocationMode = 'offline' | 'online'

function toMinutes(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

function addMinutes(time: string, delta: number): string {
  const base = toMinutes(time) ?? 0
  const total = ((base + delta) % 1440 + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function CalendarMeetingQuickAdd({
  day,
  startTime,
  onCancel,
  onCreated,
}: {
  /** The clicked day, `YYYY-MM-DD`. */
  day: string
  /** The clicked slot, `HH:MM`. */
  startTime: string
  onCancel: () => void
  onCreated: () => void
}) {
  const t = useT()
  const [title, setTitle] = React.useState('')
  const [start, setStart] = React.useState(startTime)
  const [end, setEnd] = React.useState(() => addMinutes(startTime, DEFAULT_DURATION_MINUTES))
  const [relatedTo, setRelatedTo] = React.useState<EditorRelatedTo | null>(null)
  const [deal, setDeal] = React.useState<DealOption | null>(null)
  const [locationMode, setLocationMode] = React.useState<LocationMode>('offline')
  const [address, setAddress] = React.useState('')
  const [link, setLink] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const startMinutes = toMinutes(start)
  const endMinutes = toMinutes(end)
  const rangeIsValid = startMinutes !== null && endMinutes !== null && endMinutes > startMinutes

  /* Conflicts are a WARNING, never a block: double-booking is sometimes
     deliberate, and a calendar that refuses to record what is actually
     happening stops being a record. The user is told and decides.

     The check runs against the DATABASE, not against the items the grid has
     loaded. A calendar only ever holds one visible range, so a client-side
     comparison answers "no conflicts" for a clash the user simply cannot see
     from here — which is worse than not answering at all. */
  const { conflicts } = useScheduleConflicts({
    enabled: rangeIsValid,
    date: day,
    startTime: start,
    durationMinutes: rangeIsValid ? (endMinutes as number) - (startMinutes as number) : null,
    types: CONFLICT_TYPES,
  })

  /* `entityId` is a required uuid on `interactionCreateSchema`: an interaction
     is a record ABOUT a customer, so there is no such thing as an unattached
     one. Sending null returns "Invalid input" from the server, so the button
     stays disabled until a customer is chosen rather than letting the user
     submit into a rejection. */
  const canSubmit = title.trim().length > 0 && rangeIsValid && !!relatedTo && !saving

  const submit = React.useCallback(async () => {
    if (!canSubmit || !relatedTo || startMinutes === null || endMinutes === null) return
    setSaving(true)
    setError(null)
    try {
      // `location` is one string on the wire; `detectLocationKind` reads it
      // back as 'url' when it starts with http/www and 'venue' otherwise. That
      // is why online/offline needs no extra field and no migration — the mode
      // only decides which box the user types into.
      const location = locationMode === 'online' ? link.trim() : address.trim()
      await apiCallOrThrow('/api/customers/interactions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entityId: relatedTo.id,
          dealId: deal?.id ?? null,
          interactionType: 'meeting',
          title: title.trim().slice(0, TITLE_MAX_LENGTH),
          body: null,
          status: 'planned',
          date: day,
          time: start,
          scheduledAt: new Date(`${day}T${start}:00`).toISOString(),
          durationMinutes: endMinutes - startMinutes,
          allDay: false,
          location: location || null,
          recurrenceRule: null,
          recurrenceEnd: null,
          participants: null,
        }),
      })
      flash(t('customers.calendar.meeting.saved', 'Meeting added'), 'success')
      onCreated()
    } catch (err) {
      // Kept inline rather than only flashed: the dialog stays open on failure,
      // so the reason belongs where the user is still looking.
      setError(
        err instanceof Error && err.message
          ? err.message
          : t('customers.calendar.meeting.failed', 'Could not add the meeting.'),
      )
    } finally {
      setSaving(false)
    }
  }, [canSubmit, relatedTo, deal, startMinutes, endMinutes, locationMode, link, address, day, start, title, t, onCreated])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void submit()
      }
    },
    [submit],
  )

  /* One notice region, always holding its space, showing at most one message.
     Three things can speak here — an impossible range, a failed save, a clash —
     and letting each mount its own block grew the dialog and shoved the buttons
     down the moment any of them had something to say. Reserving the room once
     means the layout is identical whether it is empty or not, and problems are
     read in one predictable place instead of three. */
  const notice: { status: 'error' | 'warning'; text: string } | null = !rangeIsValid
    ? {
        status: 'error',
        text: t('customers.calendar.meeting.endBeforeStart', 'End must be after start.'),
      }
    : error
      ? { status: 'error', text: error }
      : conflicts.length > 0
        ? {
            status: 'warning',
            text: `${t('customers.calendar.meeting.conflictWarning', 'Overlaps {count} meeting(s):', {
              count: conflicts.length,
            })} ${conflicts.map((item) => item.title ?? item.type).join(', ')}`,
          }
        : null

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={handleKeyDown}>
      {/* `space-y-6` (24px) against FormField's own 6px label-to-input gap. At
          the previous 16px the two readings were close enough that the Title
          field looked like it belonged to the Starts/Ends row below it; a 4:1
          ratio makes each label bind to its own control. It also puts the
          slack that was sitting above the footer to use. */}
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto">
        <FormField label={t('customers.calendar.meeting.title', 'Title')} required>
          <Input
            autoFocus
            value={title}
            maxLength={TITLE_MAX_LENGTH}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('customers.calendar.meeting.titlePlaceholder', 'Weekly sync')}
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label={t('customers.calendar.meeting.start', 'Starts')}>
            <Input
              type="time"
              value={start}
              onChange={(event) => {
                const next = event.target.value
                setStart(next)
                // Keep the end after the start rather than letting the user
                // build an impossible range and discover it at submit.
                const nextStart = toMinutes(next)
                const currentEnd = toMinutes(end)
                if (nextStart !== null && currentEnd !== null && currentEnd <= nextStart) {
                  setEnd(addMinutes(next, DEFAULT_DURATION_MINUTES))
                }
              }}
            />
          </FormField>
          <FormField label={t('customers.calendar.meeting.end', 'Ends')}>
            <Input type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
          </FormField>
        </div>

        <FormField label={t('customers.calendar.editor.relatedTo', 'Related to')} required>
          <RelatedToField
            // This sits in a FormField beside Inputs, not in the calendar
            // editor, so it wears the DS input chrome rather than the editor's
            // filled control.
            variant="form"
            label={t('customers.calendar.editor.relatedTo', 'Related to')}
            value={relatedTo}
            deal={deal}
            onChange={setRelatedTo}
            onDealChange={setDeal}
          />
        </FormField>

        <FormField label={t('customers.calendar.meeting.location', 'Location')}>
          <div className="space-y-2">
            <SegmentedControl
              fullWidth
              value={locationMode}
              onValueChange={(value) => setLocationMode(value as LocationMode)}
              aria-label={t('customers.calendar.meeting.location', 'Location')}
            >
              <SegmentedControlItem value="offline">
                {t('customers.calendar.meeting.offline', 'In person')}
              </SegmentedControlItem>
              <SegmentedControlItem value="online">
                {t('customers.calendar.meeting.online', 'Online')}
              </SegmentedControlItem>
            </SegmentedControl>
            {/* Both inputs stay mounted so switching back and forth neither
                discards what was typed in the other one nor changes the height
                of this row. */}
            <div className={locationMode === 'offline' ? undefined : 'hidden'}>
              <Input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder={t('customers.calendar.meeting.addressPlaceholder', 'Meeting room, address')}
                aria-label={t('customers.calendar.meeting.address', 'Address')}
              />
            </div>
            <div className={locationMode === 'online' ? undefined : 'hidden'}>
              <Input
                type="url"
                value={link}
                onChange={(event) => setLink(event.target.value)}
                placeholder="https://"
                aria-label={t('customers.calendar.meeting.link', 'Meeting link')}
              />
            </div>
          </div>
        </FormField>
      </div>

      <div className="h-12 shrink-0 overflow-y-auto pt-1.5" aria-live="polite">
        {notice ? (
          <Alert status={notice.status} style="light">
            {notice.text}
          </Alert>
        ) : null}
      </div>

      {/* A FIXED height, shared with the task composer's footer. A minimum was
          not enough: the task row also holds a project picker, and a row that
          sizes to its tallest child centres a 32px button differently than a
          row of buttons alone, so the divider matched but the buttons still
          stepped 2px on every toggle. Pinning the box makes both the rule and
          the buttons land on the same pixel in either mode. */}
      <div className="flex h-14 shrink-0 items-center justify-end gap-2">
        <Button type="button" variant="soft" onClick={onCancel}>
          {t('customers.calendar.meeting.cancel', 'Cancel')}
        </Button>
        <Button type="button" onClick={() => void submit()} disabled={!canSubmit}>
          {t('customers.calendar.meeting.submit', 'Add meeting')}
        </Button>
      </div>
    </div>
  )
}
