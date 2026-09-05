import { tCount } from '../components/plurals'

/**
 * The `_plural` branch was restated at seven call sites, and one of them had
 * already shipped "1 unread chat messages". These pin the rule in one place.
 */
describe('tCount', () => {
  const t = ((key: string, fallback?: unknown, params?: Record<string, unknown>) => {
    const text = typeof fallback === 'string' ? fallback : key
    const rendered = params
      ? Object.entries(params).reduce(
          (acc, [name, value]) => acc.replace(`{${name}}`, String(value)),
          text,
        )
      : text
    return `${key}::${rendered}`
  }) as unknown as Parameters<typeof tCount>[0]

  it('uses the singular key for exactly one', () => {
    expect(tCount(t, 'chat.pins.count', 1, '{count} pinned')).toBe('chat.pins.count::1 pinned')
  })

  it('uses the plural key for everything else', () => {
    for (const n of [0, 2, 17, 99]) {
      expect(tCount(t, 'chat.pins.count', n, '{count} pinned')).toBe(
        `chat.pins.count_plural::${n} pinned`,
      )
    }
  })

  it('passes count through without the caller repeating it', () => {
    expect(tCount(t, 'k', 3, '{count} members')).toContain('3 members')
  })

  it('keeps extra params alongside count', () => {
    expect(tCount(t, 'k', 2, '{count} in {place}', { place: 'Ops' })).toContain('2 in Ops')
  })

  it('treats zero as plural, which is what English wants', () => {
    // The bug this replaced: a `> 1` test would have made zero singular.
    expect(tCount(t, 'k', 0, '{count} unread')).toContain('_plural')
  })
})
