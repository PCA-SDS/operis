import { parseQuickAdd } from '../lib/quick-add/parser'
import type { QuickAddWarningCode } from '../data/types'

/** A Wednesday, so weekday arithmetic has room on both sides. */
const TODAY = '2026-03-04'

function parse(text: string) {
  return parseQuickAdd(text, TODAY)
}

function codes(text: string): QuickAddWarningCode[] {
  return parse(text).warnings.map((warning) => warning.code)
}

describe('references', () => {
  it('pulls the project, assignee and labels out of the title', () => {
    const result = parse('Ship the release #Ops @amir +urgent +design')
    expect(result.title).toBe('Ship the release')
    expect(result.projectQuery).toBe('Ops')
    expect(result.assigneeQuery).toBe('amir')
    expect(result.labelQueries).toEqual(['urgent', 'design'])
  })

  it('accepts quoted references containing spaces', () => {
    const result = parse('Review #"Client Ops" with @"Ana Maria" +"needs review"')
    expect(result.projectQuery).toBe('Client Ops')
    expect(result.assigneeQuery).toBe('Ana Maria')
    expect(result.labelQueries).toEqual(['needs review'])
    expect(result.title).toBe('Review with')
  })

  it('ignores a trigger that is not at a word boundary', () => {
    // An email address must not open the assignee menu.
    const result = parse('Email ana@example.com about the invoice')
    expect(result.assigneeQuery).toBeNull()
    expect(result.title).toBe('Email ana@example.com about the invoice')
  })

  it('uses the first project and warns about the rest', () => {
    const result = parse('Sync #Ops #Sales')
    expect(result.projectQuery).toBe('Ops')
    expect(result.warnings.map((warning) => warning.code)).toContain('multipleProjects')
  })

  it('deduplicates repeated labels case-insensitively', () => {
    expect(parse('Fix it +bug +Bug').labelQueries).toEqual(['bug'])
  })
})

describe('priority', () => {
  it.each([
    ['p1', 'urgent'],
    ['p2', 'high'],
    ['p3', 'medium'],
    ['p4', 'low'],
  ])('reads %s as %s', (token, expected) => {
    const result = parse(`Do the thing ${token}`)
    expect(result.priority).toBe(expected)
    expect(result.title).toBe('Do the thing')
  })

  it('leaves a lookalike inside a word alone', () => {
    const result = parse('Update the p1000 sensor')
    expect(result.priority).toBeNull()
    expect(result.title).toBe('Update the p1000 sensor')
  })
})

describe('dates', () => {
  it.each([
    ['today', TODAY],
    ['tonight', TODAY],
    ['tomorrow', '2026-03-05'],
    ['tmr', '2026-03-05'],
    ['the day after tomorrow', '2026-03-06'],
    ['in 3 days', '2026-03-07'],
    ['in two weeks', '2026-03-18'],
    ['next week', '2026-03-09'],
    ['next month', '2026-04-04'],
    ['end of the week', '2026-03-06'],
    ['end of the month', '2026-03-31'],
    ['start of next month', '2026-04-01'],
    ['this weekend', '2026-03-07'],
    ['next weekend', '2026-03-14'],
    ['next friday', '2026-03-06'],
    ['2026-05-09', '2026-05-09'],
    ['on March 9', '2026-03-09'],
    ['9 March', '2026-03-09'],
  ])('reads "%s" as %s', (phrase, expected) => {
    expect(parse(`Pay rent ${phrase}`).dueDate).toBe(expected)
  })

  it('rolls a bare month/day that has already passed into next year', () => {
    expect(parse('Renew on January 5').dueDate).toBe('2027-01-05')
  })

  it('refuses an ambiguous slash date rather than guessing', () => {
    const result = parse('Call the client on 3/4')
    expect(result.dueDate).toBeNull()
    expect(result.warnings.map((warning) => warning.code)).toContain('ambiguousDate')
    // The span stays in the title so nothing the user typed is lost.
    expect(result.title).toContain('3/4')
  })

  it('accepts a slash date that reads the same either way', () => {
    // 5/5 is the 5th of May under both conventions.
    expect(parse('Report 5/5').dueDate).toBe('2026-05-05')
  })

  it('warns and keeps the text for an impossible calendar date', () => {
    const result = parse('Ship 2026-02-31')
    expect(result.dueDate).toBeNull()
    expect(result.warnings.map((warning) => warning.code)).toContain('invalidDate')
  })
})

describe('times', () => {
  it.each([
    ['at 3pm', '15:00'],
    ['at 3:30pm', '15:30'],
    ['at 15:00', '15:00'],
    ['3pm', '15:00'],
    ['at noon', '12:00'],
    ['at midnight', '00:00'],
    ['at 12am', '00:00'],
    ['at 12pm', '12:00'],
  ])('reads "%s" as %s', (phrase, expected) => {
    expect(parse(`Standup ${phrase}`).dueTime).toBe(expected)
  })

  it('defaults a bare time to today', () => {
    expect(parse('Standup at 3pm').dueDate).toBe(TODAY)
  })

  it('refuses a bare hour with no am/pm', () => {
    // "at 3" could be either; asking beats picking one.
    const result = parse('Call at 3')
    expect(result.dueTime).toBeNull()
    expect(result.warnings.map((warning) => warning.code)).toContain('timeNeedsMinutes')
    expect(result.title).toContain('at 3')
  })
})

describe('deadline lead-ins', () => {
  // Only "on" used to be recognised, and only by the absolute-date patterns
  // that spelled it out inline, so "Plan lunch by 3pm" parsed the time but left
  // "by" stranded on the end of the title.
  it.each([
    ['Plan lunch by 3pm', 'Plan lunch', '15:00'],
    ['Plan lunch by 3:30pm', 'Plan lunch', '15:30'],
    ['Finish before 5pm', 'Finish', '17:00'],
    ['Report due 9am', 'Report', '09:00'],
    ['Submit by noon', 'Submit', '12:00'],
    ['Deliver by 15:00', 'Deliver', '15:00'],
    ['Ship due by 8am', 'Ship', '08:00'],
  ])('consumes the lead-in in %s', (input, title, time) => {
    const result = parse(input)
    expect(result.title).toBe(title)
    expect(result.dueTime).toBe(time)
  })

  it.each([
    ['Call by tomorrow', 'Call'],
    ['Task by friday', 'Task'],
    ['Review before monday', 'Review'],
    ['Invoice due on 15 jan', 'Invoice'],
    ['Retro by next week', 'Retro'],
    ['Audit due end of month', 'Audit'],
  ])('consumes the lead-in before a date in %s', (input, title) => {
    const result = parse(input)
    expect(result.title).toBe(title)
    expect(result.dueDate).not.toBeNull()
  })

  it.each([
    'Sort by 3 columns',
    'Stand by 5 people',
    'Group by 2 fields',
  ])('leaves %s alone — a bare number after a lead-in is not a time', (input) => {
    const result = parse(input)
    expect(result.title).toBe(input)
    expect(result.dueTime).toBeNull()
    expect(result.dueDate).toBeNull()
  })

  it('still asks for minutes after "at", which does accept a bare hour', () => {
    expect(codes('Standup at 3')).toContain('timeNeedsMinutes')
  })
})

describe('recurrence', () => {
  it.each([
    ['every day', 'daily'],
    ['daily', 'daily'],
    ['every weekday', 'weekdays'],
    ['mon-fri', 'weekdays'],
    ['every week', 'weekly'],
    ['every month', 'monthly'],
  ])('reads "%s" as %s', (phrase, freq) => {
    expect(parse(`Water the plants ${phrase}`).recurrence?.freq).toBe(freq)
  })

  it('reads a weekday repeat and its anchor', () => {
    const result = parse('Team sync every Tuesday')
    expect(result.recurrence).toEqual({ freq: 'weekly', weekday: 2 })
    // The first occurrence is scheduled from today, not left blank.
    expect(result.dueDate).toBe('2026-03-10')
  })

  it('reads a plural weekday as a weekly repeat', () => {
    expect(parse('Standup Mondays').recurrence).toEqual({ freq: 'weekly', weekday: 1 })
  })

  it('reads a monthly day-of-month anchor', () => {
    const result = parse('Pay rent on the 1st of every month')
    expect(result.recurrence).toEqual({ freq: 'monthly', dayOfMonth: 1 })
    expect(result.dueDate).toBe('2026-04-01')
  })

  it.each([
    ['every 2 weeks', 'intervalRepeat'],
    ['every second Tuesday', 'intervalRepeat'],
    ['yearly', 'yearlyRepeat'],
    ['quarterly', 'quarterlyRepeat'],
    ['every weekend', 'weekendRepeat'],
    ['every Monday and Friday', 'multiWeekdayRepeat'],
    ['every day except Sunday', 'repeatException'],
  ])('warns about the unsupported repeat "%s"', (phrase, expected) => {
    const result = parse(`Do it ${phrase}`)
    expect(result.warnings.map((warning) => warning.code)).toContain(expected)
    // Unsupported schedules stay in the title so nothing is silently dropped.
    const lastWord = phrase.split(' ').at(-1)!
    expect(result.title.toLowerCase()).toContain(lastWord.toLowerCase())
  })

  it('warns about an end condition it cannot store', () => {
    expect(codes('Standup every week until December')).toContain('repeatEndCondition')
  })

  it('carves "every 24 hours" out of the interval rule as plain daily', () => {
    const result = parse('Backup every 24 hours')
    expect(result.recurrence?.freq).toBe('daily')
    expect(result.warnings.map((warning) => warning.code)).not.toContain('intervalRepeat')
  })
})

describe('typo tolerance', () => {
  it.each([
    ['tommorow', '2026-03-05'],
    ['next tusday', '2026-03-10'],
  ])('corrects "%s" and says so', (phrase, expected) => {
    const result = parse(`Ship ${phrase}`)
    expect(result.dueDate).toBe(expected)
    expect(result.warnings.map((warning) => warning.code)).toContain('typoCorrected')
  })

  it('does not treat "tom" as tomorrow', () => {
    // It is far more often a name.
    const result = parse('Email tom')
    expect(result.dueDate).toBeNull()
    expect(result.title).toBe('Email tom')
  })
})

describe('quoted literals', () => {
  it('never claims a span inside a quoted phrase', () => {
    const result = parse('Discuss "every Monday standup" with the team')
    expect(result.recurrence).toBeNull()
    expect(result.title).toBe('Discuss "every Monday standup" with the team')
  })
})

describe('token spans', () => {
  it('reports offsets that slice back to the exact text', () => {
    const text = 'Ship the release #Ops tomorrow at 3pm p1'
    const result = parseQuickAdd(text, TODAY)
    expect(result.recognizedTokens.length).toBeGreaterThan(0)
    for (const token of result.recognizedTokens) {
      expect(text.slice(token.start, token.end)).toBe(token.text)
    }
  })

  it('warns when nothing is left to call the task', () => {
    expect(codes('tomorrow p1')).toContain('noTitle')
  })
})

describe('title cleanup', () => {
  it('collapses the whitespace a removed token leaves behind', () => {
    expect(parse('Call   the    client tomorrow').title).toBe('Call the client')
  })

  it('drops trailing punctuation stranded by a removed token', () => {
    expect(parse('Renew the licence, tomorrow').title).toBe('Renew the licence')
  })
})
