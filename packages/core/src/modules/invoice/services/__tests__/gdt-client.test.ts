import { createGdtClient } from '../gdt-client-implementation'
import { GdtProviderError } from '../gdt/errors'

describe('GDT client', () => {
  afterEach(() => jest.restoreAllMocks())

  it('retries network, 429, and 5xx page failures', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: 'ok' }] }), { status: 200 }))
    const client = createGdtClient({ gdtBaseUrl: 'https://gdt.test', gdtRetryBaseDelayMs: 0 })

    await expect(client.fetchPage({ stream: 'sold', token: 'secret', fromDate: '2026-01-01', toDate: '2026-01-01', page: 1, pageSize: 100 }))
      .resolves.toEqual({ items: [{ id: 'ok' }], hasNext: false })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('classifies an expired token as an authentication error', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }))
    const client = createGdtClient({ gdtBaseUrl: 'https://gdt.test' })

    await expect(client.fetchPage({ stream: 'sold', token: 'secret', fromDate: '2026-01-01', toDate: '2026-01-01', page: 1, pageSize: 100 }))
      .rejects.toBeInstanceOf(GdtProviderError)
  })
})
