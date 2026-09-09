const mockFetchWithTimeout = jest.fn()

jest.mock('@open-mercato/shared/lib/http/fetchWithTimeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => mockFetchWithTimeout(...args),
  resolveTimeoutMs: (value: number | undefined, fallback = 15_000) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback,
}))

import {
  DEFAULT_INVOICE_EXCHANGE_RATE_API_URL,
  INVOICE_EXCHANGE_RATES_CACHE_TTL_MS,
  InvoiceExchangeRatesService,
  InvoiceExchangeRatesUnavailableError,
  OpenExchangeRatesProvider,
  __invoiceExchangeRatesServiceTestUtils,
  type InvoiceExchangeRatesProvider,
} from '../exchange-rates-service'
import type { InvoiceCurrencyCode } from '../../data/entities'

const baseRates: Record<InvoiceCurrencyCode, number> = {
  USD: 1,
  EUR: 0.8,
  GBP: 0.7,
  SGD: 1.3,
  AUD: 1.5,
  JPY: 150,
  CNY: 7,
  KRW: 1300,
  THB: 35,
  VND: 25000,
}

function createProvider(overrides: {
  fetchRates?: jest.Mock
} = {}): InvoiceExchangeRatesProvider {
  return {
    fetchRates: overrides.fetchRates ?? jest.fn().mockResolvedValue(baseRates),
  }
}

function response(body: unknown, init: { status?: number; ok?: boolean; statusText?: string } = {}) {
  return {
    ok: init.ok ?? (init.status ? init.status >= 200 && init.status < 300 : true),
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response
}

describe('InvoiceExchangeRatesService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    __invoiceExchangeRatesServiceTestUtils.resetProcessLocalCache()
    delete process.env.EXCHANGE_RATE_API_URL
    delete process.env.EXCHANGE_RATE_FETCH_TIMEOUT_MS
  })

  it('returns VND exactly as 1 and converts foreign currencies with the canonical formula', async () => {
    const service = new InvoiceExchangeRatesService(
      createProvider(),
      () => new Date('2026-01-01T00:00:00.000Z'),
    )

    const result = await service.getRates()

    expect(result).toMatchObject({
      baseCurrency: 'VND',
      fetchedAt: '2026-01-01T00:00:00.000Z',
      stale: false,
    })
    expect(result.rates.VND).toEqual({ currencyCode: 'VND', vndPerUnit: 1 })
    expect(result.rates.USD.vndPerUnit).toBe(25000 / 1)
    expect(result.rates.EUR.vndPerUnit).toBe(25000 / 0.8)
    expect(result.rates.JPY.vndPerUnit).toBe(25000 / 150)
  })

  it('reuses a fresh process-local snapshot without calling the provider again', async () => {
    const provider = createProvider()
    const service = new InvoiceExchangeRatesService(
      provider,
      () => new Date('2026-01-01T00:00:00.000Z'),
    )

    const first = await service.getRates()
    const second = await service.getRates()

    expect(provider.fetchRates).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
    expect(second).not.toBe(first)
  })

  it('uses stale cache when the provider fails after the fresh TTL expires', async () => {
    const fetchRates = jest.fn()
      .mockResolvedValueOnce(baseRates)
      .mockRejectedValueOnce(new Error('provider down'))
    let now = new Date('2026-01-01T00:00:00.000Z')
    const service = new InvoiceExchangeRatesService(
      createProvider({ fetchRates }),
      () => now,
    )

    const fresh = await service.getRates()
    now = new Date(fresh.fetchedAt)
    now = new Date(now.getTime() + INVOICE_EXCHANGE_RATES_CACHE_TTL_MS + 1)
    const stale = await service.getRates()

    expect(fetchRates).toHaveBeenCalledTimes(2)
    expect(stale).toEqual({ ...fresh, stale: true })
  })

  it('returns service unavailable when the provider fails and no cache exists', async () => {
    const service = new InvoiceExchangeRatesService(
      createProvider({ fetchRates: jest.fn().mockRejectedValue(new Error('provider down')) }),
      () => new Date('2026-01-01T00:00:00.000Z'),
    )

    await expect(service.getRates()).rejects.toBeInstanceOf(InvoiceExchangeRatesUnavailableError)
  })

  it('does not cache malformed provider data', async () => {
    const malformedRates = {
      ...baseRates,
      VND: 0,
    } as unknown as Record<InvoiceCurrencyCode, number>
    const fetchRates = jest.fn()
      .mockResolvedValueOnce(malformedRates)
      .mockResolvedValueOnce(baseRates)
    const service = new InvoiceExchangeRatesService(
      createProvider({ fetchRates }),
      () => new Date('2026-01-01T00:00:00.000Z'),
    )

    await expect(service.getRates()).rejects.toBeInstanceOf(InvoiceExchangeRatesUnavailableError)
    await expect(service.getRates()).resolves.toMatchObject({ stale: false })
    expect(fetchRates).toHaveBeenCalledTimes(2)
  })
})

describe('OpenExchangeRatesProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    __invoiceExchangeRatesServiceTestUtils.resetProcessLocalCache()
    delete process.env.EXCHANGE_RATE_API_URL
    delete process.env.EXCHANGE_RATE_FETCH_TIMEOUT_MS
  })

  it('accepts a valid open.er-api style payload', async () => {
    mockFetchWithTimeout.mockResolvedValue(response({
      result: 'success',
      base_code: 'USD',
      time_last_update_unix: 1767225600,
      rates: baseRates,
    }))
    const provider = new OpenExchangeRatesProvider()

    await expect(provider.fetchRates()).resolves.toEqual(baseRates)

    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      DEFAULT_INVOICE_EXCHANGE_RATE_API_URL,
      { timeoutMs: 15_000 },
    )
  })

  it('uses configured upstream URL and timeout', async () => {
    process.env.EXCHANGE_RATE_API_URL = 'https://rates.example.test/latest'
    process.env.EXCHANGE_RATE_FETCH_TIMEOUT_MS = '2500'
    mockFetchWithTimeout.mockResolvedValue(response({ rates: baseRates }))
    const provider = new OpenExchangeRatesProvider()

    await provider.fetchRates()

    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      'https://rates.example.test/latest',
      { timeoutMs: 2500 },
    )
  })

  it('rejects incomplete or invalid upstream data', async () => {
    mockFetchWithTimeout.mockResolvedValue(response({
      rates: {
        ...baseRates,
        EUR: 0,
      },
    }))
    const provider = new OpenExchangeRatesProvider()

    await expect(provider.fetchRates()).rejects.toThrow()
  })

  it('rejects non-success provider responses', async () => {
    mockFetchWithTimeout.mockResolvedValue(response(
      { error: 'limited' },
      { status: 429, ok: false, statusText: 'Too Many Requests' },
    ))
    const provider = new OpenExchangeRatesProvider()

    await expect(provider.fetchRates()).rejects.toThrow('[internal] exchange rate provider returned 429')
  })
})
