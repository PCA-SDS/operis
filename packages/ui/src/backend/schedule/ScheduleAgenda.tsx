"use client"

import { ScheduleDayList, type ScheduleDayListProps } from './ScheduleDayList'

export type ScheduleAgendaProps = ScheduleDayListProps

/** Day cards stacked vertically, with the full weekday name on each heading. */
export function ScheduleAgenda(props: ScheduleAgendaProps) {
  return <ScheduleDayList {...props} layout={{ containerClassName: 'space-y-4', weekday: 'long' }} />
}
