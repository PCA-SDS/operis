"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import type { EditorDateLabel } from '../../../lib/calendar/editorPayload'
import { multiDayEventSpan } from '../../../lib/calendar/labels'
import { DateControl, LABEL_CLASS, TimeControl } from './inputs'

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
    /* `gap-6` matches the column that holds this section, so Starts and Ends
       are separated like any other pair of fields. At the section's own
       `gap-2.5` they sat 14px tighter than every other row, which reads as the
       two date rows being a different kind of thing from the fields above and
       below them. */
    <div className="flex w-full flex-col gap-6">
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
        //
        // The shared `SwitchField`, as a switch with a label is everywhere else:
        // its label is set like the field labels beside it, where a smaller grey
        // one read as a footnote, and clicking it flips the switch. It is 20px
        // tall, the label line's own height, so the row does not grow.
        trailing={hasAllDay ? (
          <SwitchField
            label={allDayLabel}
            checked={allDay}
            onCheckedChange={onAllDayChange}
            containerClassName="shrink-0 gap-2"
          />
        ) : undefined}
        onDateChange={onDateChange}
        onTimeChange={onStartTimeChange}
      />
      {hasEnd ? (
        // The error rides with the row it describes: at the section's gap it
        // would sit a full field-gap below and read as its own field.
        <div className="flex w-full flex-col gap-1.5">
          <DateTimeRow
            label={t('customers.calendar.editor.dates.ends', 'Ends')}
            date={endDate}
            time={endTime}
            showTime={showTime}
            locale={locale}
            onDateChange={onEndDateChange}
            onTimeChange={onEndTimeChange}
          />
          {endsError ? <p className="text-xs text-status-error-text">{endsError}</p> : null}
        </div>
      ) : null}
      {!hasEnd && endsError ? (
        <p className="text-xs text-status-error-text">{endsError}</p>
      ) : null}
      {multiDaySpan > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('customers.calendar.editor.multiDayHint', 'Multi-day event · {count} days', { count: multiDaySpan })}
        </p>
      ) : null}
    </div>
  )
}
