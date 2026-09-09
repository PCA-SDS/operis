import { z } from 'zod'
import { fetchWithTimeout, resolveTimeoutMs } from '@open-mercato/shared/lib/http/fetchWithTimeout'
import { createLogger } from '@open-mercato/shared/lib/logger'

import { INVOICE_CURRENCY_CODES, type InvoiceCurrencyCode } from '../data/entities'

export const INVOICE_EXCHANGE_RATE_BASE_CURRENCY = 'VND' as const
export const INVOICE_EXCHANGE_RATES_CACHE_TTL_MS = 24 * 60 * 60 * 1000
export const DEFAULT_INVOICE_EXCHANGE_RATE_API_URL = 'https://open.er-api.com/v6/latest/USD'
export const DEFAULT_INVOICE_EXCHANGE_RATE_FETCH_TIMEOUT_MS = 15_000

const logger = createLogger('invoice').child({ component: 'exchange-rates-service' })

const upstreamRateSchema = z.number().finite().positive()
const upstreamExchangeRateResponseSchema = z.object({
  rates: z.record(z.string(), upstreamRateSchema),
}).passthrough()

export type InvoiceExchangeRateItem = {
  currencyCode: InvoiceCurrencyCode
  vndPerUnit: number
}

export type InvoiceExchangeRatesDto = {
  baseCurrency: typeof INVOICE_EXCHANGE_RATE_BASE_CURRENCY
  fetchedAt: string
  stale: boolean
  rates: Record<InvoiceCurrencyCode, InvoiceExchangeRateItem>
}

export type InvoiceExchangeRatesProvider = {
  fetchRates(): Promise<Record<InvoiceCurrencyCode, number>>
}

type CachedExchangeRatesSnapshot = Omit<InvoiceExchangeRatesDto, 'stale'> & {
  expiresAt: number
}

let processLocalSnapshot: CachedExchangeRatesSnapshot | null = null

function resolveProviderUrl(): string {
  const configuredUrl = process.env.EXCHANGE_RATE_API_URL?.trim()
  return configuredUrl && configuredUrl.length > 0 ? configuredUrl : DEFAULT_INVOICE_EXCHANGE_RATE_API_URL
}

function resolveFetchTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.EXCHANGE_RATE_FETCH_TIMEOUT_MS ?? '', 10)
  return resolveTimeoutMs(parsed, DEFAULT_INVOICE_EXCHANGE_RATE_FETCH_TIMEOUT_MS)
}

function cloneSnapshot(snapshot: CachedExchangeRatesSnapshot, stale: boolean): InvoiceExchangeRatesDto {
  return {
    baseCurrency: snapshot.baseCurrency,
    fetchedAt: snapshot.fetchedAt,
    stale,
    rates: Object.fromEntries(
      INVOICE_CURRENCY_CODES.map((currencyCode) => {
        const rate = snapshot.rates[currencyCode]
        return [currencyCode, { currencyCode: rate.currencyCode, vndPerUnit: rate.vndPerUnit }]
      }),
    ) as Record<InvoiceCurrencyCode, InvoiceExchangeRateItem>,
  }
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function requireSupportedRates(rates: Record<string, number>): Record<InvoiceCurrencyCode, number> {
  const supportedRates = {} as Record<InvoiceCurrencyCode, number>

  for (const currencyCode of INVOICE_CURRENCY_CODES) {
    const value = rates[currencyCode]
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`[internal] exchange rate provider returned no usable ${currencyCode} rate`)
    }
    supportedRates[currencyCode] = value
  }

  return supportedRates
}

export class OpenExchangeRatesProvider implements InvoiceExchangeRatesProvider {
  constructor(
    private readonly url: string = resolveProviderUrl(),
    private readonly timeoutMs: number = resolveFetchTimeoutMs(),
  ) {}

  async fetchRates(): Promise<Record<InvoiceCurrencyCode, number>> {
    const response = await fetchWithTimeout(this.url, { timeoutMs: this.timeoutMs })
    if (!response.ok) {
      throw new Error(`[internal] exchange rate provider returned ${response.status}`)
    }

    const payload: unknown = await response.json()
    const parsed = upstreamExchangeRateResponseSchema.parse(payload)

    return requireSupportedRates(parsed.rates)
  }
}

export class InvoiceExchangeRatesUnavailableError extends Error {
  constructor(message = '[internal] invoice exchange rates are unavailable', options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'InvoiceExchangeRatesUnavailableError'
  }
}

export class InvoiceExchangeRatesService {
  constructor(
    private readonly provider: InvoiceExchangeRatesProvider = new OpenExchangeRatesProvider(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getRates(): Promise<InvoiceExchangeRatesDto> {
    const now = this.now()
    const snapshot = processLocalSnapshot

    if (snapshot && snapshot.expiresAt > now.getTime()) {
      return cloneSnapshot(snapshot, false)
    }

    try {
      const upstreamRates = await this.provider.fetchRates()
      const freshSnapshot = this.buildSnapshot(requireSupportedRates(upstreamRates), now)
      processLocalSnapshot = freshSnapshot
      return cloneSnapshot(freshSnapshot, false)
    } catch (err) {
      logger.error('Invoice exchange rate provider failed', {
        providerUrl: resolveProviderUrl(),
        err,
        hasCache: snapshot !== null,
      })

      if (snapshot) {
        logger.warn('Using stale invoice exchange rate snapshot', {
          fetchedAt: snapshot.fetchedAt,
          expiresAt: new Date(snapshot.expiresAt).toISOString(),
        })
        return cloneSnapshot(snapshot, true)
      }

      throw new InvoiceExchangeRatesUnavailableError(
        '[internal] invoice exchange rates are unavailable',
        { cause: err },
      )
    }
  }

  private buildSnapshot(
    upstreamRates: Record<InvoiceCurrencyCode, number>,
    fetchedAt: Date,
  ): CachedExchangeRatesSnapshot {
    const vndRate = upstreamRates[INVOICE_EXCHANGE_RATE_BASE_CURRENCY]
    const rates = {} as Record<InvoiceCurrencyCode, InvoiceExchangeRateItem>

    for (const currencyCode of INVOICE_CURRENCY_CODES) {
      rates[currencyCode] = {
        currencyCode,
        vndPerUnit: currencyCode === INVOICE_EXCHANGE_RATE_BASE_CURRENCY
          ? 1
          : vndRate / upstreamRates[currencyCode],
      }
    }

    return {
      baseCurrency: INVOICE_EXCHANGE_RATE_BASE_CURRENCY,
      fetchedAt: fetchedAt.toISOString(),
      expiresAt: fetchedAt.getTime() + INVOICE_EXCHANGE_RATES_CACHE_TTL_MS,
      rates,
    }
  }
}

export function createInvoiceExchangeRatesService(): InvoiceExchangeRatesService {
  return new InvoiceExchangeRatesService()
}

export const __invoiceExchangeRatesServiceTestUtils = {
  resetProcessLocalCache() {
    processLocalSnapshot = null
  },
  setProcessLocalCache(snapshot: CachedExchangeRatesSnapshot) {
    processLocalSnapshot = snapshot
  },
  getProviderFailureMessage(err: unknown) {
    return toErrorMessage(err)
  },
}
