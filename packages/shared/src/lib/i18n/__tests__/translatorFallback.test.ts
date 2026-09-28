const resolveTranslationsMock = jest.fn()

jest.mock('../server', () => ({
  resolveTranslations: () => resolveTranslationsMock(),
}))

import { resolveTranslatorWithFallback } from '../translatorFallback'

describe('resolveTranslatorWithFallback', () => {
  it('returns the request translator when translations resolve', async () => {
    const translate = (key: string) => `translated:${key}`
    resolveTranslationsMock.mockResolvedValueOnce({ translate })
    await expect(resolveTranslatorWithFallback()).resolves.toBe(translate)
  })

  it('falls back to an empty-dictionary translator when they cannot', async () => {
    resolveTranslationsMock.mockRejectedValueOnce(new Error('outside a request'))
    const translate = await resolveTranslatorWithFallback()
    expect(translate('missing.key', 'Fallback text')).toBe('Fallback text')
  })
})
