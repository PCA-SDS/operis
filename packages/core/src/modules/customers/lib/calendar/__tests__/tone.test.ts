import {
  inkForFill,
  outlineFillStyle,
  relativeLuminance,
  resolveEventTone,
  solidFillStyle,
  toneDotStyle,
} from '../tone'
import { makeCalendarItem, makeCalendarTaskItem } from './fixtures'
import type { CalendarItem } from '../../../components/calendar/types'

let seq = 0
function makeItem(overrides: Partial<CalendarItem> & { start: Date; end: Date }): CalendarItem {
  return makeCalendarItem({ id: `tone-${(seq += 1)}`, ...overrides })
}

const NOW = new Date(2026, 8, 16, 12, 0, 0).getTime()

describe('relativeLuminance', () => {
  it('anchors the scale at black and white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
  })

  it('accepts the three-digit shorthand', () => {
    expect(relativeLuminance('#fff')).toBeCloseTo(relativeLuminance('#ffffff') as number, 5)
  })

  it('weights green above red above blue, as perception does', () => {
    const green = relativeLuminance('#00ff00') as number
    const red = relativeLuminance('#ff0000') as number
    const blue = relativeLuminance('#0000ff') as number
    expect(green).toBeGreaterThan(red)
    expect(red).toBeGreaterThan(blue)
  })

  it('returns null for a colour it cannot measure without layout', () => {
    expect(relativeLuminance('oklch(0.7 0.1 200)')).toBeNull()
    expect(relativeLuminance('rebeccapurple')).toBeNull()
    expect(relativeLuminance('var(--primary)')).toBeNull()
    expect(relativeLuminance('#12345')).toBeNull()
  })
})

describe('inkForFill', () => {
  it('puts dark ink on a light fill and light ink on a dark one', () => {
    expect(inkForFill('#ffffff')).toBe('onLight')
    expect(inkForFill('#000000')).toBe('onDark')
  })

  it('puts dark ink on amber, where white would be unreadable', () => {
    expect(inkForFill('#f59e0b')).toBe('onLight')
  })

  it('puts light ink on a mid indigo', () => {
    expect(inkForFill('#4f46e5')).toBe('onDark')
  })

  it('picks the better ink either side of the crossover, not a guessed midpoint', () => {
    // #3b82f6 reads 3.7:1 with white and 4.6:1 with dark ink. A threshold tuned
    // by eye gets this one backwards; comparing the two ratios cannot.
    expect(inkForFill('#3b82f6')).toBe('onLight')
  })

  it('never picks the ink with the worse contrast, across the whole ramp', () => {
    const ramp = [
      '#000000', '#1f2937', '#4f46e5', '#3b82f6', '#0ea5e9', '#10b981',
      '#84cc16', '#f59e0b', '#ef4444', '#ec4899', '#e5e7eb', '#ffffff',
    ]
    const contrast = (first: number, second: number) =>
      (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
    const white = relativeLuminance('#ffffff') as number
    const black = relativeLuminance('#1a1a1a') as number

    for (const color of ramp) {
      const luminance = relativeLuminance(color) as number
      const chosen = inkForFill(color)
      const chosenRatio = contrast(luminance, chosen === 'onDark' ? white : black)
      const otherRatio = contrast(luminance, chosen === 'onDark' ? black : white)
      expect(chosenRatio).toBeGreaterThanOrEqual(otherRatio)
    }
  })

  it('clears WCAG AA for body text on every seeded activity-type colour', () => {
    // The tenant dictionary seeds these; a card whose title fails AA is a bug,
    // not a taste question.
    const seeded = ['#f59e0b', '#4f46e5', '#10b981', '#ef4444', '#0ea5e9']
    const contrast = (first: number, second: number) =>
      (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
    const inkLuminance = {
      onDark: relativeLuminance('#ffffff') as number,
      onLight: relativeLuminance('#1a1a1a') as number,
    }

    for (const color of seeded) {
      const luminance = relativeLuminance(color) as number
      expect(contrast(luminance, inkLuminance[inkForFill(color)])).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('falls back to light ink when the colour cannot be measured', () => {
    expect(inkForFill('var(--primary)')).toBe('onDark')
  })
})

describe('fill styles', () => {
  it('pins the ink to a fixed colour, because the fill it sits on is fixed too', () => {
    // Binding ink to `var(--foreground)` flips with the theme while the fill
    // does not — that landed near-black on mid-indigo in dark mode at 2.9:1.
    expect(solidFillStyle('#4f46e5', 'onDark').color).toBe('#ffffff')
    expect(solidFillStyle('#f59e0b', 'onLight').color).toBe('#1a1a1a')
    expect(String(solidFillStyle('#4f46e5', 'onDark').color)).not.toContain('var(')
  })

  it('fills solid and borders with the same colour, so the card reads as one block', () => {
    const style = solidFillStyle('#4f46e5', 'onDark')
    expect(style.backgroundColor).toBe('#4f46e5')
    expect(style.borderColor).toBe('#4f46e5')
  })

  it('hollows the fill out for the outlined treatment', () => {
    const style = outlineFillStyle('#4f46e5')
    expect(style.backgroundColor).toBe('transparent')
    expect(style.borderColor).toBe('#4f46e5')
  })
})

describe('resolveEventTone', () => {
  const upcoming = { start: new Date(2026, 8, 16, 14, 0), end: new Date(2026, 8, 16, 15, 0) }

  it('fills a live coloured entry solid', () => {
    const tone = resolveEventTone(makeItem({ ...upcoming, color: '#4f46e5' }), NOW)
    expect(tone.coloured).toBe(true)
    expect(tone.style?.backgroundColor).toBe('#4f46e5')
  })

  it('hollows out an entry that has already finished', () => {
    const tone = resolveEventTone(
      makeItem({ start: new Date(2026, 8, 16, 8, 0), end: new Date(2026, 8, 16, 9, 0), color: '#4f46e5' }),
      NOW,
    )
    expect(tone.coloured).toBe(false)
    expect(tone.style?.backgroundColor).toBe('transparent')
  })

  it('hollows out an entry marked done even while it is still running', () => {
    const tone = resolveEventTone(makeItem({ ...upcoming, color: '#4f46e5', status: 'done' }), NOW)
    expect(tone.style?.backgroundColor).toBe('transparent')
  })

  it('strikes through a cancelled entry and drops its fill', () => {
    const tone = resolveEventTone(makeItem({ ...upcoming, color: '#4f46e5', status: 'canceled' }), NOW)
    expect(tone.titleClassName).toContain('line-through')
    expect(tone.style?.backgroundColor).toBe('transparent')
  })

  it('falls back to a token-only tone when the entry carries no colour', () => {
    const tone = resolveEventTone(makeItem({ ...upcoming, color: null }), NOW)
    expect(tone.style).toBeUndefined()
    expect(tone.surfaceClassName).toContain('bg-primary')
  })
})

describe('toneDotStyle', () => {
  const upcoming = { start: new Date(2026, 8, 16, 14, 0), end: new Date(2026, 8, 16, 15, 0) }

  it('fills the dot for a live entry', () => {
    expect(toneDotStyle(makeItem({ ...upcoming, color: '#4f46e5' }), NOW)).toEqual({
      backgroundColor: '#4f46e5',
    })
  })

  it('hollows the dot for a finished entry, so the row still reads as inactive', () => {
    const style = toneDotStyle(
      makeItem({ start: new Date(2026, 8, 16, 8, 0), end: new Date(2026, 8, 16, 9, 0), color: '#4f46e5' }),
      NOW,
    )
    expect(style?.backgroundColor).toBe('transparent')
    expect(String(style?.boxShadow)).toContain('#4f46e5')
  })

  it('leaves an uncoloured entry to its class-based dot', () => {
    expect(toneDotStyle(makeItem({ ...upcoming, color: null }), NOW)).toBeUndefined()
  })
})

describe('resolveEventTone for tasks', () => {
  const range = { start: new Date(2026, 8, 16, 14, 0), end: new Date(2026, 8, 16, 15, 0) }
  const task = (status: string) =>
    makeCalendarTaskItem({ id: `t-${status}`, ...range }, { status: status as never })

  it('paints a task from theme tokens, never a runtime colour', () => {
    const tone = resolveEventTone(task('in_progress'), NOW)
    // A hex fill here would mean the calendar had invented a task palette; the
    // Task Manager owns the status, the calendar only owns how it is drawn.
    expect(tone.style).toBeUndefined()
    expect(tone.coloured).toBe(false)
    expect(tone.surfaceClassName).toContain('border-primary')
  })

  it('draws a task as a light card with a leading edge, not a filled block', () => {
    // Events fill their slot because they claim it; a task is a deadline, so it
    // must not read as an equally solid commitment.
    const tone = resolveEventTone(task('pending'), NOW)
    expect(tone.surfaceClassName).toContain('bg-surface')
    expect(tone.surfaceClassName).toContain('border-s-2')
  })

  it('gives every board status a tone, so a new status cannot render blank', () => {
    for (const status of ['backlog', 'pending', 'in_progress', 'blocked', 'review', 'done', 'cancelled']) {
      const tone = resolveEventTone(task(status), NOW)
      expect(tone.surfaceClassName.trim().length).toBeGreaterThan(0)
      expect(tone.titleClassName.trim().length).toBeGreaterThan(0)
      expect(tone.style).toBeUndefined()
    }
  })

  it('draws every working status alike rather than copying the board palette', () => {
    const working = ['backlog', 'pending', 'in_progress', 'blocked', 'review']
    const surfaces = new Set(working.map((status) => resolveEventTone(task(status), NOW).surfaceClassName))
    expect(surfaces.size).toBe(1)
  })

  it('strikes through a completed task', () => {
    expect(resolveEventTone(task('done'), NOW).titleClassName).toContain('line-through')
    expect(resolveEventTone(task('in_progress'), NOW).titleClassName).not.toContain('line-through')
  })

  it('does not mute a task just because its due time has passed', () => {
    // An event that has ended is over; a task that is past due is the opposite
    // of finished, so it must stay live rather than grey out like a past event.
    const overdue = makeCalendarTaskItem(
      { id: 'overdue', start: new Date(2026, 8, 16, 8, 0), end: new Date(2026, 8, 16, 9, 0) },
      { status: 'blocked' },
    )
    const tone = resolveEventTone(overdue, NOW)
    expect(tone.surfaceClassName).toContain('border-primary')
    expect(tone.titleClassName).not.toContain('line-through')
  })

  it('marks a completed task done rather than merely past', () => {
    const tone = resolveEventTone(task('done'), NOW)
    expect(tone.surfaceClassName).toContain('bg-status-success-bg')
    expect(tone.titleClassName).toContain('line-through')
  })

  it('leaves a task dot to its status classes rather than a runtime colour', () => {
    expect(toneDotStyle(task('pending'), NOW)).toBeUndefined()
  })
})
