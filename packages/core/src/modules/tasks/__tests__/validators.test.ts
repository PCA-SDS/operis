import {
  labelCreateRequestSchema,
  myTasksQuerySchema,
  projectCreateRequestSchema,
  projectListQuerySchema,
  taskCalendarQuerySchema,
  taskCreateRequestSchema,
  taskListQuerySchema,
  taskMoveRequestSchema,
  timeZoneSchema,
} from '../data/validators'

const UUID = '11111111-2222-4333-8444-555555555555'

describe('projectCreateRequestSchema', () => {
  it('upper-cases the key before validating it', () => {
    expect(projectCreateRequestSchema.parse({ key: 'eng', name: 'Engineering' }).key).toBe('ENG')
  })

  it.each(['E', 'ENGINEERING1', '1ENG', 'EN-G', ''])('rejects the key %p', (key) => {
    expect(() => projectCreateRequestSchema.parse({ key, name: 'X' })).toThrow()
  })

  it('requires a non-blank name', () => {
    expect(() => projectCreateRequestSchema.parse({ key: 'ENG', name: '   ' })).toThrow()
  })

  it('trims the name', () => {
    expect(projectCreateRequestSchema.parse({ key: 'ENG', name: '  Engineering  ' }).name).toBe(
      'Engineering',
    )
  })
})

describe('projectListQuerySchema', () => {
  it('defaults to the active projects, newest first', () => {
    const parsed = projectListQuerySchema.parse({})
    expect(parsed).toMatchObject({ page: 1, pageSize: 20, archived: 'active', order: 'desc' })
  })

  it('coerces query-string numbers', () => {
    expect(projectListQuerySchema.parse({ page: '3', pageSize: '50' })).toMatchObject({
      page: 3,
      pageSize: 50,
    })
  })

  it('refuses a page size beyond the cap', () => {
    expect(() => projectListQuerySchema.parse({ pageSize: '5000' })).toThrow()
  })
})

describe('taskCreateRequestSchema', () => {
  it('accepts a minimal task', () => {
    expect(taskCreateRequestSchema.parse({ title: 'Ship it' }).title).toBe('Ship it')
  })

  it.each(['24:00', '9:30', '0930', 'noon'])('rejects the due time %p', (dueTime) => {
    expect(() => taskCreateRequestSchema.parse({ title: 'X', dueTime })).toThrow()
  })

  it.each(['00:00', '09:30', '23:59'])('accepts the due time %p', (dueTime) => {
    expect(taskCreateRequestSchema.parse({ title: 'X', dueTime }).dueTime).toBe(dueTime)
  })

  it.each(['2026-3-4', '04-03-2026', 'tomorrow'])('rejects the due date %p', (dueDate) => {
    expect(() => taskCreateRequestSchema.parse({ title: 'X', dueDate })).toThrow()
  })

  it('caps the number of labels a task may carry', () => {
    const labelIds = Array.from({ length: 21 }, () => UUID)
    expect(() => taskCreateRequestSchema.parse({ title: 'X', labelIds })).toThrow()
  })

  it('rejects a recurrence weekday outside 0–6', () => {
    expect(() =>
      taskCreateRequestSchema.parse({ title: 'X', recurrence: { freq: 'weekly', weekday: 7 } }),
    ).toThrow()
  })

  it('rejects a day of month outside 1–31', () => {
    expect(() =>
      taskCreateRequestSchema.parse({ title: 'X', recurrence: { freq: 'monthly', dayOfMonth: 32 } }),
    ).toThrow()
  })

  it('accepts an explicit null recurrence', () => {
    expect(taskCreateRequestSchema.parse({ title: 'X', recurrence: null }).recurrence).toBeNull()
  })
})

describe('taskListQuerySchema', () => {
  it('rejects an unknown sort field', () => {
    expect(() => taskListQuerySchema.parse({ sort: 'rank' })).toThrow()
  })

  it('accepts every declared sort field', () => {
    for (const sort of ['createdAt', 'dueDate', 'priority', 'status', 'title']) {
      expect(taskListQuerySchema.parse({ sort }).sort).toBe(sort)
    }
  })
})

describe('taskMoveRequestSchema', () => {
  it('accepts a null anchor meaning "top of the column"', () => {
    expect(taskMoveRequestSchema.parse({ status: 'done', afterTaskId: null }).afterTaskId).toBeNull()
  })

  it('rejects an unknown status', () => {
    expect(() => taskMoveRequestSchema.parse({ status: 'archived' })).toThrow()
  })
})

describe('timeZoneSchema', () => {
  it('accepts a real IANA zone', () => {
    expect(timeZoneSchema.parse('Asia/Singapore')).toBe('Asia/Singapore')
  })

  it('rejects nonsense', () => {
    expect(() => timeZoneSchema.parse('Mars/Olympus')).toThrow()
  })

  it('treats an absent zone as fine — the server defaults to UTC', () => {
    expect(timeZoneSchema.parse(undefined)).toBeUndefined()
  })
})

describe('myTasksQuerySchema', () => {
  it('requires a known view', () => {
    expect(() => myTasksQuerySchema.parse({ view: 'archive' })).toThrow()
    expect(myTasksQuerySchema.parse({ view: 'today' }).view).toBe('today')
  })
})

describe('taskCalendarQuerySchema', () => {
  it('requires a mode and a well-formed window', () => {
    expect(
      taskCalendarQuerySchema.parse({ mode: 'scheduled', from: '2026-03-01', to: '2026-03-31' }),
    ).toMatchObject({ mode: 'scheduled' })
    expect(() => taskCalendarQuerySchema.parse({ mode: 'scheduled', from: 'March', to: '2026-03-31' })).toThrow()
  })
})

describe('labelCreateRequestSchema', () => {
  it.each(['#fff', 'red', '#12345', 'rgb(0,0,0)'])('rejects the colour %p', (color) => {
    expect(() => labelCreateRequestSchema.parse({ name: 'Bug', color })).toThrow()
  })

  it('accepts a six-digit hex colour', () => {
    expect(labelCreateRequestSchema.parse({ name: 'Bug', color: '#C0483F' }).color).toBe('#C0483F')
  })
})
