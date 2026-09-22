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
  isValidSingaporeUen,
  normalizeSingaporeUen,
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
export const DEFAULT_INVOICE_DATA_GOV_SG_FETCH_TIMEOUT_MS = 8_000

const DATA_GOV_SG_MASTER_RESOURCE_ID = 'd_3f960c10fed6145404ca7b821f263b87'
const DATA_GOV_SG_SHARD_RESOURCE_IDS: Readonly<Record<string, string>> = {
  A: 'd_8575e84912df3c28995b8e6e0e05205a', B: 'd_3a3807c023c61ddfba947dc069eb53f2',
  C: 'd_c0650f23e94c42e7a20921f4c5b75c24', D: 'd_acbc938ec77af18f94cecc4a7c9ec720',
  E: 'd_124a9bd407c7a25f8335b93b86e50fdd', F: 'd_4526d47d6714d3b052eed4a30b8b1ed6',
  G: 'd_b58303c68e9cf0d2ae93b73ffdbfbfa1', H: 'd_fa2ed456cf2b8597bb7e064b08fc3c7c',
  I: 'd_85518d970b8178975850457f60f1e738', J: 'd_478f45a9c541cbe679ca55d1cd2b970b',
  K: 'd_5573b0db0575db32190a2ad27919a7aa', L: 'd_a2141adf93ec2a3c2ec2837b78d6d46e',
  M: 'd_9af9317c646a1c881bb5591c91817cc6', N: 'd_67e99e6eabc4aad9b5d48663b579746a',
  O: 'd_5c4ef48b025fdfbc80056401f06e3df9', P: 'd_181005ca270b45408b4cdfc954980ca2',
  Q: 'd_4130f3d9d365d9f1633536e959f62bb7', R: 'd_2b8c54b2a490d2fa36b925289e5d9572',
  S: 'd_df7d2d661c0c11a7c367c9ee4bf896c1', T: 'd_72f37e5c5d192951ddc5513c2b134482',
  U: 'd_0cc5f52a1f298b916f317800251057f3', V: 'd_e97e8e7fc55b85a38babf66b0fa46b73',
  W: 'd_af2042c77ffaf0db5d75561ce9ef5688', X: 'd_1cd970d8351b42be4a308d628a6dd9d3',
  Y: 'd_31af23fdb79119ed185c256f03cb5773', Z: 'd_4e3db8955fdcda6f9944097bef3d2724',
  OTHERS: 'd_300ddc8da4e8f7bdc1bfc62d0d99e2e7',
}

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
  entity_type_desc: z.string().trim().optional().nullable(),
  uen_status_desc: z.string().trim().optional().nullable(),
  uen_issue_date: z.string().trim().optional().nullable(),
  reg_street_name: z.string().trim().optional().nullable(),
  reg_postal_code: z.string().trim().optional().nullable(),
  entity_status_description: z.string().trim().optional().nullable(),
  company_type_description: z.string().trim().optional().nullable(),
  business_constitution_description: z.string().trim().optional().nullable(),
  registration_incorporation_date: z.string().trim().optional().nullable(),
  block: z.string().trim().optional().nullable(),
  street_name: z.string().trim().optional().nullable(),
  level_no: z.string().trim().optional().nullable(),
  unit_no: z.string().trim().optional().nullable(),
  building_name: z.string().trim().optional().nullable(),
  postal_code: z.string().trim().optional().nullable(),
  other_address_line1: z.string().trim().optional().nullable(),
  other_address_line2: z.string().trim().optional().nullable(),
  primary_ssic_code: z.string().trim().optional().nullable(),
  primary_ssic_description: z.string().trim().optional().nullable(),
  primary_user_described_activity: z.string().trim().optional().nullable(),
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
  if (countryCode === 'SG' && !isValidSingaporeUen(identifier)) {
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

function resolveDataGovSgUrl(identifier: string, resourceId: string): string {
  const base = process.env.COMPANY_LOOKUP_DATA_GOV_SG_URL?.trim() || DEFAULT_INVOICE_DATA_GOV_SG_UEN_LOOKUP_URL
  const url = new URL(base)
  url.searchParams.set('resource_id', resourceId)
  url.searchParams.set('filters', JSON.stringify({ uen: identifier }))
  url.searchParams.set('limit', '1')
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
    const masterPayload = await this.fetchResource(identifier, DATA_GOV_SG_MASTER_RESOURCE_ID)
    const masterRecord = dataGovResponseSchema.parse(masterPayload).result.records[0]
    if (!masterRecord) return null

    let detailRecord: z.infer<typeof dataGovRecordSchema> | null = null
    const resourceId = DATA_GOV_SG_SHARD_RESOURCE_IDS[this.shardKey(masterRecord.entity_name ?? masterRecord.name ?? '')]
    if (resourceId) {
      try {
        const detailPayload = await this.fetchResource(identifier, resourceId)
        detailRecord = dataGovResponseSchema.parse(detailPayload).result.records[0] ?? null
      } catch (err) {
        logger.warn('Singapore company detail lookup failed; using master record', {
          ...safeLookupLogFields(this.providerKey, this.countryCode, identifier),
          err,
        })
      }
    }

    const record = detailRecord ?? masterRecord
    const address = this.addressFor(record, detailRecord ? masterRecord : null)

    return {
      company: invoiceCompanyLookupCompanySchema.parse({
        name: record.entity_name ?? record.name,
        registrationNumber: record.uen ?? record.reg_no ?? identifier,
        taxCode: null,
        address,
        status: record.entity_status_description ?? record.uen_status_desc ?? record.entity_status ?? record.status ?? null,
        sourceUpdatedAt: parseProviderDate(record.updated_at),
      }),
      rawProviderResponse: { master: masterPayload, detail: detailRecord },
      fetchedAt,
    }
  }

  private async fetchResource(identifier: string, resourceId: string): Promise<unknown> {
    const apiKey = process.env.DATA_GOV_SG_API_KEY?.trim()
    const response = await fetchWithTimeout(resolveDataGovSgUrl(identifier, resourceId), {
      timeoutMs: resolveDataGovSgTimeout(),
      headers: {
        accept: 'application/json',
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
      },
    })
    const payload = await readJsonSafe(response)
    if (!response.ok) throw new Error(`[internal] data.gov.sg UEN lookup returned ${response.status}`)
    return payload
  }

  private shardKey(name: string): string {
    const initial = name.trim().charAt(0).toUpperCase()
    return /^[A-Z]$/.test(initial) ? initial : 'OTHERS'
  }

  private addressFor(
    record: z.infer<typeof dataGovRecordSchema>,
    master: z.infer<typeof dataGovRecordSchema> | null,
  ): string | null {
    const street = [record.block, record.street_name].filter(Boolean).join(' ')
    const level = record.level_no && record.unit_no ? `#${record.level_no}-${record.unit_no}` : record.unit_no ? `#${record.unit_no}` : null
    const parts = [street, level, record.building_name, record.other_address_line1, record.other_address_line2, record.postal_code ? `Singapore ${record.postal_code}` : null].filter(Boolean)
    if (parts.length > 0) return parts.join(', ')
    if (record.registered_address ?? record.address) return record.registered_address ?? record.address ?? null
    return [master?.reg_street_name, master?.reg_postal_code ? `Singapore ${master.reg_postal_code}` : null].filter(Boolean).join(', ') || null
  }
}

function resolveDataGovSgTimeout(): number {
  const parsed = Number.parseInt(process.env.COMPANY_LOOKUP_DATA_GOV_SG_TIMEOUT_MS ?? '', 10)
  return resolveTimeoutMs(parsed, DEFAULT_INVOICE_DATA_GOV_SG_FETCH_TIMEOUT_MS)
}

export class InvoiceCompanyLookupService {
  constructor(
    private readonly em: EntityManager,
    private readonly providers: CompanyRegistryProvider[],
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

export function createInvoiceCompanyLookupService(
  em: EntityManager,
  providers: CompanyRegistryProvider[],
): InvoiceCompanyLookupService {
  return new InvoiceCompanyLookupService(em, providers)
}
