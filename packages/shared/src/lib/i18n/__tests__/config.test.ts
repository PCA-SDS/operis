import { defaultLocale, locales, type Locale } from '../config'

describe('supported application locales', () => {
  it('registers supported locales without changing the default locale', () => {
    expect(locales).toEqual<Locale[]>(['en', 'pl', 'es', 'de', 'ko', 'vi', 'fr', 'zh'])
    expect(defaultLocale).toBe('en')
  })
})
