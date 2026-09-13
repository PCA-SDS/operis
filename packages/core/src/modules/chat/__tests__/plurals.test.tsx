import { tCount } from '../components/plurals'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import en from '../i18n/en.json'
import de from '../i18n/de.json'
import es from '../i18n/es.json'
import ko from '../i18n/ko.json'
import pl from '../i18n/pl.json'

const DICTS: Record<string, Record<string, string>> = { en, de, es, ko, pl }

/** The real resolution order: dictionary hit, else the caller's fallback. */
function translatorFor(locale: string): TranslateFn {
  // An unknown tag has no catalogue; English is what the app falls back to.
  const dict = DICTS[locale] ?? DICTS.en
  return ((key: string, fallbackOrParams?: unknown, maybeParams?: unknown) => {
    const fallback = typeof fallbackOrParams === 'string' ? fallbackOrParams : undefined
    const params = (typeof fallbackOrParams === 'string' ? maybeParams : fallbackOrParams) as
      | Record<string, unknown>
      | undefined
    const template = dict[key] ?? fallback ?? key
    return params
      ? template.replace(/\{(\w+)\}/g, (whole, name) =>
          Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
        )
      : template
  }) as TranslateFn
}

const render = (locale: string, key: string, n: number, fallback = '{count} things') =>
  tCount(translatorFor(locale), locale, key, n, fallback)

/** What the two-form convention produced before this change. */
const legacy = (locale: string, key: string, n: number, fallback = '{count} things') => {
  const t = translatorFor(locale)
  return t(`${key}${n === 1 ? '' : '_plural'}`, fallback, { count: n })
}

const PLURALISED = [
  'chat.badge.unread',
  'chat.list.unreadLabel',
  'chat.pins.count',
  'chat.space.memberCount',
]

describe('tCount', () => {
  describe('Polish, which has three categories', () => {
    // `Intl.PluralRules('pl')`: one for 1, few for 2-4/22-24/32-34, many for
    // 5-21 and 25+. The two-form convention put the *many* wording on every
    // count above one, so the few range read incorrectly on ordinary numbers.
    it('uses the singular at one', () => {
      expect(render('pl', 'chat.space.memberCount', 1)).toBe('1 czlonek'.replace('czlonek', 'członek'))
    })

    it('uses the few form at 2, 3 and 4', () => {
      for (const n of [2, 3, 4]) {
        expect(render('pl', 'chat.space.memberCount', n)).toBe(`${n} członkowie`)
      }
    })

    it('uses the many form from 5 to 21', () => {
      for (const n of [5, 11, 21]) {
        expect(render('pl', 'chat.space.memberCount', n)).toBe(`${n} członków`)
      }
    })

    it('returns to the few form at 22-24, and to many at 25', () => {
      // The bug this fixes is not only small numbers: the categories alternate.
      expect(render('pl', 'chat.space.memberCount', 22)).toBe('22 członkowie')
      expect(render('pl', 'chat.space.memberCount', 25)).toBe('25 członków')
    })

    it('differs from the old behaviour exactly in the few range', () => {
      expect(render('pl', 'chat.space.memberCount', 2)).not.toBe(
        legacy('pl', 'chat.space.memberCount', 2),
      )
      for (const n of [1, 5, 25]) {
        expect(render('pl', 'chat.space.memberCount', n)).toBe(
          legacy('pl', 'chat.space.memberCount', n),
        )
      }
    })
  })

  describe('every other locale renders exactly as it did before', () => {
    // The point of the additive approach: nothing that worked may change.
    for (const locale of ['en', 'de', 'es', 'ko']) {
      it(`${locale} is byte-identical to the two-form result`, () => {
        for (const key of PLURALISED) {
          for (const n of [0, 1, 2, 3, 4, 5, 11, 21, 22, 25, 100]) {
            expect(render(locale, key, n)).toBe(legacy(locale, key, n))
          }
        }
      })
    }
  })

  describe('English', () => {
    it('treats zero as plural', () => {
      // A `> 1` test would have made this singular.
      expect(render('en', 'chat.space.memberCount', 0)).toBe('0 members')
    })

    it('is singular only at one', () => {
      expect(render('en', 'chat.space.memberCount', 1)).toBe('1 member')
      expect(render('en', 'chat.space.memberCount', 2)).toBe('2 members')
    })
  })

  describe('Korean, which has no plural distinction', () => {
    it('uses one wording at every count, varying only the number', () => {
      const one = render('ko', 'chat.space.memberCount', 1)
      const many = render('ko', 'chat.space.memberCount', 5)
      expect(one).toBe('멤버 1명')
      expect(many).toBe('멤버 5명')
      // Same template either side of the digit - no singular/plural split.
      expect(one.replace('1', '#')).toBe(many.replace('5', '#'))
    })
  })

  describe('falling back', () => {
    it('uses the generic plural when a category has no key of its own', () => {
      // Protects every pluralised key elsewhere in the repo that has not been
      // given `_few`/`_many` — they must keep working untouched.
      const t = ((key: string, fallback?: unknown, params?: unknown) => {
        const dict: Record<string, string> = {
          'x.thing': '{count} rzecz',
          'x.thing_plural': '{count} rzeczy',
        }
        const p = (typeof fallback === 'string' ? params : fallback) as Record<string, unknown>
        const template = dict[key] ?? (typeof fallback === 'string' ? fallback : key)
        return template.replace(/\{(\w+)\}/g, (w, n) => (p && n in p ? String(p[n]) : w))
      }) as TranslateFn
      // 2 is `few` in Polish, and `x.thing_few` does not exist.
      expect(tCount(t, 'pl', 'x.thing', 2, '{count} things')).toBe('2 rzeczy')
    })

    it('uses the caller fallback when the base key is absent entirely', () => {
      const t = ((key: string, fallback?: unknown, params?: unknown) => {
        const p = (typeof fallback === 'string' ? params : fallback) as Record<string, unknown>
        const template = typeof fallback === 'string' ? fallback : key
        return template.replace(/\{(\w+)\}/g, (w, n) => (p && n in p ? String(p[n]) : w))
      }) as TranslateFn
      expect(tCount(t, 'en', 'nope.missing', 3, '{count} things')).toBe('3 things')
    })

    it('does not blow up on an unknown locale tag', () => {
      expect(render('zz-not-a-locale', 'chat.space.memberCount', 2)).toBe('2 members')
    })
  })

  it('passes count through without the caller repeating it', () => {
    expect(render('en', 'chat.pins.count', 3)).toContain('3')
  })
})
