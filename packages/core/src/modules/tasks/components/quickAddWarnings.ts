"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { QuickAddWarningCode, QuickAddWarningDto } from '../data/types'

/**
 * English fallbacks for every parser warning. The parser returns codes rather
 * than sentences so a warning reads in the operator's language, and this map is
 * the single place the wording lives for the default locale.
 */
const FALLBACKS: Record<QuickAddWarningCode, string> = {
  noTitle: 'The task has no title after removing recognized tokens.',
  multipleProjects: 'Only the first #project is used; the rest stays in the title.',
  multipleAssignees: 'Only the first @assignee is used; the rest stays in the title.',
  typoCorrected: 'Read “{text}” as “{corrected}”.',
  multiWeekdayRepeat:
    'Repeats on multiple weekdays aren’t supported yet — pick one weekday (the schedule was left in the title).',
  repeatException: 'Repeat exceptions aren’t supported yet — the schedule was left in the title.',
  intervalRepeat:
    'Interval and ordinal repeats (like “every 2 weeks”) aren’t supported yet — pick a simple daily/weekly/monthly repeat.',
  yearlyRepeat: 'Yearly repeats aren’t supported yet — the schedule was left in the title.',
  quarterlyRepeat: 'Quarterly repeats aren’t supported yet — the schedule was left in the title.',
  weekendRepeat:
    'Weekend repeats aren’t supported yet (a repeat covers one weekday) — the schedule was left in the title.',
  repeatEndCondition:
    'Repeat start/end conditions (like “until December”) aren’t supported yet — that part was left in the title.',
  invalidDayOfMonth: '“{day}” isn’t a valid day of the month.',
  timeNeedsMinutes:
    '“{text}” needs minutes or am/pm (say “at 3pm” or “at 15:00”) — it was left in the title.',
  invalidTime: '“{text}” isn’t a valid time.',
  invalidDate: '“{text}” isn’t a valid calendar date — it was left in the title.',
  ambiguousDate:
    '“{text}” is ambiguous (day/month or month/day?) — use a month name like “{suggestion}”. It was left in the title.',
  invalidDay: '“{text}” isn’t a valid day.',
  projectNotFound: 'No project matches “#{query}”.',
  projectAmbiguous: '“#{query}” matches more than one project — pick one manually.',
  assigneeNotFound: 'No member matches “@{query}”.',
  assigneeAmbiguous: '“@{query}” matches more than one member — pick one manually.',
  labelNotFound: 'No label matches “+{query}”.',
  labelAmbiguous: '“+{query}” matches more than one label — pick one manually.',
}

export function useQuickAddWarning(): (warning: QuickAddWarningDto) => string {
  const t = useT()
  return React.useCallback(
    (warning: QuickAddWarningDto) =>
      t(`tasks.quickAdd.warning.${warning.code}`, FALLBACKS[warning.code], warning.params),
    [t],
  )
}
