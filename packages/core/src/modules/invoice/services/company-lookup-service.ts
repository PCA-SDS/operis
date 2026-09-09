import { createHash } from 'node:crypto'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { fetchWithTimeout, resolveTimeoutMs } from '@open-mercato/shared/lib/http/fetchWithTimeout'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { z } from 'zod'

import { InvoiceCompanyRegistry } from '../data/entities'
import { invoiceScopeWhere, type InvoiceScope } from '../data/scope'
import {
  INVOICE_COMPANY_LOOKUP_CACHE_TTL_DAYS,
  invoiceCompanyLookupCachePayloadSchema,
  invoiceCompanyLookupCompanySchema,
  invoiceCompanyLookupCountrySchema,
  invoiceCompanyLookupIdentifierSchema,
  type InvoiceCompanyLookupCachePayload,
  type InvoiceCompanyLookupCompany,
  type InvoiceCompanyLookupProviderKey,
  type InvoiceCompanyLookupResult,
} from '../data/validators'
import { assertInvoiceCompanyRegistryPayloadEncryptionConfigured } from '../encryption'

const logger = createLogger('invoice').child({ component: 'company-lookup-service' })

export const INVOICE_COMPANY_LOOKUP_CACHE_TTL_MS = INVOICE_COMPANY_LOOKUP_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000
export const DEFAULT_INVOICE_COMPANY_LOOKUP_FETCH_TIMEOUT_MS = 15_000
export const DEFAULT_INVOICE_VIETQR_COMPANY_LOOKUP_URL = 'https://api.vietqr.io/v2/business'
export const DEFAULT_INVOICE_DATA_GOV_SG_UEN_LOOKUP_URL = 'https://data.gov.sg/api/action/datastore_search'

const vietQrBusinessSchema = z.object({
  name: z.string().trim().min(1),
  taxCode: z.string().trim().min(1).optional().nullable(),
  address: z.string().trim().optional().nullable(),
  status: z.string().trim().optional().nullable(),
  updatedAt: z.string().trim().optional().nullable(),
}).passthrough()

const vietQrResponseSchema = z.object({
  data: z.union([vietQrBusinessSchema, z.array(vietQrBusinessSchema)]).optional().nullable(),
}).passthrough()

const dataGovRecordSchema = z.object({
  entity_name: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  uen: z.string().trim().optional(),
  reg_no: z.string().trim().optional(),
  entity_status: z.string().trim().optional().nullable(),
  status: z.string().trim().optional().nullable(),
  registered_address: z.string().trim().optional().nullable(),
  address: z.string().trim().optional().nullable(),
  updated_at: z.string().trim().optional().nullable(),
}).passthrough()

const dataGovResponseSchema = z.object({
  result: z.object({
    records: z.array(dataGovRecordSchema).default([]),
  }).passthrough(),
}).passthrough()

export type CompanyRegistryProviderResult = {
  company: InvoiceCompanyLookupCompany
  rawProviderResponse: unknown
  fetchedAt: Date
}

export type CompanyRegistryProvider = {
  providerKey: InvoiceCompanyLookupProviderKey
  countryCode: 'VN' | 'SG'
  lookup(identifier: string): Promise<CompanyRegistryProviderResult | null>
}

export class InvoiceCompanyLookupUnavailableError extends Error {
  constructor(message = '[internal] invoice company lookup is unavailable', options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'InvoiceCompanyLookupUnavailableError'
  }
}

function resolveTimeout(): number {
  const parsed = Number.parseInt(process.env.COMPANY_LOOKUP_FETCH_TIMEOUT_MS ?? '', 10)
  return resolveTimeoutMs(parsed, DEFAULT_INVOICE_COMPANY_LOOKUP_FETCH_TIMEOUT_MS)
}

function normalizeVietnamMst(identifier: string): string {
  return identifier.replace(/[\s-]/g, '')
}

function normalizeSingaporeUen(identifier: string): string {
  return identifier.replace(/\s/g, '').toUpperCase()
}

function normalizeLookupIdentifier(countryCode: string, identifier: string): string {
  const parsed = invoiceCompanyLookupIdentifierSchema.parse(identifier)
  if (countryCode === 'VN') return normalizeVietnamMst(parsed)
  if (countryCode === 'SG') return normalizeSingaporeUen(parsed)
  return parsed.toUpperCase()
}

function validateCountryIdentifier(countryCode: string, identifier: string): void {
  if (countryCode === 'VN' && !/^\d{10}(\d{3})?$/.test(identifier)) {
    throw badRequest('[internal] Invalid Vietnam MST')
  }
  if (countryCode === 'SG' && !/^(\d{8}[A-Z]|[A-Z]\d{2}[A-Z]{2}\d{4}[A-Z]|[A-Z]\d{8}[A-Z])$/.test(identifier)) {
    throw badRequest('[internal] Invalid Singapore UEN')
  }
}

function toSafeIdentifierHash(identifier: string): string {
  return createHash('sha256').update(identifier).digest('hex').slice(0, 12)
}

function safeLookupLogFields(provider: string, countryCode: string, identifier: string): Record<string, unknown> {
  return {
    provider,
    countryCode,
    identifierHash: toSafeIdentifierHash(identifier),
    identifierLast4: identifier.slice(-4),
  }
}

function parseProviderDate(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

async function readJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function selectVietQrBusiness(payload: unknown): z.infer<typeof vietQrBusinessSchema> | null {
  const parsed = vietQrResponseSchema.parse(payload)
  if (Array.isArray(parsed.data)) return parsed.data[0] ?? null
  return parsed.data ?? null
}

function resolveVietQrUrl(identifier: string): string {
  const base = process.env.COMPANY_LOOKUP_VIETQR_URL?.trim() || DEFAULT_INVOICE_VIETQR_COMPANY_LOOKUP_URL
  const url = new URL(base)
  if (!url.searchParams.has('taxCode')) url.searchParams.set('taxCode', identifier)
  return url.toString()
}

function resolveDataGovSgUrl(identifier: string): string {
  const base = process.env.COMPANY_LOOKUP_DATA_GOV_SG_URL?.trim() || DEFAULT_INVOICE_DATA_GOV_SG_UEN_LOOKUP_URL
  const url = new URL(base)
  if (!url.searchParams.has('q')) url.searchParams.set('q', identifier)
  return url.toString()
}

export class VietQrCompanyRegistryProvider implements CompanyRegistryProvider {
  readonly providerKey = 'vietqr' as const
  readonly countryCode = 'VN' as const

  async lookup(identifier: string): Promise<CompanyRegistryProviderResult | null> {
    const fetchedAt = new Date()
    const response = await fetchWithTimeout(resolveVietQrUrl(identifier), { timeoutMs: resolveTimeout() })
    const payload = await readJsonSafe(response)
    if (!response.ok) throw new Error(`[internal] VietQR lookup returned ${response.status}`)

    const business = selectVietQrBusiness(payload)
    if (!business) return null

    return {
      company: invoiceCompanyLookupCompanySchema.parse({
        name: business.name,
        registrationNumber: identifier,
        taxCode: business.taxCode ?? identifier,
        address: business.address ?? null,
        status: business.status ?? null,
        sourceUpdatedAt: parseProviderDate(business.updatedAt),
      }),
      rawProviderResponse: payload,
      fetchedAt,
    }
  }
}

export class DataGovSgCompanyRegistryProvider implements CompanyRegistryProvider {
  readonly providerKey = 'data_gov_sg' as const
  readonly countryCode = 'SG' as const

  async lookup(identifier: string): Promise<CompanyRegistryProviderResult | null> {
    const fetchedAt = new Date()
    const response = await fetchWithTimeout(resolveDataGovSgUrl(identifier), { timeoutMs: resolveTimeout() })
    const payload = await readJsonSafe(response)
    if (!response.ok) throw new Error(`[internal] data.gov.sg UEN lookup returned ${response.status}`)

    const parsed = dataGovResponseSchema.parse(payload)
    const record = parsed.result.records[0]
    if (!record) return null

    return {
      company: invoiceCompanyLookupCompanySchema.parse({
        name: record.entity_name ?? record.name,
        registrationNumber: record.uen ?? record.reg_no ?? identifier,
        taxCode: null,
        address: record.registered_address ?? record.address ?? null,
        status: record.entity_status ?? record.status ?? null,
        sourceUpdatedAt: parseProviderDate(record.updated_at),
      }),
      rawProviderResponse: payload,
      fetchedAt,
    }
  }
}

export class InvoiceCompanyLookupService {
  constructor(
    private readonly em: EntityManager,
    private readonly providers: CompanyRegistryProvider[] = [
      new VietQrCompanyRegistryProvider(),
      new DataGovSgCompanyRegistryProvider(),
    ],
    private readonly now: () => Date = () => new Date(),
  ) {}

  async lookup(scope: InvoiceScope, input: { country: string; identifier: string }): Promise<InvoiceCompanyLookupResult> {
    const countryCode = invoiceCompanyLookupCountrySchema.parse(input.country)
    const identifier = normalizeLookupIdentifier(countryCode, input.identifier)
    validateCountryIdentifier(countryCode, identifier)

    const provider = this.providers.find((candidate) => candidate.countryCode === countryCode)
    if (!provider) {
      return {
        mode: 'manual',
        countryCode,
        identifier,
        provider: null,
        fetchedAt: null,
        stale: false,
        company: null,
      }
    }

    const cached = await this.readCache(scope, countryCode, provider.providerKey, identifier)
    if (cached && this.isFresh(cached.row.fetchedAt)) {
      return this.resultFromCache(cached.row, cached.payload, false)
    }

    try {
      const providerResult = await provider.lookup(identifier)
      if (!providerResult) {
        throw badRequest('[internal] Company registry identifier was not found')
      }
      const row = await this.writeProviderResult(scope, countryCode, provider.providerKey, identifier, providerResult)
      return this.resultFromCache(row, row.payload as InvoiceCompanyLookupCachePayload, false)
    } catch (err) {
      if (cached) {
        logger.warn('Using stale invoice company lookup cache', {
          ...safeLookupLogFields(provider.providerKey, countryCode, identifier),
          fetchedAt: cached.row.fetchedAt.toISOString(),
          ageDays: Math.floor((this.now().getTime() - cached.row.fetchedAt.getTime()) / (24 * 60 * 60 * 1000)),
        })
        return this.resultFromCache(cached.row, cached.payload, true)
      }

      logger.error('Invoice company lookup provider failed without usable cache', {
        ...safeLookupLogFields(provider.providerKey, countryCode, identifier),
        err,
      })
      if (err instanceof z.ZodError) {
        throw new InvoiceCompanyLookupUnavailableError('[internal] invoice company lookup provider returned invalid data', { cause: err })
      }
      throw err instanceof InvoiceCompanyLookupUnavailableError
        ? err
        : new InvoiceCompanyLookupUnavailableError('[internal] invoice company lookup is unavailable', { cause: err })
    }
  }

  private async readCache(
    scope: InvoiceScope,
    countryCode: string,
    provider: InvoiceCompanyLookupProviderKey,
    identifier: string,
  ): Promise<{ row: InvoiceCompanyRegistry; payload: InvoiceCompanyLookupCachePayload } | null> {
    const row = await findOneWithDecryption(
      this.em,
      InvoiceCompanyRegistry,
      invoiceScopeWhere(scope, { countryCode, provider, identifier }) as FilterQuery<InvoiceCompanyRegistry>,
      undefined,
      scope,
    )
    if (!row) return null

    const parsed = invoiceCompanyLookupCachePayloadSchema.safeParse(row.payload)
    if (!parsed.success) {
      logger.warn('Ignoring invalid invoice company lookup cache payload', {
        ...safeLookupLogFields(provider, countryCode, identifier),
        rowId: row.id,
      })
      return null
    }

    return { row, payload: parsed.data }
  }

  private isFresh(fetchedAt: Date): boolean {
    return fetchedAt.getTime() + INVOICE_COMPANY_LOOKUP_CACHE_TTL_MS > this.now().getTime()
  }

  private resultFromCache(
    row: InvoiceCompanyRegistry,
    payload: InvoiceCompanyLookupCachePayload,
    stale: boolean,
  ): InvoiceCompanyLookupResult {
    return {
      mode: 'registry',
      countryCode: row.countryCode,
      identifier: row.identifier,
      provider: row.provider as InvoiceCompanyLookupProviderKey,
      fetchedAt: row.fetchedAt.toISOString(),
      stale,
      company: payload.normalized,
    }
  }

  private async writeProviderResult(
    scope: InvoiceScope,
    countryCode: string,
    provider: InvoiceCompanyLookupProviderKey,
    identifier: string,
    providerResult: CompanyRegistryProviderResult,
  ): Promise<InvoiceCompanyRegistry> {
    assertInvoiceCompanyRegistryPayloadEncryptionConfigured()
    const payload = invoiceCompanyLookupCachePayloadSchema.parse({
      version: 1,
      normalized: providerResult.company,
      rawProviderResponse: providerResult.rawProviderResponse,
      providerFetchedAt: providerResult.fetchedAt.toISOString(),
    })
    const existing = await this.readCache(scope, countryCode, provider, identifier)
    if (existing) {
      existing.row.payload = payload
      existing.row.fetchedAt = providerResult.fetchedAt
      existing.row.updatedAt = this.now()
      await this.em.flush()
      return existing.row
    }

    const row = this.em.create(InvoiceCompanyRegistry, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      countryCode,
      identifier,
      provider,
      payload,
      fetchedAt: providerResult.fetchedAt,
      createdAt: this.now(),
      updatedAt: this.now(),
    })
    this.em.persist(row)
    try {
      await this.em.flush()
      return row
    } catch (err) {
      const concurrent = await this.readCache(scope, countryCode, provider, identifier)
      if (!concurrent) throw err
      concurrent.row.payload = payload
      concurrent.row.fetchedAt = providerResult.fetchedAt
      concurrent.row.updatedAt = this.now()
      await this.em.flush()
      return concurrent.row
    }
  }
}

export function createInvoiceCompanyLookupService(em: EntityManager): InvoiceCompanyLookupService {
  return new InvoiceCompanyLookupService(em)
}
