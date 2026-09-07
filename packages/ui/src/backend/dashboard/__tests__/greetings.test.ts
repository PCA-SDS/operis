import fs from 'node:fs'
import path from 'node:path'
import { locales } from '@open-mercato/shared/lib/i18n/config'
import {
  GREETINGS,
  formatGreeting,
  pickGreeting,
  pickGreetingForNow,
  resolveGreetedName,
  resolveGreetingSlot,
  type GreetingSlot,
} from '../greetings'

// Read from the shared config, not a hand-kept copy: this is the only guard that
// holds the dashboard greetings to "every app locale", and a hardcoded list
// silently stops covering a locale the moment one is added to `locales`.
const LOCALES = locales
const SLOTS: GreetingSlot[] = ['morning', 'afternoon', 'evening', 'night']

function readAppDictionary(locale: string): Record<string, string> {
  const dictionaryPath = path.join(
    __dirname, '..', '..', '..', '..', '..', '..', 'apps', 'mercato', 'src', 'i18n', `${locale}.json`
  )
  return JSON.parse(fs.readFileSync(dictionaryPath, 'utf8'))
}

describe('dashboard greetings', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('maps every hour of the day to the matching slot', () => {
    expect(Array.from({ length: 24 }, (_, hour) => resolveGreetingSlot(hour))).toEqual([
      ...Array(5).fill('night'),
      ...Array(7).fill('morning'),
      ...Array(5).fill('afternoon'),
      ...Array(5).fill('evening'),
      ...Array(2).fill('night'),
    ])
  })

  it('normalizes hours outside the 0-23 range instead of returning undefined', () => {
    expect(resolveGreetingSlot(-1)).toBe('night')
    expect(resolveGreetingSlot(30)).toBe('morning')
    expect(resolveGreetingSlot(Number.NaN)).toBe('morning')
  })

  it('keys every greeting uniquely under its own slot and always addresses the user', () => {
    const keys = SLOTS.flatMap((slot) =>
      GREETINGS[slot].map((entry) => {
        expect(entry.key.startsWith(`dashboard.greetings.${slot}.`)).toBe(true)
        expect(entry.text).toContain('{{user}}')
        return entry.key
      })
    )
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('reaches every greeting in a pool and clamps rolls to its bounds', () => {
    for (const slot of SLOTS) {
      const pool = GREETINGS[slot]
      expect(pool.map((_, index) => pickGreeting(slot, index / pool.length).key))
        .toEqual(pool.map((entry) => entry.key))
      expect(pickGreeting(slot, 1).key).toBe(pool[pool.length - 1].key)
      expect(pickGreeting(slot, -5).key).toBe(pool[0].key)
      expect(pickGreeting(slot, Number.NaN).key).toBe(pool[0].key)
    }
  })

  it('picks from the slot the local clock is in', () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(23)
    jest.spyOn(Math, 'random').mockReturnValue(0)
    expect(pickGreetingForNow().key).toBe(GREETINGS.night[0].key)
  })

  it('interpolates the greeted name into the translated greeting', () => {
    const greeting = GREETINGS.evening[0]
    const translate = (key: string, fallback?: unknown, params?: Record<string, string | number>) =>
      key === greeting.key ? `Dobry wieczór, ${params?.user}.` : String(fallback)
    expect(formatGreeting(greeting, 'Ada', translate)).toBe('Dobry wieczór, Ada.')
  })

  it('falls back to the English greeting when the dictionary misses the key', () => {
    const greeting = GREETINGS.morning[0]
    const passthrough = (_key: string, fallback?: unknown, params?: Record<string, string | number>) =>
      String(fallback).replace('{{user}}', String(params?.user))
    expect(formatGreeting(greeting, 'Ada', passthrough)).toBe(greeting.text.replace('{{user}}', 'Ada'))
  })

  it('ships a translation for every greeting key in every app locale', () => {
    const keys = SLOTS.flatMap((slot) => GREETINGS[slot].map((entry) => entry.key))
    for (const locale of LOCALES) {
      const dictionary = readAppDictionary(locale)
      const missing = keys.filter((key) => typeof dictionary[key] !== 'string' || !dictionary[key].trim())
      expect({ locale, missing }).toEqual({ locale, missing: [] })
      for (const key of keys) expect(dictionary[key]).toContain('{{user}}')
    }
  })

  it('greets by name, falls back to the email local part, and never to a bare user id', () => {
    expect(resolveGreetedName('Ada Lovelace', 'ada@example.com')).toBe('Ada Lovelace')
    expect(resolveGreetedName('   ', 'ada@example.com')).toBe('ada')
    expect(resolveGreetedName(null, null)).toBe('')
    expect(resolveGreetedName(undefined, '  ')).toBe('')
    expect(resolveGreetedName(null, '@example.com')).toBe('')
  })
})
