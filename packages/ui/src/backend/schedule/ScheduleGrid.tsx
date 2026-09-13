"use client"

import { ScheduleDayList, type ScheduleDayListProps } from './ScheduleDayList'

export type ScheduleGridProps = ScheduleDayListProps

/** Day cards laid out in responsive columns, with abbreviated weekday names. */
export function ScheduleGrid(props: ScheduleGridProps) {
  return (
    <ScheduleDayList
      {...props}
      layout={{ containerClassName: 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3', weekday: 'short' }}
    />
  )
}
