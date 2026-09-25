'use client'

import * as React from 'react'
import { Users, Phone, Check, Mail, Calendar, StickyNote } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useScheduleConflicts } from '../../lib/calendar/useScheduleConflicts'
import { validatePhoneNumber } from '@open-mercato/shared/lib/phone'
import { apiCallOrThrow, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader, extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'
import { mapCrudServerErrorToFormErrors } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { CloseButton } from '@open-mercato/ui/primitives/close-button'
import { Dialog, DialogContent, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { FormFieldLabel } from '@open-mercato/ui/backend/forms/FormSection'
import { LABEL_CLASS } from '../calendar/editor/inputs'
import { DETAIL_DIALOG_BODY } from './dialogChrome'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { PhoneNumberField, SwitchableMarkdownInput } from '@open-mercato/ui/backend/inputs'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import {
  useScheduleFormState,
  FIELD_VISIBILITY,
  getFieldLabel,
  DateTimeFields,
  ParticipantsField,
  LocationField,
  FooterFields,
  LinkedEntitiesField,
} from './schedule'
import type { ActivityType, ScheduleActivityEditData } from './schedule'

const TYPE_TABS: Array<{ type: ActivityType; icon: React.ComponentType<{ className?: string }>; labelKey: string; fallback: string }> = [
  { type: 'meeting', icon: Users, labelKey: 'customers.schedule.types.meeting', fallback: 'Meeting' },
  { type: 'call', icon: Phone, labelKey: 'customers.schedule.types.call', fallback: 'Call' },
  { type: 'task', icon: Check, labelKey: 'customers.schedule.types.task', fallback: 'Task' },
  { type: 'email', icon: Mail, labelKey: 'customers.schedule.types.email', fallback: 'Email' },
  { type: 'note', icon: StickyNote, labelKey: 'customers.schedule.types.note', fallback: 'Note' },
]

type DialogChrome = { titleKey: string; titleFallback: string; subtitleKey: string; subtitleFallback: string; saveKey: string; saveFallback: string; saveIcon: React.ComponentType<{ className?: string }> }

const TYPE_CHROME: Record<ActivityType, DialogChrome> = {
  meeting: {
    titleKey: 'customers.schedule.meeting.title', titleFallback: 'New meeting',
    subtitleKey: 'customers.schedule.meeting.subtitle', subtitleFallback: 'Block time on the calendar with attendees',
    saveKey: 'customers.schedule.meeting.save', saveFallback: 'Save activity', saveIcon: Calendar,
  },
  call: {
    titleKey: 'customers.schedule.call.title', titleFallback: 'Log call',
    subtitleKey: 'customers.schedule.call.subtitle', subtitleFallback: 'Log a call you just had or schedule one',
    saveKey: 'customers.schedule.call.save', saveFallback: 'Log call', saveIcon: Phone,
  },
  task: {
    titleKey: 'customers.schedule.task.title', titleFallback: 'New task',
    subtitleKey: 'customers.schedule.task.subtitle', subtitleFallback: 'Capture something to follow up on',
    saveKey: 'customers.schedule.task.save', saveFallback: 'Save task', saveIcon: Check,
  },
  email: {
    titleKey: 'customers.schedule.email.title', titleFallback: 'Compose email',
    subtitleKey: 'customers.schedule.email.subtitle', subtitleFallback: 'Compose and send a tracked email',
    saveKey: 'customers.schedule.email.save', saveFallback: 'Send email', saveIcon: Mail,
  },
  note: {
    titleKey: 'customers.schedule.note.title', titleFallback: 'Add note',
    subtitleKey: 'customers.schedule.note.subtitle', subtitleFallback: 'Write down a note about this interaction',
    saveKey: 'customers.schedule.note.save', saveFallback: 'Save note', saveIcon: StickyNote,
  },
}

const CALL_DIRECTIONS: Array<{ key: 'outbound' | 'inbound'; labelKey: string; labelFallback: string; dot: string }> = [
  { key: 'outbound', labelKey: 'customers.schedule.call.direction.outbound', labelFallback: 'Outbound', dot: 'bg-status-info-icon' },
  { key: 'inbound', labelKey: 'customers.schedule.call.direction.inbound', labelFallback: 'Inbound', dot: 'bg-status-success-icon' },
]

const CALL_OUTCOMES: Array<{ key: string; labelKey: string; labelFallback: string; dot: string }> = [
  { key: 'connected', labelKey: 'customers.schedule.call.outcome.connected', labelFallback: 'Connected', dot: 'bg-status-success-icon' },
  { key: 'voicemail', labelKey: 'customers.schedule.call.outcome.voicemail', labelFallback: 'Voicemail', dot: 'bg-status-warning-icon' },
  { key: 'noanswer', labelKey: 'customers.schedule.call.outcome.noAnswer', labelFallback: 'No answer', dot: 'bg-muted-foreground' },
  { key: 'busy', labelKey: 'customers.schedule.call.outcome.busy', labelFallback: 'Busy', dot: 'bg-status-warning-icon' },
  { key: 'badnumber', labelKey: 'customers.schedule.call.outcome.badNumber', labelFallback: 'Bad number', dot: 'bg-status-error-icon' },
]

const TASK_PRIORITIES: Array<{ key: string; labelKey: string; labelFallback: string; dot: string }> = [
  { key: 'low', labelKey: 'customers.schedule.task.priority.low', labelFallback: 'Low', dot: 'bg-muted-foreground' },
  { key: 'medium', labelKey: 'customers.schedule.task.priority.medium', labelFallback: 'Medium', dot: 'bg-status-info-icon' },
  { key: 'high', labelKey: 'customers.schedule.task.priority.high', labelFallback: 'High', dot: 'bg-status-warning-icon' },
  { key: 'urgent', labelKey: 'customers.schedule.task.priority.urgent', labelFallback: 'Urgent', dot: 'bg-status-error-icon' },
]

interface ScheduleActivityDialogProps {
  open: boolean
  onClose: () => void
  entityId: string
  dealId?: string | null
  entityName?: string
  companyName?: string | null
  entityType: 'company' | 'person' | 'deal'
  onActivityCreated?: () => void
  /** When provided, dialog opens in edit mode with pre-filled data */
  editData?: ScheduleActivityEditData | null
  /** Default country ISO2 code for phone number input when value is empty/unparsed */
  defaultCountryIso2?: string
}

export function ScheduleActivityDialog({
  open,
  onClose,
  entityId,
  dealId = null,
  entityName,
  companyName,
  entityType,
  onActivityCreated,
  editData,
  defaultCountryIso2,
}: ScheduleActivityDialogProps) {
  const t = useT()
  const state = useScheduleFormState({ open, editData: editData ?? null })
  const visibleFields = FIELD_VISIBILITY[state.activityType]
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const isEditing = Boolean(editData?.id)
  const chrome = TYPE_CHROME[state.activityType]
  const SaveIcon = chrome.saveIcon
  const [callDirection, setCallDirection] = React.useState<'outbound' | 'inbound'>('outbound')
  const [callOutcome, setCallOutcome] = React.useState<string | null>(null)
  const [callPhoneNumber, setCallPhoneNumber] = React.useState('')
  const [callPhoneError, setCallPhoneError] = React.useState<string | null>(null)
  const [taskPriority, setTaskPriority] = React.useState<string>('medium')
  const [titleMissing, setTitleMissing] = React.useState(false)
  const callPhoneInvalidMessage = React.useMemo(
    () =>
      t(
        'customers.activities.errors.phoneInvalid',
        'Enter a valid phone number with country code (e.g. +1 212 555 1234)',
      ),
    [t],
  )
  const translateErrorMessage = React.useCallback(
    (message: string | undefined, fallback: string) => {
      const key = typeof message === 'string' ? message.trim() : ''
      return key ? t(key, key) : fallback
    },
    [t],
  )

  React.useEffect(() => {
    if (!open) return
    const raw = editData as (Record<string, unknown> & { customValues?: unknown; phoneNumber?: unknown }) | null | undefined
    const cv = (raw?.customValues && typeof raw.customValues === 'object' ? raw.customValues : null) as Record<string, unknown> | null
    setCallDirection(typeof cv?.callDirection === 'string' && cv.callDirection === 'inbound' ? 'inbound' : 'outbound')
    setCallOutcome(typeof cv?.callOutcome === 'string' ? cv.callOutcome : null)
    // Seed phone number from either top-level `phoneNumber` (newer write path)
    // or legacy `customValues.callPhoneNumber` so previously-saved calls still
    // round-trip on edit (#1808).
    const seededPhone =
      typeof raw?.phoneNumber === 'string' && raw.phoneNumber.trim().length > 0
        ? raw.phoneNumber
        : typeof cv?.callPhoneNumber === 'string'
          ? cv.callPhoneNumber
          : ''
    setCallPhoneNumber(seededPhone)
    setCallPhoneError(null)
    setTaskPriority(typeof cv?.taskPriority === 'string' ? cv.taskPriority : 'medium')
  }, [open, editData])

  // Reset per-type chip state when the user switches activity type in create mode.
  // In edit mode, the persisted customValues should win, so we skip the reset.
  React.useEffect(() => {
    if (!open || isEditing) return
    setCallDirection('outbound')
    setCallOutcome(null)
    setCallPhoneNumber('')
    setCallPhoneError(null)
    setTaskPriority('medium')
  }, [state.activityType, open, isEditing])

  const handleCallPhoneChange = React.useCallback((next: string | undefined) => {
    setCallPhoneNumber(next ?? '')
    setCallPhoneError(null)
  }, [])

  const formSnapshot = React.useMemo(() => JSON.stringify({
    activityType: state.activityType,
    title: state.title,
    date: state.date,
    startTime: state.startTime,
    duration: state.duration,
    allDay: state.allDay,
    description: state.description,
    location: state.location,
    reminderMinutes: state.reminderMinutes,
    visibility: state.visibility,
    participants: state.participants,
    linkedEntities: state.linkedEntities,
    recurrenceEnabled: state.recurrenceEnabled,
    recurrenceDays: state.recurrenceDays,
    recurrenceEndType: state.recurrenceEndType,
    recurrenceCount: state.recurrenceCount,
    recurrenceEndDate: state.recurrenceEndDate,
    guestPermissions: state.guestPermissions,
  }), [
    state.activityType, state.title, state.date, state.startTime, state.duration, state.allDay,
    state.description, state.location, state.reminderMinutes, state.visibility, state.participants,
    state.linkedEntities, state.recurrenceEnabled, state.recurrenceDays, state.recurrenceEndType,
    state.recurrenceCount, state.recurrenceEndDate, state.guestPermissions,
  ])
  const initialSnapshotRef = React.useRef<string | null>(null)
  const snapshotOpenKeyRef = React.useRef<string | null>(null)
  const snapshotSettleCountRef = React.useRef(0)
  const closeConfirmPendingRef = React.useRef(false)
  const openKey = open ? `${editData?.id ?? 'new'}` : null
  React.useEffect(() => {
    if (!open) {
      initialSnapshotRef.current = null
      snapshotOpenKeyRef.current = null
      snapshotSettleCountRef.current = 0
      return
    }
    if (snapshotOpenKeyRef.current !== openKey) {
      snapshotOpenKeyRef.current = openKey
      snapshotSettleCountRef.current = 0
      initialSnapshotRef.current = null
    }
    if (snapshotSettleCountRef.current < 2) {
      initialSnapshotRef.current = formSnapshot
      snapshotSettleCountRef.current += 1
    }
  }, [open, openKey, formSnapshot])

  const isDirty = React.useCallback(() => {
    if (initialSnapshotRef.current == null) return false
    return initialSnapshotRef.current !== formSnapshot
  }, [formSnapshot])

  const guardedClose = React.useCallback(async () => {
    if (closeConfirmPendingRef.current) return
    if (!isDirty()) {
      onClose()
      return
    }
    closeConfirmPendingRef.current = true
    try {
      const ok = await confirm({
        title: t('customers.schedule.discardConfirm.title', 'Discard unsaved changes?'),
        description: t(
          'customers.schedule.discardConfirm.description',
          'You have unsaved edits in this activity. Save them first or continue to discard them.',
        ),
        confirmText: t('customers.schedule.discardConfirm.confirm', 'Discard'),
        cancelText: t('customers.schedule.discardConfirm.cancel', 'Keep editing'),
        variant: 'destructive',
      })
      if (ok) onClose()
    } finally {
      closeConfirmPendingRef.current = false
    }
  }, [confirm, isDirty, onClose, t])

  const mutationContextId = React.useMemo(
    () => `customer-activity:${entityType}:${entityId}`,
    [entityId, entityType],
  )
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    entityType: 'company' | 'person' | 'deal'
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const mutationContext = React.useMemo(
    () => ({
      formId: mutationContextId,
      resourceKind:
        entityType === 'company'
          ? 'customers.company'
          : entityType === 'person'
            ? 'customers.person'
            : 'customers.deal',
      resourceId: entityId,
      entityType,
      retryLastMutation,
    }),
    [entityId, entityType, mutationContextId, retryLastMutation],
  )
  const runGuardedMutation = React.useCallback(
    async <T,>(operation: () => Promise<T>, mutationPayload: Record<string, unknown>) =>
      runMutation({
        operation,
        mutationPayload,
        context: mutationContext,
      }),
    [mutationContext, runMutation],
  )

  // Conflict detection -- the debounce, the query shape and the fail-open
  // behaviour live in the shared hook, so this dialog and the calendar's
  // meeting quick-add cannot drift apart on any of them.
  const { conflicts } = useScheduleConflicts({
    enabled: open && !state.allDay,
    date: state.date || null,
    startTime: state.startTime || null,
    durationMinutes: state.duration,
    excludeId: editData?.id ?? null,
  })

  const setConflict = state.setConflict
  React.useEffect(() => {
    if (conflicts.length === 0) {
      setConflict(null)
      return
    }
    const descriptions = conflicts
      .map((item) => `${item.startTime}–${item.endTime}: ${item.title ?? item.type}`)
      .join(', ')
    setConflict(
      t('customers.schedule.conflict.description', 'Overlaps with: {{items}}', { items: descriptions }),
    )
  }, [conflicts, setConflict, t])

  const trimmedDate = state.date.trim()
  const trimmedStartTime = state.startTime.trim()
  const trimmedCallPhone = callPhoneNumber.trim()
  const isDateMissing = !trimmedDate
  const isTimeMissing = !state.allDay && !trimmedStartTime
  const isSubmitDisabled =
    state.saving ||
    !state.title.trim() ||
    isDateMissing ||
    isTimeMissing

  const handleSave = React.useCallback(async () => {
    if (!state.title.trim()) {
      setTitleMissing(true)
      return
    }
    if (isDateMissing) {
      flash(t('customers.activities.errors.dateRequired', 'Date is required'), 'error')
      return
    }
    if (isTimeMissing) {
      flash(t('customers.activities.errors.timeRequired', 'Time is required'), 'error')
      return
    }
    let phoneNumberForPayload: string | undefined
    if (state.activityType === 'call' && trimmedCallPhone) {
      const phoneValidation = validatePhoneNumber(trimmedCallPhone)
      if (!phoneValidation.valid) {
        setCallPhoneError(callPhoneInvalidMessage)
        flash(callPhoneInvalidMessage, 'error')
        return
      }
      phoneNumberForPayload = phoneValidation.normalized ?? trimmedCallPhone
      setCallPhoneError(null)
      if (phoneNumberForPayload !== callPhoneNumber) {
        setCallPhoneNumber(phoneNumberForPayload)
      }
    }
    state.setSaving(true)
    try {
      const scheduledAt = state.allDay
        ? new Date(`${state.date}T00:00:00`).toISOString()
        : new Date(`${state.date}T${state.startTime}:00`).toISOString()

      const recurrenceRule = state.recurrenceEnabled
        ? buildRecurrenceRule(state.recurrenceDays, state.recurrenceEndType, state.recurrenceCount, state.recurrenceEndDate)
        : null

      const isSaveEdit = Boolean(editData?.id)
      const customValues: Record<string, unknown> = {}
      if (state.activityType === 'call') {
        customValues.callDirection = callDirection
        if (callOutcome) customValues.callOutcome = callOutcome
        if (phoneNumberForPayload) customValues.callPhoneNumber = phoneNumberForPayload
      }
      if (state.activityType === 'task') {
        customValues.taskPriority = taskPriority
      }
      const payload = {
        ...(isSaveEdit ? { id: editData!.id } : {}),
        entityId,
        dealId,
        interactionType: state.activityType,
        title: state.title.trim(),
        body: state.description.trim() || null,
        status: 'planned',
        date: trimmedDate,
        time: state.allDay ? '00:00' : trimmedStartTime,
        phoneNumber: state.activityType === 'call' ? phoneNumberForPayload : undefined,
        scheduledAt,
        durationMinutes: visibleFields.has('duration') && !state.allDay ? state.duration : null,
        location: visibleFields.has('location') ? (state.location.trim() || null) : null,
        allDay: visibleFields.has('allDay') ? state.allDay : null,
        recurrenceRule: visibleFields.has('recurrence') ? recurrenceRule : null,
        recurrenceEnd: visibleFields.has('recurrence') && state.recurrenceEndType === 'date' && state.recurrenceEndDate
          ? new Date(state.recurrenceEndDate).toISOString()
          : null,
        participants: visibleFields.has('participants') && state.participants.length > 0
          ? state.participants.map((p) => ({ userId: p.userId, name: p.name, email: p.email, status: p.status ?? 'pending' }))
          : null,
        guestPermissions: visibleFields.has('participants') && state.participants.length > 0 ? state.guestPermissions : null,
        linkedEntities: state.linkedEntities.length > 0
          ? state.linkedEntities.map((e) => ({ id: e.id, type: e.type, label: e.label }))
          : null,
        reminderMinutes: visibleFields.has('reminder') ? state.reminderMinutes : null,
        visibility: visibleFields.has('visibility') ? state.visibility : null,
        ...(Object.keys(customValues).length > 0 ? { customValues } : {}),
      }
      await runGuardedMutation(
        () => {
          const call = () =>
            apiCallOrThrow('/api/customers/interactions', {
              method: isSaveEdit ? 'PUT' : 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            })
          // Optimistic lock only applies to edits — a stale modal save against a
          // concurrently changed/deleted activity surfaces the conflict bar (#2055).
          return isSaveEdit
            ? withScopedApiRequestHeaders(buildOptimisticLockHeader(editData?.updatedAt), call)
            : call()
        },
        {
          operation: isSaveEdit ? 'updateActivity' : 'createActivity',
          interactionId: editData?.id ?? null,
          interactionType: state.activityType,
        },
      )
      flash(t('customers.schedule.saved', 'Activity scheduled'), 'success')
      onClose()
      // Delay data reload so the dialog can unmount cleanly and Radix restores body scroll
      requestAnimationFrame(() => { onActivityCreated?.() })
    } catch (err) {
      // An optimistic-lock 409 was already surfaced as the persistent conflict
      // bar by `runGuardedMutation` (useGuardedMutation → surfaceRecordConflict).
      // Do NOT additionally flash the raw `record_modified` code here — that
      // showed an untranslated toast on top of the localized bar (#2055 QA).
      if (extractOptimisticLockConflict(err)) {
        onClose()
        return
      }
      const { message, fieldErrors } = mapCrudServerErrorToFormErrors(err)
      const phoneFieldError = fieldErrors?.phoneNumber
      if (state.activityType === 'call' && phoneFieldError) {
        const translatedPhoneError = translateErrorMessage(phoneFieldError, callPhoneInvalidMessage)
        setCallPhoneError(translatedPhoneError)
        flash(translatedPhoneError, 'error')
        return
      }
      flash(
        translateErrorMessage(message, t('customers.schedule.error', 'Failed to schedule activity')),
        'error',
      )
    } finally {
      state.setSaving(false)
    }
  }, [callDirection, callOutcome, callPhoneInvalidMessage, callPhoneNumber, isDateMissing, isTimeMissing, state.activityType, state.allDay, state.date, state.description, dealId, state.duration, editData, entityId, state.guestPermissions, state.linkedEntities, state.location, onActivityCreated, onClose, state.participants, state.recurrenceCount, state.recurrenceDays, state.recurrenceEnabled, state.recurrenceEndDate, state.recurrenceEndType, state.reminderMinutes, runGuardedMutation, state.startTime, t, taskPriority, state.title, translateErrorMessage, trimmedCallPhone, trimmedDate, trimmedStartTime, state.visibility, visibleFields]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleKeyDown = useDialogKeyHandler({ onConfirm: handleSave })

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) void guardedClose() }}>
      <DialogContent
        disableBodyWrap
        className="flex flex-col overflow-hidden border-border p-0 shadow-xl sm:max-w-[760px] sm:rounded-xl [&>[data-dialog-close]]:hidden"
        onKeyDown={handleKeyDown}
        aria-describedby={undefined}
      >
        {ConfirmDialogElement}
        <VisuallyHidden>
          <DialogTitle>{isEditing ? t('customers.schedule.editTitle', 'Edit activity') : t(chrome.titleKey, chrome.titleFallback)}</DialogTitle>
        </VisuallyHidden>

        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold leading-tight tracking-tight text-foreground">
              {isEditing ? t('customers.schedule.editTitle', 'Edit activity') : t(chrome.titleKey, chrome.titleFallback)}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t(chrome.subtitleKey, chrome.subtitleFallback)}
            </p>
            {entityName ? (
              <p className="mt-0.5 text-xs text-muted-foreground/80">
                {t('customers.schedule.context', 'On timeline: {{name}}', { name: entityName })}
                {companyName ? ` · ${companyName}` : ''}
              </p>
            ) : null}
          </div>
          <CloseButton
            onClick={() => { void guardedClose() }}
            aria-label={t('customers.schedule.cancel', 'Cancel')}
          />
        </div>

        {/* A FIXED body, like the calendar event editor: each activity type
            shows a different set of fields, and a body that sized to them moved
            the footer every time the type changed. */}
        <div className={DETAIL_DIALOG_BODY} data-dialog-form="true">
        <div className="flex flex-col gap-6">

        {/* Conflict warning */}
        {state.conflict && (
          <Alert status="warning" className="rounded-lg">
            <AlertTitle>
              {t('customers.schedule.conflict.title', 'Calendar conflict')}
            </AlertTitle>
            <AlertDescription>{state.conflict}</AlertDescription>
          </Alert>
        )}

        {/* Type switcher — the calendar event editor's inset segmented control. */}
        <SegmentedControl
          tone="inset"
          className="max-w-full overflow-x-auto"
          aria-label={t('customers.schedule.typeSwitcher', 'Activity type')}
          value={state.activityType}
          onValueChange={(type) => state.setActivityType(type as ActivityType)}
        >
          {TYPE_TABS.map(({ type, icon: Icon, labelKey, fallback }) => (
            <SegmentedControlItem key={type} value={type} icon={<Icon className="size-4" />}>
              {t(labelKey, fallback)}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>

        {/* Title */}
        <div className="flex flex-col gap-2.5">
          <FormFieldLabel htmlFor="schedule-activity-title" className="mb-0" required>
            {getFieldLabel(state.activityType, 'title', t, 'customers.schedule.titleLabel', 'Title')}
          </FormFieldLabel>
          <input
            id="schedule-activity-title"
            type="text"
            aria-required="true"
            aria-invalid={titleMissing || undefined}
            aria-describedby="schedule-activity-title-error"
            value={state.title}
            onChange={(e) => {
              state.setTitle(e.target.value)
              if (e.target.value.trim()) setTitleMissing(false)
            }}
            placeholder={
              state.activityType === 'email'
                ? t('customers.schedule.subjectPlaceholder', 'Subject...')
                : t('customers.schedule.titlePlaceholder', 'Activity title...')
            }
            className={cn(
              'h-9 w-full rounded-lg border px-3 text-sm font-medium text-foreground outline-none focus-visible:shadow-focus',
              titleMissing && 'border-status-error-border',
            )}
            autoFocus
          />
          <p id="schedule-activity-title-error" role="alert" className="-mt-1.5 min-h-4 text-xs text-status-error-foreground">
            {titleMissing ? t('customers.calendar.editor.validation.titleRequired', 'Title is required') : ''}
          </p>
        </div>

        {/* Date/Time/Duration — placed before per-type chip rows so the call/task
            workflows match Figma 829:50 / 790:280 (date row first, then status chips). */}
        <DateTimeFields
          visible={visibleFields}
          activityType={state.activityType}
          date={state.date}
          setDate={state.setDate}
          startTime={state.startTime}
          setStartTime={state.setStartTime}
          duration={state.duration}
          setDuration={state.setDuration}
          allDay={state.allDay}
          setAllDay={state.setAllDay}
          recurrenceEnabled={state.recurrenceEnabled}
          setRecurrenceEnabled={state.setRecurrenceEnabled}
          recurrenceDays={state.recurrenceDays}
          toggleRecurrenceDay={state.toggleRecurrenceDay}
          recurrenceEndType={state.recurrenceEndType}
          setRecurrenceEndType={state.setRecurrenceEndType}
          recurrenceCount={state.recurrenceCount}
          setRecurrenceCount={state.setRecurrenceCount}
          recurrenceEndDate={state.recurrenceEndDate}
          setRecurrenceEndDate={state.setRecurrenceEndDate}
        />

        {/* Call: Direction + Outcome chips */}
        {state.activityType === 'call' && (
          <div className="flex flex-col gap-6">
            <div>
              <label className={LABEL_CLASS}>
                {t('customers.schedule.call.directionLabel', 'Direction')}
              </label>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {CALL_DIRECTIONS.map((opt) => {
                  const isActive = callDirection === opt.key
                  return (
                    <Button
                      key={opt.key}
                      type="button"
                      variant={isActive ? 'default' : 'soft'}
                      aria-pressed={isActive}
                      onClick={() => setCallDirection(opt.key)}
                    >
                      <span className={cn('inline-block size-1.5 rounded-full', opt.dot)} aria-hidden />
                      {t(opt.labelKey, opt.labelFallback)}
                    </Button>
                  )
                })}
              </div>
            </div>
            <div>
              <label className={LABEL_CLASS}>
                {t('customers.schedule.call.outcomeLabel', 'Outcome')}
              </label>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {CALL_OUTCOMES.map((opt) => {
                  const isActive = callOutcome === opt.key
                  return (
                    <Button
                      key={opt.key}
                      type="button"
                      variant={isActive ? 'default' : 'soft'}
                      aria-pressed={isActive}
                      onClick={() => setCallOutcome(isActive ? null : opt.key)}
                    >
                      <span className={cn('inline-block size-1.5 rounded-full', opt.dot)} aria-hidden />
                      {t(opt.labelKey, opt.labelFallback)}
                    </Button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Task: Priority chips */}
        {state.activityType === 'task' && (
          <div>
            <label className={LABEL_CLASS}>
              {t('customers.schedule.task.priorityLabel', 'Priority')}
            </label>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {TASK_PRIORITIES.map((opt) => {
                const isActive = taskPriority === opt.key
                return (
                  <Button
                    key={opt.key}
                    type="button"
                    variant={isActive ? 'default' : 'soft'}
                    aria-pressed={isActive}
                    onClick={() => setTaskPriority(opt.key)}
                  >
                    <span className={cn('inline-block size-1.5 rounded-full', opt.dot)} aria-hidden />
                    {t(opt.labelKey, opt.labelFallback)}
                  </Button>
                )
              })}
            </div>
          </div>
        )}

        {/* Participants */}
        <ParticipantsField
          visible={visibleFields}
          activityType={state.activityType}
          participants={state.participants}
          setParticipants={state.setParticipants}
          removeParticipant={state.removeParticipant}
          guestPermissions={state.guestPermissions}
          setGuestPermissions={state.setGuestPermissions}
        />

        {/* Location (or phone number for calls) */}
        {state.activityType === 'call' ? (
          <div className="flex flex-col gap-2.5">
            <label htmlFor="schedule-call-phone" className={LABEL_CLASS}>
              {t('customers.schedule.call.phoneLabel', 'Phone number')}
            </label>
            <PhoneNumberField
              id="schedule-call-phone"
              value={callPhoneNumber}
              onValueChange={handleCallPhoneChange}
              placeholder={t('customers.schedule.call.phonePlaceholder', '+1 555 000 0000')}
              externalError={callPhoneError}
              invalidLabel={callPhoneInvalidMessage}
              minDigits={7}
              defaultCountryIso2={defaultCountryIso2}
              tone="well"
            />
          </div>
        ) : (
          <LocationField
            visible={visibleFields}
            activityType={state.activityType}
            location={state.location}
            setLocation={state.setLocation}
          />
        )}

        {/* Linked Entities */}
        <LinkedEntitiesField
          visible={visibleFields}
          activityType={state.activityType}
          linkedEntities={state.linkedEntities}
          setLinkedEntities={state.setLinkedEntities}
        />

        {/* Description */}
        <div>
          <label className={LABEL_CLASS}>
            {getFieldLabel(state.activityType, 'description', t, 'customers.schedule.description', 'Description')}
          </label>
          <div className="mt-2.5">
            <SwitchableMarkdownInput
              value={state.description}
              onChange={state.setDescription}
              isMarkdownEnabled={state.markdownEnabled}
              height={120}
              placeholder={t('customers.schedule.descriptionPlaceholder', 'Add details...')}
            />
          </div>
        </div>

        {/* Reminder + Visibility */}
        <FooterFields
          visible={visibleFields}
          activityType={state.activityType}
          reminderMinutes={state.reminderMinutes}
          setReminderMinutes={state.setReminderMinutes}
          visibility={state.visibility}
          setVisibility={state.setVisibility}
        />

        </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2.5 px-5 pt-1.5 pb-4 sm:px-6">
          <Button type="button" variant="soft" onClick={() => { void guardedClose() }}>
            {t('customers.schedule.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={handleSave} disabled={isSubmitDisabled}>
            <SaveIcon className="size-4" />
            {state.saving
              ? t('customers.schedule.saving', 'Saving...')
              : isEditing
                ? t('customers.schedule.update', 'Update activity')
                : t(chrome.saveKey, chrome.saveFallback)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export type { ScheduleActivityEditData }

function buildRecurrenceRule(
  days: boolean[],
  endType: 'never' | 'count' | 'date',
  count: number,
  endDate: string,
): string {
  const dayNames = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
  const selectedDays = days.map((active, i) => (active ? dayNames[i] : null)).filter(Boolean)
  let rule = `FREQ=WEEKLY;BYDAY=${selectedDays.join(',')}`
  if (endType === 'count') rule += `;COUNT=${count}`
  if (endType === 'date' && endDate) rule += `;UNTIL=${endDate.replace(/-/g, '')}T235959Z`
  return rule
}
