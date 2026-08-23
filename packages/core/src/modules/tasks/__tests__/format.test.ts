import {
  MILESTONE_STATUS_META,
  TASK_GROUP_ORDER,
  TASK_PRIORITY_META,
  TASK_STATUS_META,
  TASK_STATUS_ORDER,
  addLocalDays,
  dayHeadingParts,
  describeRecurrence,
  dueChipRelative,
  formatTaskTime,
  isOverdue,
  localTodayIso,
  taskRef,
} from '../components/format'
import {
  MILESTONE_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskRecurrenceDto,
} from '../data/types'

/** Stand-in translator: returns the fallback with `{placeholders}` filled, so a
 *  test asserts on the sentence a user would actually read. */
const t = ((_key: string, fallback: string, params?: Record<string, string | number>) =>
  params
    ? fallback.replace(/\{(\w+)\}/g, (match, name) => String(params[name] ?? match))
    : fallback) as never

describe('design-system token mapping', () => {
  it('gives every status a token, never a hardcoded colour', () => {
    for (const status of TASK_STATUSES) {
      const meta = TASK_STATUS_META[status]
      expect(meta.colorVar).toMatch(/^var\(--[a-z-]+\)$/)
      expect(meta.textClass).toMatch(/^text-/)
      expect(meta.bgClass).toMatch(/^bg-/)
      expect(meta.borderClass).toMatch(/^border-/)
    }
  })

  it('gives every priority a token', () => {
    for (const priority of TASK_PRIORITIES) {
      expect(TASK_PRIORITY_META[priority].colorVar).toMatch(/^var\(--[a-z-]+\)$/)
    }
  })

  it('gives every milestone status a token', () => {
    for (const status of MILESTONE_STATUSES) {
      expect(MILESTONE_STATUS_META[status].colorVar).toMatch(/^var\(--[a-z-]+\)$/)
    }
  })

  it('separates the two states that read as "not started"', () => {
    // Backlog and cancelled both look quiet, so they must not be the same
    // colour — one is work waiting, the other is work abandoned.
    expect(TASK_STATUS_META.backlog.colorVar).not.toBe(TASK_STATUS_META.cancelled.colorVar)
  })

  it('gives each in-flight status its own colour', () => {
    const inFlight = ['pending', 'in_progress', 'blocked', 'review', 'done'] as const
    const colours = inFlight.map((status) => TASK_STATUS_META[status].colorVar)
    expect(new Set(colours).size).toBe(colours.length)
  })

  it('marks only "none" as unflagged', () => {
    expect(TASK_PRIORITY_META.none.flagged).toBe(false)
    for (const priority of ['low', 'medium', 'high', 'urgent'] as const) {
      expect(TASK_PRIORITY_META[priority].flagged).toBe(true)
    }
  })
})

describe('status orders', () => {
  it('covers every status exactly once in board order', () => {
    expect([...TASK_STATUS_ORDER].sort()).toEqual([...TASK_STATUSES].sort())
  })

  it('covers every status exactly once in grouped-list order', () => {
    expect([...TASK_GROUP_ORDER].sort()).toEqual([...TASK_STATUSES].sort())
  })

  it('puts live work before parked work in the grouped list', () => {
    expect(TASK_GROUP_ORDER.indexOf('in_progress')).toBeLessThan(TASK_GROUP_ORDER.indexOf('backlog'))
    expect(TASK_GROUP_ORDER.indexOf('backlog')).toBeLessThan(TASK_GROUP_ORDER.indexOf('cancelled'))
  })
})

describe('taskRef', () => {
  it('renders the human reference', () => {
    expect(taskRef('ENG', 42)).toBe('ENG-42')
  })
})

describe('relative dates', () => {
  const today = localTodayIso()

  it('recognises today, yesterday and tomorrow', () => {
    expect(dueChipRelative(today)).toBe('today')
    expect(dueChipRelative(addLocalDays(today, -1))).toBe('yesterday')
    expect(dueChipRelative(addLocalDays(today, 1))).toBe('tomorrow')
  })

  it('falls back to a date for anything further out', () => {
    expect(dueChipRelative(addLocalDays(today, 5))).toBeNull()
  })

  it('flags only past dates as overdue', () => {
    expect(isOverdue(addLocalDays(today, -1))).toBe(true)
    expect(isOverdue(today)).toBe(false)
    expect(isOverdue(addLocalDays(today, 1))).toBe(false)
    expect(isOverdue(null)).toBe(false)
  })

  it('labels a day heading relative to today', () => {
    expect(dayHeadingParts(today)?.relative).toBe('today')
    expect(dayHeadingParts(addLocalDays(today, 1))?.relative).toBe('tomorrow')
    expect(dayHeadingParts(addLocalDays(today, 4))?.relative).toBeNull()
  })

  it('returns null for a heading it cannot parse', () => {
    expect(dayHeadingParts('not-a-date')).toBeNull()
  })
})

describe('formatTaskTime', () => {
  it.each([
    ['00:00', '12:00 AM'],
    ['09:05', '9:05 AM'],
    ['12:00', '12:00 PM'],
    ['15:30', '3:30 PM'],
    ['23:59', '11:59 PM'],
  ])('renders %s as %s', (input, expected) => {
    expect(formatTaskTime(input)).toBe(expected)
  })

  it('renders nothing for an absent time', () => {
    expect(formatTaskTime(null)).toBe('')
  })
})

describe('describeRecurrence', () => {
  it.each<[TaskRecurrenceDto, string]>([
    [{ freq: 'daily' }, 'Every day'],
    [{ freq: 'weekdays' }, 'Every weekday'],
    [{ freq: 'weekly' }, 'Every week'],
    [{ freq: 'weekly', weekday: 2 }, 'Every Tuesday'],
    [{ freq: 'monthly' }, 'Every month'],
    [{ freq: 'monthly', dayOfMonth: 15 }, 'Monthly on day 15'],
  ])('describes %j', (recurrence, expected) => {
    expect(describeRecurrence(t, recurrence)).toBe(expected)
  })

  it('describes nothing when there is no rule', () => {
    expect(describeRecurrence(t, null)).toBe('')
  })
})
