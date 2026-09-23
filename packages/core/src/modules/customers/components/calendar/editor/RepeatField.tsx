"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@open-mercato/ui/primitives/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import type { EditorRepeatEndType, EditorRepeatFreq } from '../../../lib/calendar/editorPayload'
import { DateControl, LABEL_CLASS } from './inputs'

/** Matches the `max` on the input and the validator's own ceiling. */
const MAX_REPEAT_COUNT = 365

const DAY_LABEL_KEYS = [
  { letterKey: 'customers.calendar.editor.repeat.days.mon', letterFallback: 'M', ariaKey: 'customers.calendar.day.mon', ariaFallback: 'MON' },
  { letterKey: 'customers.calendar.editor.repeat.days.tue', letterFallback: 'T', ariaKey: 'customers.calendar.day.tue', ariaFallback: 'TUE' },
  { letterKey: 'customers.calendar.editor.repeat.days.wed', letterFallback: 'W', ariaKey: 'customers.calendar.day.wed', ariaFallback: 'WED' },
  { letterKey: 'customers.calendar.editor.repeat.days.thu', letterFallback: 'T', ariaKey: 'customers.calendar.day.thu', ariaFallback: 'THU' },
  { letterKey: 'customers.calendar.editor.repeat.days.fri', letterFallback: 'F', ariaKey: 'customers.calendar.day.fri', ariaFallback: 'FRI' },
  { letterKey: 'customers.calendar.editor.repeat.days.sat', letterFallback: 'S', ariaKey: 'customers.calendar.day.sat', ariaFallback: 'SAT' },
  { letterKey: 'customers.calendar.editor.repeat.days.sun', letterFallback: 'S', ariaKey: 'customers.calendar.day.sun', ariaFallback: 'SUN' },
]

export function RepeatField({
  freq,
  days,
  endType,
  count,
  untilDate,
  locale,
  onFreqChange,
  onToggleDay,
  onEndTypeChange,
  onCountChange,
  onUntilDateChange,
}: {
  freq: EditorRepeatFreq
  days: boolean[]
  endType: EditorRepeatEndType
  count: number
  untilDate: string
  locale: string
  onFreqChange(next: EditorRepeatFreq): void
  onToggleDay(index: number): void
  onEndTypeChange(next: EditorRepeatEndType): void
  onCountChange(next: number): void
  onUntilDateChange(next: string): void
}) {
  const t = useT()
  const freqLabel = t('customers.calendar.editor.repeat.label', 'Repeat')
  /* The counter's raw text, so the box can be empty while it is being retyped.
     It follows `count` whenever the value changes from outside (switching end
     type, loading an existing event). */
  const [countText, setCountText] = React.useState(() => String(count))
  React.useEffect(() => { setCountText(String(count)) }, [count])
  return (
    <div className="flex w-full flex-col gap-2.5">
      <span className={LABEL_CLASS}>{freqLabel}</span>
      <Select
        value={freq}
        onValueChange={(value) => onFreqChange(value as EditorRepeatFreq)}
      >
        <SelectTrigger aria-label={freqLabel}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t('customers.calendar.editor.repeat.freq.none', 'Does not repeat')}</SelectItem>
          <SelectItem value="daily">{t('customers.calendar.editor.repeat.freq.daily', 'Daily')}</SelectItem>
          <SelectItem value="weekly">{t('customers.calendar.editor.repeat.freq.weekly', 'Weekly')}</SelectItem>
        </SelectContent>
      </Select>
      {freq === 'weekly' ? (
        <div className="flex items-start gap-1.5">
          {DAY_LABEL_KEYS.map((day, index) => {
            const isActive = Boolean(days[index])
            return (
              <Button
                key={day.ariaKey}
                type="button"
                variant={isActive ? 'default' : 'outline'}
                aria-pressed={isActive}
                aria-label={t(day.ariaKey, day.ariaFallback)}
                onClick={() => onToggleDay(index)}
                className={cn(
                  'size-9 px-0 text-xs font-medium',
                  !isActive && 'text-muted-foreground',
                )}
              >
                {t(day.letterKey, day.letterFallback)}
              </Button>
            )
          })}
        </div>
      ) : null}
      {/* No wrap below: the picker and the counter belong BESIDE the switcher
          they qualify. Wrapping dropped them onto their own line, where they
          read as another field rather than as the switcher's argument. The
          controls shrink instead. */}
      {freq !== 'none' ? (
        <div className="flex items-center gap-2">
          <span className={cn(LABEL_CLASS, 'shrink-0')}>{t('customers.calendar.editor.repeat.ends', 'Ends')}</span>
          <SegmentedControl
            // `inset` like the editor's type switcher: this sits inside a
            // filled form, so the rail takes the field fill and the selected
            // pill is the white shape lifting out of it. The chrome default
            // (white rail, navy pill) is for toolbars, not form rows.
            tone="inset"
            aria-label={t('customers.calendar.editor.repeat.ends', 'Ends')}
            className="shrink-0"
            value={endType}
            onValueChange={(value) => onEndTypeChange(value as EditorRepeatEndType)}
          >
            <SegmentedControlItem value="never">
              {t('customers.calendar.editor.repeat.never', 'Never')}
            </SegmentedControlItem>
            <SegmentedControlItem value="date">
              {t('customers.calendar.editor.repeat.onDate', 'On Date')}
            </SegmentedControlItem>
            <SegmentedControlItem value="count">
              {t('customers.calendar.editor.repeat.after', 'After')}
            </SegmentedControlItem>
          </SegmentedControl>
          {endType === 'date' ? (
            <DateControl
              className="min-w-0 flex-1"
              value={untilDate || ''}
              onChange={onUntilDateChange}
              ariaLabel={t('customers.calendar.editor.repeat.onDate', 'On Date')}
              locale={locale}
            />
          ) : null}
          {endType === 'count' ? (
            <span className="flex shrink-0 items-center gap-2">
              <Input
                type="number"
                min={1}
                max={365}
                value={countText}
                onChange={(event) => {
                  const raw = event.target.value
                  /* The raw text is held locally so the field can be EMPTY
                     mid-edit. Committing straight to `count` meant an empty box
                     parsed to 0, failed the `>= 1` guard, and never propagated —
                     so the controlled value snapped back and you could not
                     delete past the first digit. */
                  setCountText(raw)
                  const next = Number(raw)
                  if (raw !== '' && Number.isInteger(next) && next >= 1 && next <= MAX_REPEAT_COUNT) {
                    onCountChange(next)
                  }
                }}
                onBlur={() => {
                  // Whatever the box is left holding, it settles on a usable
                  // count: empty and 0 are not repeat counts.
                  const next = Number(countText)
                  const settled = !countText.trim() || !Number.isInteger(next) || next < 1
                    ? 1
                    : Math.min(next, MAX_REPEAT_COUNT)
                  setCountText(String(settled))
                  if (settled !== count) onCountChange(settled)
                }}
                aria-label={t('customers.calendar.editor.repeat.after', 'After')}
                className="h-9 w-20"
              />
              <span className={cn(LABEL_CLASS, 'shrink-0')}>{t('customers.calendar.editor.repeat.times', 'times')}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
