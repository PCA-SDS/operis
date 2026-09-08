import {
  slugifyTpsText,
  sumTpsPrices,
  parseTpsPrice,
  extractTpsDuration,
  hasNestedTpsOptionTree,
  enumerateTpsOptionPaths,
  buildTranslationsPayload,
  type OptionPath,
} from '../mapping'
import type { OptionGroup } from '@open-mercato/core/modules/catalog/data/types'

describe('TPS Migration Mapping Helpers', () => {
  describe('slugifyTpsText', () => {
    it('should slugify basic text', () => {
      expect(slugifyTpsText('Hello World!')).toBe('hello-world')
      expect(slugifyTpsText('   Some  Text   ')).toBe('some-text')
    })
  })

  describe('parseTpsPrice', () => {
    it('should parse numeric price', () => {
      expect(parseTpsPrice(100)).toEqual({ unitPriceGross: '100', priceMin: null, priceMax: null, metadata: null })
    })

    it('should parse range price', () => {
      expect(parseTpsPrice({ kind: 'range', min: 50, max: 100 })).toEqual({
        unitPriceGross: null,
        priceMin: '50',
        priceMax: '100',
        metadata: { kind: 'range', min: 50, max: 100 }
      })
    })

    it('should parse gender price', () => {
      expect(parseTpsPrice({ kind: 'gender', women: 80 })).toEqual({
        unitPriceGross: '80',
        priceMin: null,
        priceMax: null,
        metadata: { kind: 'gender', women: 80 }
      })
      expect(parseTpsPrice({ kind: 'gender', women: 80, men: 100 })).toEqual({
        unitPriceGross: '80',
        priceMin: null,
        priceMax: null,
        metadata: { kind: 'gender', women: 80, men: 100 }
      })
    })

    it('should handle undefined/null', () => {
      expect(parseTpsPrice(undefined)).toEqual({ unitPriceGross: null, priceMin: null, priceMax: null, metadata: null })
    })
  })

  describe('sumTpsPrices', () => {
    it('should sum two numbers', () => {
      expect(sumTpsPrices(100, 50)).toBe(150)
    })

    it('should sum a number and a range to a range', () => {
      expect(sumTpsPrices(100, { kind: 'range', min: 20, max: 40 })).toEqual({
        kind: 'range', min: 120, max: 140
      })
    })

    it('should sum a gender price with missing men to max women', () => {
      expect(sumTpsPrices({ kind: 'gender', women: 80 }, 10)).toBe(90)
    })
    
    it('should return just the min if neither is a range (ignoring men price for variants)', () => {
      expect(sumTpsPrices({ kind: 'gender', women: 80, men: 100 }, 10)).toBe(90)
    })
  })

  describe('extractTpsDuration', () => {
    it('should use explicit duration field', () => {
      expect(extractTpsDuration({ name: 'Test', duration: '45 mins' })).toBe('45 mins')
    })

    it('should parse from name', () => {
      expect(extractTpsDuration({ name: 'Massage 30 mins' })).toBe('30 mins')
    })
    
    it('should parse range from description', () => {
      expect(extractTpsDuration({ name: 'Service', description: 'Takes about 30 - 45 min' })).toBe('30 - 45 mins')
    })
  })

  describe('hasNestedTpsOptionTree', () => {
    it('should detect nested trees', () => {
      const groups: OptionGroup[] = [{
        id: '1', label: 'A', requirement: 'required', mode: 'single',
        options: [
          { id: '1-1', name: 'Opt 1' },
          { id: '1-2', name: 'Opt 2', nextGroups: [{ id: '2', label: 'B', requirement: 'optional', mode: 'single', options: [] }] }
        ]
      }]
      expect(hasNestedTpsOptionTree(groups)).toBe(true)
    })

    it('should return false for flat trees', () => {
      const groups: OptionGroup[] = [{
        id: '1', label: 'A', requirement: 'required', mode: 'single',
        options: [{ id: '1-1', name: 'Opt 1' }]
      }]
      expect(hasNestedTpsOptionTree(groups)).toBe(false)
    })
  })

  describe('enumerateTpsOptionPaths', () => {
    it('should correctly enumerate simple paths', () => {
      const groups: OptionGroup[] = [{
        id: '1', label: 'Color', requirement: 'required', mode: 'single',
        options: [
          { id: 'c1', name: 'Red', price: 10 },
          { id: 'c2', name: 'Blue', price: 20 }
        ]
      }]

      const base: OptionPath = { optionValues: {}, totalPrice: 100, names: [], durations: [] }
      const paths = enumerateTpsOptionPaths(groups, base)
      
      expect(paths).toHaveLength(2)
      expect(paths[0].optionValues).toEqual({ 'Color': 'Red' })
      expect(paths[0].totalPrice).toBe(110)
      expect(paths[0].names).toEqual(['Red'])
      
      expect(paths[1].optionValues).toEqual({ 'Color': 'Blue' })
      expect(paths[1].totalPrice).toBe(120)
    })
  })
})

describe('buildTranslationsPayload', () => {
  it('resolves every TPS locale for a key path present in all of them', () => {
    expect(buildTranslationsPayload({ name: 'common.close' })).toEqual({
      en: { name: 'Close' },
      fr: { name: 'Fermer' },
      vi: { name: 'Đóng' },
      zh: { name: '关闭' },
    })
  })

  it('maps several entity fields from separate key paths in one payload', () => {
    const payload = buildTranslationsPayload({ name: 'common.close', description: 'meta.title' })
    expect(payload.vi).toEqual({ name: 'Đóng', description: 'Privé Spa - Đặt lịch' })
    expect(payload.en).toEqual({ name: 'Close', description: 'Privé Spa - Booking' })
  })

  it('skips fields whose key path is undefined instead of writing an empty value', () => {
    const payload = buildTranslationsPayload({ name: 'common.close', description: undefined })
    for (const locale of Object.keys(payload)) {
      expect(payload[locale]).not.toHaveProperty('description')
    }
  })

  it('omits a locale entirely when it translates none of the requested fields', () => {
    // `contact.clickToCopy` exists in en/vi but not fr/zh — the caller uses the
    // empty payload to decide whether to write an entity_translations row at all.
    const payload = buildTranslationsPayload({ note: 'contact.clickToCopy' })
    expect(Object.keys(payload).sort()).toEqual(['en', 'vi'])
  })

  it('returns an empty payload when nothing resolves, so no translation row is written', () => {
    expect(buildTranslationsPayload({ name: 'no.such.key.at.all' })).toEqual({})
    expect(buildTranslationsPayload({})).toEqual({})
  })

  it('ignores a key path that lands on a group rather than a string', () => {
    expect(buildTranslationsPayload({ name: 'common' })).toEqual({})
  })

  it('does not walk the prototype chain when resolving a key path', () => {
    expect(buildTranslationsPayload({ name: '__proto__.polluted' })).toEqual({})
    expect(buildTranslationsPayload({ name: 'constructor.name' })).toEqual({})
    expect(buildTranslationsPayload({ name: 'common.constructor.name' })).toEqual({})
  })
})
