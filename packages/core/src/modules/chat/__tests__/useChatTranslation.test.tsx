/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'

const flash = jest.fn()
const translateMessages = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: unknown) =>
    typeof fallback === 'string' ? fallback : String(key),
  useLocale: () => 'en',
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => flash(...args) }))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(),
  }),
}))

jest.mock('../components/api', () => ({
  chatApi: {
    translateMessages: (...args: unknown[]) => translateMessages(...args),
  },
}))

import { useChatTranslation } from '../components/hooks'

const CONVERSATION = 'c0000000-0000-4000-8000-000000000000'

/** One row as the translate endpoint returns it. */
function row(messageId: string, body: string | null, extra: Record<string, unknown> = {}) {
  return { messageId, body, sourceLocale: 'fr', cached: false, ...extra }
}

/** The ids the engine was asked for, per call, in order. */
function requestedIds(): string[][] {
  return translateMessages.mock.calls.map((call) => call[1] as string[])
}

/** The target locale of each call, in order. */
function requestedLocales(): string[] {
  return translateMessages.mock.calls.map((call) => call[2] as string)
}

beforeEach(() => {
  flash.mockReset()
  translateMessages.mockReset()
})

describe('useChatTranslation', () => {
  /**
   * The bug this pins: the cache was keyed on the message id alone, so after
   * switching language the hook answered "already have it" with the PREVIOUS
   * language's words. The header read FR, the transcript stayed Vietnamese, and
   * no request was ever sent.
   */
  it('does not serve one language when the reader asked for another', async () => {
    translateMessages.mockImplementation(async (_c: string, ids: string[], locale: string) => ({
      translations: ids.map((id) => row(id, `[${locale}] hello`)),
    }))

    const { result, rerender } = renderHook(
      ({ locale }: { locale: string }) => useChatTranslation(CONVERSATION, locale),
      { initialProps: { locale: 'vi' } },
    )

    await act(async () => {
      await result.current.translate(['m1'])
    })
    expect(result.current.translations.get('m1')?.body).toBe('[vi] hello')

    rerender({ locale: 'fr' })
    // The Vietnamese row must not be visible under a French reading language.
    expect(result.current.translations.get('m1')).toBeUndefined()

    await act(async () => {
      await result.current.translate(['m1'])
    })
    expect(requestedLocales()).toEqual(['vi', 'fr'])
    expect(result.current.translations.get('m1')?.body).toBe('[fr] hello')
  })

  it('asks once for a language it already holds', async () => {
    translateMessages.mockImplementation(async (_c: string, ids: string[]) => ({
      translations: ids.map((id) => row(id, 'bonjour')),
    }))

    const { result } = renderHook(() => useChatTranslation(CONVERSATION, 'fr'))

    await act(async () => {
      await result.current.translate(['m1'])
    })
    await act(async () => {
      await result.current.translate(['m1'])
    })

    expect(translateMessages).toHaveBeenCalledTimes(1)
  })

  /**
   * Whole-conversation mode is sticky, so a message that arrives after it was
   * switched on has to be translated too. Without this a new message rendered
   * in its original language beside translated ones -- the broken-looking state
   * stickiness exists to prevent.
   */
  it('translates messages that arrive while whole-conversation mode is on', async () => {
    translateMessages.mockImplementation(async (_c: string, ids: string[]) => ({
      translations: ids.map((id) => row(id, `translated ${id}`)),
    }))

    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] | null }) => useChatTranslation(CONVERSATION, 'en', ids),
      { initialProps: { ids: ['m1'] as string[] | null } },
    )

    await waitFor(() => expect(result.current.translations.get('m1')?.body).toBe('translated m1'))

    rerender({ ids: ['m1', 'm2'] })

    await waitFor(() => expect(result.current.translations.get('m2')?.body).toBe('translated m2'))
    // Only the new one is fetched; the first is already held.
    expect(requestedIds()).toEqual([['m1'], ['m2']])
    expect(result.current.showing.has('m2')).toBe(true)
  })

  /**
   * The auto-translate effect re-runs whenever state settles. A failure that is
   * not remembered is therefore requested again immediately, and an engine that
   * is down is hammered for as long as the conversation stays open.
   */
  it('does not retry a failed request in a loop', async () => {
    translateMessages.mockRejectedValue(new Error('engine down'))

    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] | null }) => useChatTranslation(CONVERSATION, 'en', ids),
      { initialProps: { ids: ['m1'] as string[] | null } },
    )

    await waitFor(() => expect(translateMessages).toHaveBeenCalledTimes(1))

    rerender({ ids: ['m1'] })
    await act(async () => {
      await Promise.resolve()
    })

    expect(translateMessages).toHaveBeenCalledTimes(1)
    expect(result.current.translations.get('m1')).toBeUndefined()
  })

  /**
   * `pending` is state, so it is not readable until the next render. Two
   * callers deciding in the same tick both saw an empty set and both asked.
   */
  it('issues one request when two callers ask for the same message at once', async () => {
    translateMessages.mockImplementation(async (_c: string, ids: string[]) => ({
      translations: ids.map((id) => row(id, 'bonjour')),
    }))

    const { result } = renderHook(() => useChatTranslation(CONVERSATION, 'fr'))

    await act(async () => {
      await Promise.all([result.current.translate(['m1']), result.current.translate(['m1'])])
    })

    expect(translateMessages).toHaveBeenCalledTimes(1)
  })

  /**
   * Every reason a translation produced nothing used to be a silent no-op, so
   * "the engine is not deployed" and "this is already your language" were both
   * indistinguishable from a dead button.
   */
  it('says why nothing came back, including on a repeat press', async () => {
    translateMessages.mockImplementation(async (_c: string, ids: string[]) => ({
      translations: ids.map((id) => row(id, null, { sourceLocale: 'fr', skipped: 'same-language' })),
    }))

    const { result } = renderHook(() => useChatTranslation(CONVERSATION, 'fr'))

    await act(async () => {
      await result.current.translate(['m1'])
    })
    expect(flash).toHaveBeenCalledWith('Already in your reading language.', 'info')

    flash.mockClear()
    // Nothing is requested the second time, but the reader still gets told.
    await act(async () => {
      await result.current.translate(['m1'])
    })
    expect(translateMessages).toHaveBeenCalledTimes(1)
    expect(flash).toHaveBeenCalledWith('Already in your reading language.', 'info')
  })

  it('reports an engine that is not deployed differently from one that failed', async () => {
    translateMessages.mockImplementation(async (_c: string, ids: string[]) => ({
      translations: ids.map((id) => row(id, null, { sourceLocale: null, skipped: 'unavailable' })),
    }))

    const { result } = renderHook(() => useChatTranslation(CONVERSATION, 'fr'))

    await act(async () => {
      await result.current.translate(['m1'])
    })

    expect(flash).toHaveBeenCalledWith('Translation is not available on this deployment.', 'error')
  })

  /**
   * A translation belongs to a transcript. Carrying the map across would show
   * one conversation's words under another conversation's message ids.
   */
  it('forgets everything when the conversation changes', async () => {
    translateMessages.mockImplementation(async (_c: string, ids: string[]) => ({
      translations: ids.map((id) => row(id, 'bonjour')),
    }))

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useChatTranslation(id, 'fr'),
      { initialProps: { id: CONVERSATION } },
    )

    await act(async () => {
      await result.current.translate(['m1'])
    })
    expect(result.current.translations.get('m1')).toBeTruthy()

    rerender({ id: 'c1111111-1111-4111-8111-111111111111' })

    await waitFor(() => expect(result.current.translations.size).toBe(0))
    expect(result.current.showing.size).toBe(0)
  })
})
