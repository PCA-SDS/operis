import type { EntityManager } from '@mikro-orm/postgresql'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import type { CacheStrategy } from '@open-mercato/cache'
import type { ProgressService } from '../../progress/lib/progressService'
import { Organization } from '../../directory/data/entities'
import { InvoiceSyncJob, type InvoiceSyncJobState } from '../data/entities'
import type { InvoiceScope } from '../data/scope'
import {
  INVOICE_SYNC_ACTIVE_LOCK_TTL_SECONDS, INVOICE_SYNC_CAPTCHA_TTL_SECONDS,
  INVOICE_SYNC_COOLDOWN_SECONDS, INVOICE_SYNC_FAILED_AUTH_BACKOFF_SECONDS,
  INVOICE_SYNC_GDT_TOKEN_TTL_CAP_SECONDS, INVOICE_SYNC_MAX_AUTH_ATTEMPTS,
  INVOICE_SYNC_MAX_WINDOW_DAYS, invoiceSyncAuthenticateSchema, invoiceSyncStartSchema,
  invoiceVietnameseTaxCodeSchema,
} from '../data/validators'
import { createGdtClient, type GdtClient } from './gdt-client'

const ACTIVE_STATES: InvoiceSyncJobState[] = ['QUEUED', 'AUTHENTICATING', 'FETCHING', 'PERSISTING']
const queue: Queue<Record<string, unknown>> = createModuleQueue('invoice-sync', { concurrency: 1 })

export type InvoiceSyncService = ReturnType<typeof createInvoiceSyncService>
type EncryptionService = { isEnabled?: () => boolean; encryptEntityPayload?: (entityId: string, payload: Record<string, unknown>, tenantId: string, organizationId: string) => Promise<Record<string, unknown>>; decryptEntityPayload?: (entityId: string, payload: Record<string, unknown>, tenantId: string, organizationId: string) => Promise<Record<string, unknown>> }

function dateValue(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('[internal] Invalid sync date')
  return date
}

function normalizeScope(values: string[]) {
  const output: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = value.trim()
    invoiceVietnameseTaxCodeSchema.parse(normalized)
    if (!seen.has(normalized)) { seen.add(normalized); output.push(normalized) }
  }
  return output
}

export function createInvoiceSyncService(
  em: EntityManager,
  cache: CacheStrategy,
  progressService: ProgressService,
  gdtClient: GdtClient = createGdtClient(),
  encryption?: EncryptionService,
) {
  const key = (scope: InvoiceScope, suffix: string) => `invoice-sync:${scope.tenantId}:${scope.organizationId}:${suffix}`
  const getOrganization = (scope: InvoiceScope) => em.findOne(Organization, { id: scope.organizationId, tenant: scope.tenantId })
  const getMst = async (scope: InvoiceScope) => {
    const organization = await getOrganization(scope)
    const mst = organization?.taxCode?.trim() ?? ''
    return invoiceVietnameseTaxCodeSchema.parse(mst)
  }
  const protect = async (scope: InvoiceScope, value: Record<string, unknown>) => {
    if (!encryption?.isEnabled?.() || !encryption.encryptEntityPayload) throw new Error('[internal] Sync secret encryption unavailable')
    return encryption.encryptEntityPayload('invoice:gdt_cache', value, scope.tenantId, scope.organizationId)
  }
  const reveal = async (scope: InvoiceScope, value: Record<string, unknown>) => {
    if (!encryption?.isEnabled?.() || !encryption.decryptEntityPayload) throw new Error('[internal] Sync secret encryption unavailable')
    return encryption.decryptEntityPayload('invoice:gdt_cache', value, scope.tenantId, scope.organizationId)
  }
  const latest = (scope: InvoiceScope) => em.findOne(InvoiceSyncJob, { tenantId: scope.tenantId, organizationId: scope.organizationId }, { orderBy: { createdAt: 'desc' } })
  const status = (job: InvoiceSyncJob) => ({
    jobId: job.id, state: job.state, progress: job.progress, fromDate: job.fromDate.toISOString(), toDate: job.toDate.toISOString(),
    scopeTaxCodes: job.scopeTaxCodes, failureCategory: job.failureCategory ?? null, failureMessage: job.failureMessage ?? null,
    progressJobId: job.progressJobId ?? null, createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null, finishedAt: job.finishedAt?.toISOString() ?? null,
  })
  const enqueue = async (scope: InvoiceScope, userId: string, input: ReturnType<typeof invoiceSyncStartSchema.parse>) => {
    const job = em.create(InvoiceSyncJob, { tenantId: scope.tenantId, organizationId: scope.organizationId, fromDate: dateValue(input.fromDate), toDate: dateValue(input.toDate), scopeTaxCodes: input.scopeTaxCodes, idempotencyKey: input.idempotencyKey, startedByUserId: userId, state: 'QUEUED', progress: 0, createdAt: new Date(), updatedAt: new Date() })
    await em.persist(job).flush()
    const progress = await progressService.createJob({ jobType: 'invoice.sync', name: 'Invoice synchronization', description: 'GDT invoice synchronization', cancellable: false }, { tenantId: scope.tenantId, organizationId: scope.organizationId, userId })
    job.progressJobId = progress.id
    await em.flush()
    try {
      await queue.enqueue({ syncJobId: job.id, progressJobId: progress.id, tenantId: scope.tenantId, organizationId: scope.organizationId, userId, fromDate: input.fromDate, toDate: input.toDate, scopeTaxCodes: input.scopeTaxCodes })
    } catch (error) {
      job.state = 'FAILED'; job.failureCategory = 'INTERNAL_ERROR'; job.failureMessage = '[internal] Queue enqueue failed'; job.finishedAt = new Date(); await em.flush()
      await progressService.failJob(progress.id, { errorMessage: '[internal] Queue enqueue failed' }, { tenantId: scope.tenantId, organizationId: scope.organizationId, userId })
      throw error
    }
    return status(job)
  }
  return {
    async getCachedToken(scope: InvoiceScope) {
      const cachedToken = await cache.get(key(scope, 'token')) as Record<string, unknown> | null
      if (!cachedToken) return null
      const token = await reveal(scope, cachedToken)
      return typeof token.token === 'string' && token.token.length > 0 ? token.token : null
    },
    async availability(scope: InvoiceScope) {
      const job = await latest(scope)
      let mst: string | null = null
      try { mst = await getMst(scope) } catch { /* intentionally omitted */ }
      return { canSync: Boolean(mst && gdtClient.isConfigured()), reason: !gdtClient.isConfigured() ? 'not_configured' : mst ? 'ok' : 'not_vietnamese', taxCode: mst, latestJob: job ? status(job) : null }
    },
    async start(scope: InvoiceScope, userId: string, raw: unknown) {
      const input = invoiceSyncStartSchema.parse(raw)
      const from = dateValue(input.fromDate); const to = dateValue(input.toDate)
      if (from > to || from > new Date() || to > new Date() || (to.getTime() - from.getTime()) / 86400000 + 1 > INVOICE_SYNC_MAX_WINDOW_DAYS) throw new Error('[internal] Invalid sync date range')
      const normalized = { ...input, scopeTaxCodes: normalizeScope(input.scopeTaxCodes) }
      const existing = await em.findOne(InvoiceSyncJob, { tenantId: scope.tenantId, organizationId: scope.organizationId, idempotencyKey: input.idempotencyKey })
      if (existing) return { state: 'queued', job: status(existing), idempotent: true }
      if (await this.getCachedToken(scope)) return { state: 'queued', job: await enqueue(scope, userId, normalized) }
      const captcha = await gdtClient.fetchCaptcha()
      const transactionId = crypto.randomUUID()
      await cache.set(key(scope, `captcha:${transactionId}`), await protect(scope, { ...normalized, userId, captchaKey: captcha.key }), { ttl: INVOICE_SYNC_CAPTCHA_TTL_SECONDS * 1000 })
      return { state: 'auth_required', transactionId, captchaSvg: captcha.svg, captchaTtlSeconds: INVOICE_SYNC_CAPTCHA_TTL_SECONDS }
    },
    async authenticate(scope: InvoiceScope, userId: string, raw: unknown) {
      const input = invoiceSyncAuthenticateSchema.parse(raw)
      const transactionKey = key(scope, `captcha:${input.transactionId}`)
      const cached = await cache.get(transactionKey) as Record<string, unknown> | null
      if (!cached) throw new Error('[internal] CAPTCHA transaction expired')
      const transaction = await reveal(scope, cached) as ReturnType<typeof invoiceSyncStartSchema.parse> & { userId: string; captchaKey: string }
      const result = await gdtClient.authenticate({ mst: await getMst(scope), password: input.password, captchaKey: transaction.captchaKey, captchaSolution: input.captchaSolution })
      if (result.kind !== 'success') return { state: 'retry', reason: result.kind, attemptsRemaining: INVOICE_SYNC_MAX_AUTH_ATTEMPTS - 1 }
      await cache.set(key(scope, 'token'), await protect(scope, { token: result.token }), { ttl: Math.min(result.expiresInSeconds ?? INVOICE_SYNC_GDT_TOKEN_TTL_CAP_SECONDS, INVOICE_SYNC_GDT_TOKEN_TTL_CAP_SECONDS) * 1000 })
      await cache.delete(transactionKey)
      return { state: 'queued', job: await enqueue(scope, userId, transaction) }
    },
    async getStatus(scope: InvoiceScope, jobId: string) {
      const job = await em.findOne(InvoiceSyncJob, { id: jobId, tenantId: scope.tenantId, organizationId: scope.organizationId })
      return job ? status(job) : null
    },
    constants: { cooldownSeconds: INVOICE_SYNC_COOLDOWN_SECONDS, activeLockTtlSeconds: INVOICE_SYNC_ACTIVE_LOCK_TTL_SECONDS, failedAuthBackoffSeconds: INVOICE_SYNC_FAILED_AUTH_BACKOFF_SECONDS },
  }
}
