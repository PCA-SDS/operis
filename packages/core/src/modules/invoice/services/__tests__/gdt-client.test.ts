import { createGdtClient } from '../gdt-client-implementation'
import { GdtProviderError } from '../gdt/errors'

describe('GDT client', () => {
  afterEach(() => jest.restoreAllMocks())

  it('retries network, 429, and 5xx page failures', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ datas: [{ id: 'ok' }] }), { status: 200 }))
    const client = createGdtClient({ gdtBaseUrl: 'https://gdt.test', gdtRetryBaseDelayMs: 0 })

    await expect(client.fetchPage({ stream: 'sold', token: 'secret', fromDate: '2026-01-01', toDate: '2026-01-01', pageSize: 15 }))
      .resolves.toEqual({ items: [{ id: 'ok' }], nextCursor: undefined })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[2]?.[0]).toBe('https://gdt.test/query/invoices/sold?search=tdlap%3Dge%3D01%2F01%2F2026T00%3A00%3A00%3Btdlap%3Dle%3D01%2F01%2F2026T23%3A59%3A59&size=15&sort=tdlap%3Adesc')
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ headers: { authorization: 'Bearer secret', accept: 'application/json', 'user-agent': 'pca-erp-invoice-sync/1.0' } })
  })

  it('classifies an expired token as an authentication error', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }))
    const client = createGdtClient({ gdtBaseUrl: 'https://gdt.test' })

    await expect(client.fetchPage({ stream: 'sold', token: 'secret', fromDate: '2026-01-01', toDate: '2026-01-01', pageSize: 15 }))
      .rejects.toBeInstanceOf(GdtProviderError)
  })

  it('uses the purchase query and processing filter', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ datas: [], state: 'next' }), { status: 200 }))
    const client = createGdtClient({ gdtBaseUrl: 'https://gdt.test' })

    await client.fetchPage({ stream: 'purchased', token: 'secret', fromDate: '2026-08-17', toDate: '2026-09-16', pageSize: 15 })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://gdt.test/query/invoices/purchase?search=tdlap%3Dge%3D17%2F08%2F2026T00%3A00%3A00%3Btdlap%3Dle%3D16%2F09%2F2026T23%3A59%3A59%3Bttxly%3D%3D5&size=15&sort=tdlap%3Adesc')
  })

  it('forwards the CAPTCHA session cookie during authentication', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ key: 'captcha-key', content: '<svg />' }), { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'connect.sid=session-value; Path=/; HttpOnly' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'token-value' }), { status: 200 }))
    const client = createGdtClient({ gdtBaseUrl: 'https://gdt.test' })

    const captcha = await client.fetchCaptcha()
    await expect(client.authenticate({ mst: '0317862756', password: 'secret', captchaKey: captcha.key, captchaSolution: 'XKB8BM', sessionCookie: captcha.sessionCookie }))
      .resolves.toMatchObject({ kind: 'success', token: 'token-value' })

    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ headers: expect.objectContaining({ cookie: 'connect.sid=session-value' }) })
  })

  it('treats GDT 403 authentication responses as retryable login failures', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 'INVALID_CREDENTIALS' }), { status: 403 }))
    const client = createGdtClient({ gdtBaseUrl: 'https://gdt.test' })

    await expect(client.authenticate({ mst: '0317862756', password: 'secret', captchaKey: 'captcha-key', captchaSolution: 'XKB8BM' }))
      .resolves.toEqual({ kind: 'bad_credentials' })
  })
})
