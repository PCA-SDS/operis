"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { EditorDateLabel } from '../../../lib/calendar/editorPayload'
import { multiDayEventSpan } from '../../../lib/calendar/labels'
import { AllDayToggle, DateControl, LABEL_CLASS, TimeControl } from './inputs'

const DATE_LABEL_TEXT: Record<EditorDateLabel, { key: string; fallback: string }> = {
  starts: { key: 'customers.calendar.editor.dates.starts', fallback: 'Starts' },
  when: { key: 'customers.calendar.editor.dates.when', fallback: 'When' },
  sent: { key: 'customers.calendar.editor.dates.sent', fallback: 'Sent' },
  logged: { key: 'customers.calendar.editor.dates.logged', fallback: 'Logged' },
  due: { key: 'customers.calendar.editor.dates.due', fallback: 'Due' },
}

function DateTimeRow({
  label,
  date,
  time,
  showTime,
  locale,
  trailing,
  onDateChange,
  onTimeChange,
}: {
  label: string
  date: string
  time: string
  showTime: boolean
  locale: string
  /** Sits on the label line, opposite the label. */
  trailing?: React.ReactNode
  onDateChange(next: string): void
  onTimeChange(next: string): void
}) {
  return (
    // Same label geometry as `Field`: a label line with `gap-2.5` beneath it.
    // The rows in the other column are built that way, and the two columns only
    // line up while both spend the same height above their first control.
    <div className="flex w-full flex-col gap-2.5">
      <div className="flex w-full items-center justify-between gap-2">
        <span className={LABEL_CLASS}>{label}</span>
        {trailing}
      </div>
      <div className="flex w-full items-end gap-2.5">
        <div className="flex min-w-0 flex-1 flex-col">
          <DateControl value={date} onChange={onDateChange} ariaLabel={label} locale={locale} />
        </div>
        {showTime ? <TimeControl value={time} onChange={onTimeChange} ariaLabel={label} /> : null}
      </div>
    </div>
  )
}

export function ScheduleSection({
  dateLabel,
  hasAllDay,
  hasEnd,
  allDay,
  date,
  startTime,
  endDate,
  endTime,
  locale,
  endsError,
  onAllDayChange,
  onDateChange,
  onStartTimeChange,
  onEndDateChange,
  onEndTimeChange,
}: {
  dateLabel: EditorDateLabel
  hasAllDay: boolean
  hasEnd: boolean
  allDay: boolean
  date: string
  startTime: string
  endDate: string
  endTime: string
  locale: string
  endsError?: string | null
  onAllDayChange(next: boolean): void
  onDateChange(next: string): void
  onStartTimeChange(next: string): void
  onEndDateChange(next: string): void
  onEndTimeChange(next: string): void
}) {
  const t = useT()
  const showTime = !(hasAllDay && allDay)
  const multiDaySpan = hasEnd && !endsError ? multiDayEventSpan(date, endDate) : 0
  const allDayLabel = t('customers.calendar.editor.allDay', 'All day')
  return (
    <div className="flex w-full flex-col gap-2.5">
      <DateTimeRow
        label={t(DATE_LABEL_TEXT[dateLabel].key, DATE_LABEL_TEXT[dateLabel].fallback)}
        date={date}
        time={startTime}
        showTime={showTime}
        locale={locale}
        // All-day rides the first date row's label line instead of taking a row
        // of its own. As its own row it pushed every field in this column one
        // row down, so the left column stopped lining up with the right — and
        // it belongs here anyway: it is the switch that removes the time
        // controls from these very rows.
        trailing={hasAllDay ? (
          // `-my-1` keeps the 24px switch from growing the 16px label line —
          // without it this column's first control sits 4px lower than the
          // other's, which is the misalignment the toggle used to cause as a
          // row of its own.
          <span className="-my-1 flex shrink-0 items-center gap-2">
            <span className="text-xs font-medium normal-case tracking-normal text-muted-foreground">
              {allDayLabel}
            </span>
            <AllDayToggle checked={allDay} onCheckedChange={onAllDayChange} label={allDayLabel} />
          </span>
        ) : undefined}
        onDateChange={onDateChange}
        onTimeChange={onStartTimeChange}
      />
      {hasEnd ? (
        <DateTimeRow
          label={t('customers.calendar.editor.dates.ends', 'Ends')}
          date={endDate}
          time={endTime}
          showTime={showTime}
          locale={locale}
          onDateChange={onEndDateChange}
          onTimeChange={onEndTimeChange}
        />
      ) : null}
      {endsError ? <p className="text-xs text-status-error-text">{endsError}</p> : null}
      {multiDaySpan > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('customers.calendar.editor.multiDayHint', 'Multi-day event · {count} days', { count: multiDaySpan })}
        </p>
      ) : null}
    </div>
  )
}
