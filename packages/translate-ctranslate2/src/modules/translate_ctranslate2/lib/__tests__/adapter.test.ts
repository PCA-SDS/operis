import { createCTranslate2Provider, PROVIDER_ID } from '../adapter'

const BASE = 'http://translation.test:8080'

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const fn = jest.fn(impl as never)
  ;(globalThis as unknown as { fetch: unknown }).fetch = fn
  return fn
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  jest.restoreAllMocks()
})

describe('supports', () => {
  const provider = createCTranslate2Provider({ baseUrl: BASE })

  it('accepts the pairings this deployment exists for', () => {
    // en/fr/vi in every direction, including fr<->vi, which M2M100 handles
    // directly rather than pivoting through English.
    for (const [from, to] of [
      ['en', 'fr'], ['fr', 'en'], ['en', 'vi'], ['vi', 'en'], ['fr', 'vi'], ['vi', 'fr'],
    ]) {
      expect(provider.supports(from, to)).toBe(true)
    }
  })

  it('accepts an unknown source, because the engine detects it', () => {
    expect(provider.supports(undefined, 'vi')).toBe(true)
  })

  it('refuses a target it cannot serve, rather than guessing', () => {
    // A refusal the caller can show beats a confident translation into a
    // language the model was never asked to learn.
    expect(provider.supports('en', 'xx')).toBe(false)
    expect(provider.supports('xx', 'en')).toBe(false)
  })
})

describe('translate', () => {
  it('sends snake_case to the service and returns the mapped result', async () => {
    const fetchMock = mockFetch(() =>
      ok({ body: 'Bonjour', source_locale: 'en', model_revision: 'm2m100_418m-int8', detected_confidence: 0.98 }),
    )
    const provider = createCTranslate2Provider({ baseUrl: BASE })
    const result = await provider.translate({ text: 'Hello', targetLocale: 'fr' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/translate`)
    expect(JSON.parse(String(init.body))).toEqual({ text: 'Hello', target_locale: 'fr', source_locale: undefined })

    expect(result).toEqual({
      body: 'Bonjour',
      sourceLocale: 'en',
      provider: PROVIDER_ID,
      modelRevision: 'm2m100_418m-int8',
    })
  })

  it('strips a trailing slash from the base url rather than double-slashing', async () => {
    const fetchMock = mockFetch(() => ok({ body: 'x', source_locale: 'en' }))
    await createCTranslate2Provider({ baseUrl: `${BASE}///` }).translate({ text: 'a', targetLocale: 'fr' })
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/translate`)
  })

  it('refuses a low-confidence detection instead of returning fluent nonsense', async () => {
    // A wrong detection yields a translation that reads perfectly and means
    // something else - the failure mode with no visible symptom.
    mockFetch(() => ok({ body: 'anything', source_locale: 'tr', detected_confidence: 0.2 }))
    const provider = createCTranslate2Provider({ baseUrl: BASE, minConfidence: 0.5 })
    await expect(provider.translate({ text: 'ok', targetLocale: 'fr' })).rejects.toThrow(/confidence/i)
  })

  it('trusts a caller-supplied source without applying the confidence gate', async () => {
    mockFetch(() => ok({ body: 'Bonjour', source_locale: 'en', detected_confidence: 0.1 }))
    const provider = createCTranslate2Provider({ baseUrl: BASE, minConfidence: 0.9 })
    await expect(
      provider.translate({ text: 'Hello', targetLocale: 'fr', sourceLocale: 'en' }),
    ).resolves.toMatchObject({ body: 'Bonjour' })
  })

  it('surfaces a non-200 with its status', async () => {
    mockFetch(() => new Response('model not loaded', { status: 503 }))
    const provider = createCTranslate2Provider({ baseUrl: BASE })
    await expect(provider.translate({ text: 'a', targetLocale: 'fr' })).rejects.toThrow(/503/)
  })

  it('rejects a payload it does not recognise rather than storing junk', async () => {
    // A cache row is durable; a malformed response must never become one.
    mockFetch(() => ok({ unexpected: true }))
    const provider = createCTranslate2Provider({ baseUrl: BASE })
    await expect(provider.translate({ text: 'a', targetLocale: 'fr' })).rejects.toThrow(/unrecognised/i)
  })

  it('gives up rather than hanging when the engine does not answer', async () => {
    mockFetch((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      }) as Promise<Response>,
    )
    const provider = createCTranslate2Provider({ baseUrl: BASE, timeoutMs: 20 })
    await expect(provider.translate({ text: 'a', targetLocale: 'fr' })).rejects.toThrow()
  })

  it('honours a caller abort', async () => {
    mockFetch((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      }) as Promise<Response>,
    )
    const controller = new AbortController()
    const provider = createCTranslate2Provider({ baseUrl: BASE, timeoutMs: 10_000 })
    const pending = provider.translate({ text: 'a', targetLocale: 'fr' }, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow()
  })
})

describe('healthcheck', () => {
  it('reports the model revision when the engine is up', async () => {
    mockFetch(() => ok({ ok: true, model_revision: 'm2m100_418m-int8' }))
    await expect(createCTranslate2Provider({ baseUrl: BASE }).healthcheck?.()).resolves.toEqual({
      ok: true,
      detail: 'm2m100_418m-int8',
    })
  })

  it('reports unhealthy rather than throwing when it cannot be reached', async () => {
    // The health surface polls this; an exception there would read as a broken
    // health check rather than a down engine.
    mockFetch(() => { throw new Error('ECONNREFUSED') })
    await expect(createCTranslate2Provider({ baseUrl: BASE }).healthcheck?.()).resolves.toMatchObject({ ok: false })
  })
})
