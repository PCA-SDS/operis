import type { Locale } from '@open-mercato/shared/lib/i18n/config'
import type { Module } from '@open-mercato/shared/modules/registry'

const loadI18nModulesMock = jest.fn<Promise<Module[]>, [string]>()
const registerModulesMock = jest.fn()
const loadBaseDictionaryMock = jest.fn<Promise<Record<string, unknown>>, [Locale]>()
let createAppDictionaryLoader: typeof import('../register-dictionary-loader').createAppDictionaryLoader

describe('register-dictionary-loader', () => {
  beforeEach(async () => {
    jest.resetModules()
    registerModulesMock.mockReset()
    loadI18nModulesMock.mockReset()
    loadBaseDictionaryMock.mockReset()
    loadBaseDictionaryMock.mockImplementation(async (locale) => ({ locale }))
    jest.doMock('@open-mercato/shared/lib/i18n/server', () => ({
      registerAppDictionaryLoader: jest.fn(),
    }))

    ;({ createAppDictionaryLoader } = await import('../register-dictionary-loader'))
  })

  function testLoader() {
    return createAppDictionaryLoader({
      loadLocaleModules: loadI18nModulesMock,
      loadBaseDictionary: loadBaseDictionaryMock,
      registerLocaleModules: registerModulesMock,
    })
  }

  it('loads only the requested locale shard and registers its module translations', async () => {
    loadI18nModulesMock.mockResolvedValueOnce([
      { id: 'first', translations: { pl: { addTitle: 'Pierwszy', nested: { first: 'jeden' } } } },
      { id: 'second', translations: { pl: { addTitle: 'Drugi', nested: { second: 'dwa' } } } },
    ] as Module[])

    loadBaseDictionaryMock.mockResolvedValueOnce({ addTitle: 'Add', 'api.errors.notFound': 'Nie znaleziono' })
    const dictionary = await testLoader()('pl')

    expect(loadI18nModulesMock).toHaveBeenCalledWith('pl')
    expect(loadI18nModulesMock).toHaveBeenCalledTimes(1)
    expect(dictionary.addTitle).toBe('Add')
    expect(dictionary['api.errors.notFound']).toBe('Nie znaleziono')
    expect(registerModulesMock).toHaveBeenCalledWith([
      { id: 'first', translations: { pl: { addTitle: 'Pierwszy', nested: { first: 'jeden' } } } },
      { id: 'second', translations: { pl: { addTitle: 'Drugi', nested: { second: 'dwa' } } } },
    ])
  })

  it('registers each requested locale shard independently', async () => {
    loadI18nModulesMock
      .mockResolvedValueOnce([
        { id: 'customers', translations: { pl: { customers: { title: 'Klienci' } } } },
      ] as Module[])
      .mockResolvedValueOnce([
        { id: 'customers', translations: { en: { customers: { title: 'Customers' } } } },
      ] as Module[])

    const loader = testLoader()
    await loader('pl')
    await loader('en')

    expect(registerModulesMock).toHaveBeenNthCalledWith(1, [
      { id: 'customers', translations: { pl: { customers: { title: 'Klienci' } } } },
    ])
    expect(registerModulesMock).toHaveBeenNthCalledWith(2, [
      { id: 'customers', translations: { en: { customers: { title: 'Customers' } } } },
    ])
  })

  it('does not replace the runtime module registry when a locale has no module translations', async () => {
    loadI18nModulesMock.mockResolvedValueOnce([])

    loadBaseDictionaryMock.mockResolvedValueOnce({ 'api.errors.notFound': 'Nicht gefunden' })
    const dictionary = await testLoader()('de')

    expect(dictionary['api.errors.notFound']).toBe('Nicht gefunden')
    expect(registerModulesMock).not.toHaveBeenCalled()
  })
})

/**
 * The app dictionary switch is the only thing that turns a locale in `locales`
 * into real copy. PR #267 added `apps/mercato/src/i18n/{vi,fr,zh}.json` without
 * adding their cases, so all three fell through to `default:` and served the
 * English dictionary while the files sat unreferenced. This pins the switch to
 * the shared locale config so the next locale cannot repeat it.
 */
describe('app dictionary coverage', () => {
  it('resolves a distinct dictionary for every configured locale', async () => {
    const { locales } = await import('@open-mercato/shared/lib/i18n/config')

    for (const locale of locales) {
      jest.doMock(`../../../i18n/${locale}.json`, () => ({ __esModule: true, default: { __locale: locale } }))
    }
    jest.resetModules()
    jest.doMock('@open-mercato/shared/lib/i18n/server', () => ({ registerAppDictionaryLoader: jest.fn() }))
    const mod = await import('../register-dictionary-loader')

    const loader = mod.createAppDictionaryLoader({
      loadLocaleModules: async () => [],
      registerLocaleModules: jest.fn(),
    })

    for (const locale of locales) {
      await expect(loader(locale)).resolves.toEqual({ __locale: locale })
    }
  })
})
