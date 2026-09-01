import {
  calendarTimeZone,
  calendarStatusOfTask,
  formatCalendarDate,
  formatWallClockTime,
  mapTaskToCalendarItem,
  parseCalendarDate,
  parseWallClockMinutes,
  taskScheduleChangeFor,
} from '../taskItem'
import {
  allItemsForDay,
  belongsInAllDayLane,
  layoutTimedDay,
  packMonthRowBars,
  segmentForDay,
  singleDayItemsFor,
} from '../layout'
import { makeCalendarTaskItem } from './fixtures'
import type { CalendarTaskPayload } from '../../../components/calendar/types'

function taskDto(overrides: Partial<CalendarTaskPayload> = {}): CalendarTaskPayload {
  return makeCalendarTaskItem(
    { id: overrides.id ?? 'task-1', start: new Date(2026, 5, 1), end: new Date(2026, 5, 2) },
    overrides,
  ).task
}

describe('parseCalendarDate', () => {
  it('reads a bare date as local midnight, not UTC', () => {
    const parsed = parseCalendarDate('2026-06-01')
    // `new Date('2026-06-01')` is UTC midnight, which is 31 May for anyone west
    // of Greenwich — the classic off-by-one-day calendar bug.
    expect(parsed?.getFullYear()).toBe(2026)
    expect(parsed?.getMonth()).toBe(5)
    expect(parsed?.getDate()).toBe(1)
    expect(parsed?.getHours()).toBe(0)
  })

  it('rejects anything that is not a calendar date', () => {
    expect(parseCalendarDate('2026-6-1')).toBeNull()
    expect(parseCalendarDate('')).toBeNull()
    expect(parseCalendarDate('not-a-date')).toBeNull()
  })
})

describe('parseWallClockMinutes', () => {
  it('reads HH:MM into minutes from midnight', () => {
    expect(parseWallClockMinutes('00:00')).toBe(0)
    expect(parseWallClockMinutes('09:30')).toBe(570)
    expect(parseWallClockMinutes('23:59')).toBe(1439)
  })

  it('rejects out-of-range and malformed times', () => {
    expect(parseWallClockMinutes('24:00')).toBeNull()
    expect(parseWallClockMinutes('09:60')).toBeNull()
    expect(parseWallClockMinutes('9:30')).toBeNull()
  })
})

describe('calendarStatusOfTask', () => {
  it('maps the terminal board statuses onto the calendar\'s own', () => {
    expect(calendarStatusOfTask('done')).toBe('done')
    expect(calendarStatusOfTask('cancelled')).toBe('canceled')
  })

  it('treats every working status as planned rather than inventing one', () => {
    for (const status of ['backlog', 'pending', 'in_progress', 'blocked', 'review']) {
      expect(calendarStatusOfTask(status)).toBe('planned')
    }
  })
})

describe('mapTaskToCalendarItem', () => {
  it('keeps the task id, so the calendar entry IS the task', () => {
    const item = mapTaskToCalendarItem(taskDto({ id: 'task-42' }))
    expect(item?.id).toBe('task-42')
    expect(item?.task.id).toBe('task-42')
    expect(item?.source).toBe('task')
  })

  it('carries the served record verbatim, so no field is re-derived', () => {
    const dto = taskDto({ id: 'task-7', title: 'Prepare proposal', priority: 'high' })
    expect(mapTaskToCalendarItem(dto)?.task).toBe(dto)
  })

  it('places a task with a due time at that time', () => {
    const item = mapTaskToCalendarItem(taskDto({ calendarDate: '2026-09-05', calendarTime: '10:00' }))
    expect(item?.allDay).toBe(false)
    expect(item?.start.getFullYear()).toBe(2026)
    expect(item?.start.getMonth()).toBe(8)
    expect(item?.start.getDate()).toBe(5)
    expect(item?.start.getHours()).toBe(10)
    expect(item?.start.getMinutes()).toBe(0)
  })

  it('gives a timed task the shared nominal slot length', () => {
    const item = mapTaskToCalendarItem(taskDto({ calendarDate: '2026-09-05', calendarTime: '10:00' }))
    expect((item!.end.getTime() - item!.start.getTime()) / 60_000).toBe(60)
  })

  it('sends a due-date-only task to the all-day lane, never to midnight', () => {
    const item = mapTaskToCalendarItem(taskDto({ calendarDate: '2026-09-05', calendarTime: null }))
    expect(item?.allDay).toBe(true)
    expect(belongsInAllDayLane(item!)).toBe(true)
    // The bug this guards: rendering "due that day" as a 00:00 timed block.
    expect(segmentForDay(item!, new Date(2026, 8, 5))).not.toBeNull()
    expect(layoutTimedDay([item!], new Date(2026, 8, 5))).toHaveLength(0)
  })

  it('spans an all-day task exactly one day, midnight to midnight', () => {
    const item = mapTaskToCalendarItem(taskDto({ calendarDate: '2026-09-05', calendarTime: null }))
    expect(item?.start.getDate()).toBe(5)
    expect(item?.end.getDate()).toBe(6)
    expect(item?.end.getHours()).toBe(0)
  })

  it('exposes assignees as participants so conflict scoping can see them', () => {
    const item = mapTaskToCalendarItem(
      taskDto({ assignees: [{ id: 'user-1', name: 'Ada' }, { id: 'user-1', name: 'Ada' }] }),
    )
    expect(item?.participants).toEqual([{ userId: 'user-1', name: 'Ada' }])
    expect(item?.ownerUserId).toBe('user-1')
  })

  it('never claims to be a recurrence occurrence — the task domain has no future rows', () => {
    const item = mapTaskToCalendarItem(taskDto({ recurrence: { freq: 'weekly', weekday: 1 } }))
    expect(item?.isRecurringOccurrence).toBe(false)
  })

  it('drops a row whose calendar date is unusable rather than rendering it wrong', () => {
    expect(mapTaskToCalendarItem(taskDto({ calendarDate: 'nonsense' }))).toBeNull()
  })
})

describe('taskScheduleChangeFor', () => {
  it('writes only what a task can hold — a due date and an optional time', () => {
    const change = taskScheduleChangeFor(new Date(2026, 8, 7, 16, 30), false)
    expect(change).toEqual({ dueDate: '2026-09-07', dueTime: '16:30' })
    expect(Object.keys(change).sort()).toEqual(['dueDate', 'dueTime'])
  })

  it('clears the time when a task is dropped into the all-day lane', () => {
    expect(taskScheduleChangeFor(new Date(2026, 8, 7, 16, 30), true)).toEqual({
      dueDate: '2026-09-07',
      dueTime: null,
    })
  })

  it('round-trips through the mapper: what a drag writes is where the task lands', () => {
    const dropped = new Date(2026, 8, 7, 16, 30)
    const change = taskScheduleChangeFor(dropped, false)
    const moved = mapTaskToCalendarItem(
      taskDto({ calendarDate: change.dueDate, calendarTime: change.dueTime }),
    )
    expect(moved?.start.getTime()).toBe(dropped.getTime())
  })

  it('formats dates and times in local wall clock, not UTC', () => {
    // A late-evening drop must not roll onto the next day via a UTC conversion.
    const late = new Date(2026, 8, 7, 23, 45)
    expect(formatCalendarDate(late)).toBe('2026-09-07')
    expect(formatWallClockTime(late)).toBe('23:45')
  })

  it('keeps a drop on a DST-transition day on the day it was dropped', () => {
    // 2026-03-08 is the US spring-forward date; the wall clock is what matters.
    const dropped = new Date(2026, 2, 8, 14, 0)
    expect(taskScheduleChangeFor(dropped, false)).toEqual({ dueDate: '2026-03-08', dueTime: '14:00' })
  })
})

describe('calendarTimeZone', () => {
  it('always names a zone, so a task write never silently falls back to UTC', () => {
    // The task API treats `tz` as optional and defaults to UTC. Completion
    // resolves `completedAt` and a recurring task's next due date against it,
    // so a calendar write that omits it records the wrong day for anyone
    // completing a task near midnight outside UTC.
    const zone = calendarTimeZone()
    expect(typeof zone).toBe('string')
    expect(zone.length).toBeGreaterThan(0)
  })

  it('reports the runtime zone rather than a hardcoded one', () => {
    expect(calendarTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })
})

const WEEK = Array.from({ length: 7 }, (_, index) => new Date(2026, 8, 1 + index))

describe('month view renders tasks through the shared layout engine', () => {
  it('shows a timed task as a single-day pill on its due date', () => {
    const item = mapTaskToCalendarItem(
      makeCalendarTaskItem({ id: 't1', start: new Date(), end: new Date() }, {
        calendarDate: '2026-09-03',
        calendarTime: '14:00',
      }).task,
    )!
    expect(singleDayItemsFor([item], new Date(2026, 8, 3))).toHaveLength(1)
    expect(singleDayItemsFor([item], new Date(2026, 8, 4))).toHaveLength(0)
  })

  it('shows a due-date-only task as a one-cell bar, not a pill', () => {
    const item = mapTaskToCalendarItem(
      makeCalendarTaskItem({ id: 't2', start: new Date(), end: new Date() }, {
        calendarDate: '2026-09-03',
        calendarTime: null,
      }).task,
    )!
    expect(singleDayItemsFor([item], new Date(2026, 8, 3))).toHaveLength(0)
    const bars = packMonthRowBars([item], WEEK)
    expect(bars).toHaveLength(1)
    expect(bars[0].startIndex).toBe(2)
    expect(bars[0].endIndex).toBe(2)
  })

  it('lists a task in the day overflow alongside events', () => {
    const item = mapTaskToCalendarItem(
      makeCalendarTaskItem({ id: 't3', start: new Date(), end: new Date() }, {
        calendarDate: '2026-09-03',
        calendarTime: '09:00',
      }).task,
    )!
    expect(allItemsForDay([item], new Date(2026, 8, 3)).map((entry) => entry.id)).toEqual(['t3'])
  })
})
