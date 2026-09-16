import type { EntityManager } from '@mikro-orm/postgresql'
import { createModuleQueue, type Queue } from '@open-mercato/queue'
import { runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'
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

/**
 * Built lazily, not at module scope. Under `QUEUE_STRATEGY=async` the factory eagerly resolves
 * `QUEUE_REDIS_URL`/`REDIS_URL` and throws when neither is set — at module scope that crashes
 * evaluation for every route that transitively imports `invoice/di.ts`. Every other module
 * memoizes inside a function (`data_sync/lib/queue.ts`, `push_notifications/lib/queue.ts`).
 */
let syncQueue: Queue<Record<string, unknown>> | null = null
function getSyncQueue(): Queue<Record<string, unknown>> {
  if (!syncQueue) syncQueue = createModuleQueue('invoice-sync', { concurrency: 1 })
  return syncQueue
}

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
  const withTenantCache = <T>(scope: InvoiceScope, operation: () => T | Promise<T>) => runWithCacheTenant(scope.tenantId, operation)
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
  const active = (scope: InvoiceScope) => em.findOne(InvoiceSyncJob, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    state: { $in: ACTIVE_STATES },
  }, { orderBy: { createdAt: 'asc' } })
  const cooldownKey = (scope: InvoiceScope) => key(scope, 'cooldown-until')
  const authBackoffKey = (scope: InvoiceScope) => key(scope, 'auth-backoff-until')
  const remainingSeconds = async (scope: InvoiceScope, cacheKey: string) => {
    const value = await withTenantCache(scope, () => cache.get(cacheKey))
    const until = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(until) || until <= Date.now()) return 0
    return Math.ceil((until - Date.now()) / 1000)
  }
  const setCooldown = async (scope: InvoiceScope, seconds: number) => {
    await withTenantCache(scope, () => cache.set(cooldownKey(scope), Date.now() + seconds * 1000, { ttl: seconds * 1000 }))
  }
  const setAuthBackoff = async (scope: InvoiceScope, seconds: number) => {
    await withTenantCache(scope, () => cache.set(authBackoffKey(scope), Date.now() + seconds * 1000, { ttl: seconds * 1000 }))
  }
  const reconcileStale = async (scope: InvoiceScope): Promise<InvoiceSyncJob | null> => {
    const job = await active(scope)
    if (!job) return null
    if (Date.now() - job.updatedAt.getTime() <= INVOICE_SYNC_ACTIVE_LOCK_TTL_SECONDS * 1000) return job
    job.state = 'FAILED'
    job.failureCategory = 'INTERNAL_ERROR'
    job.failureMessage = '[internal] Sync job became stale'
    job.failureRequestId = crypto.randomUUID()
    job.finishedAt = new Date()
    job.updatedAt = new Date()
    await em.flush()
    if (job.progressJobId) {
      await progressService.failJob(job.progressJobId, { errorMessage: '[internal] Sync job became stale' }, { tenantId: scope.tenantId, organizationId: scope.organizationId, userId: job.startedByUserId ?? null })
    }
    return null
  }
  const status = (job: InvoiceSyncJob) => ({
    jobId: job.id, state: job.state, progress: job.progress, fromDate: job.fromDate.toISOString(), toDate: job.toDate.toISOString(),
    scopeTaxCodes: job.scopeTaxCodes, failureCategory: job.failureCategory ?? null, failureMessage: job.failureMessage ?? null,
    counts: { processed: 0, imported: 0, updated: 0, skipped: 0, errors: 0, ...job.counts },
    progressJobId: job.progressJobId ?? null, createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null, finishedAt: job.finishedAt?.toISOString() ?? null,
    startedBy: job.startedByUserId ? { id: job.startedByUserId } : null,
    failureRequestId: job.failureRequestId ?? null,
  })
  const enqueue = async (scope: InvoiceScope, userId: string, input: ReturnType<typeof invoiceSyncStartSchema.parse>) => {
    const job = em.create(InvoiceSyncJob, { tenantId: scope.tenantId, organizationId: scope.organizationId, fromDate: dateValue(input.fromDate), toDate: dateValue(input.toDate), scopeTaxCodes: input.scopeTaxCodes, idempotencyKey: input.idempotencyKey, startedByUserId: userId, state: 'QUEUED', progress: 0, createdAt: new Date(), updatedAt: new Date() })
    await em.persist(job).flush()
    const progress = await progressService.createJob({ jobType: 'invoice.sync', name: 'Invoice synchronization', description: 'GDT invoice synchronization', cancellable: false }, { tenantId: scope.tenantId, organizationId: scope.organizationId, userId })
    job.progressJobId = progress.id
    await em.flush()
    try {
      await getSyncQueue().enqueue({ syncJobId: job.id, progressJobId: progress.id, tenantId: scope.tenantId, organizationId: scope.organizationId, userId, fromDate: input.fromDate, toDate: input.toDate, scopeTaxCodes: input.scopeTaxCodes })
    } catch (error) {
      job.state = 'FAILED'; job.failureCategory = 'INTERNAL_ERROR'; job.failureMessage = '[internal] Queue enqueue failed'; job.failureRequestId = crypto.randomUUID(); job.finishedAt = new Date(); await em.flush()
      await progressService.failJob(progress.id, { errorMessage: '[internal] Queue enqueue failed' }, { tenantId: scope.tenantId, organizationId: scope.organizationId, userId })
      await setCooldown(scope, INVOICE_SYNC_COOLDOWN_SECONDS)
      throw error
    }
    return status(job)
  }
  return {
    /**
     * Drop a token GDT has rejected. Without this a 401 leaves the token cached for up to
     * `INVOICE_SYNC_GDT_TOKEN_TTL_CAP_SECONDS` (23h), and `start()`'s `getCachedToken` fast
     * path keeps enqueueing syncs that re-present the same dead token — so sync stays broken
     * for the org with no operator recovery short of waiting out the TTL.
     */
    async clearCachedToken(scope: InvoiceScope) {
      await withTenantCache(scope, () => cache.delete(key(scope, 'token')))
    },
    async getCachedToken(scope: InvoiceScope) {
      const cachedToken = await withTenantCache(scope, () => cache.get(key(scope, 'token'))) as Record<string, unknown> | null
      if (!cachedToken) return null
      const token = await reveal(scope, cachedToken)
      return typeof token.token === 'string' && token.token.length > 0 ? token.token : null
    },
    async availability(scope: InvoiceScope) {
      await reconcileStale(scope)
      const job = await latest(scope)
      let mst: string | null = null
      try { mst = await getMst(scope) } catch { /* intentionally omitted */ }
      const activeJob = await active(scope)
      const retryAfterSeconds = activeJob ? 0 : await remainingSeconds(scope, cooldownKey(scope))
      return {
        canSync: Boolean(mst && gdtClient.isConfigured()) && retryAfterSeconds === 0,
        reason: !gdtClient.isConfigured() ? 'not_configured' : !mst ? 'not_vietnamese' : retryAfterSeconds > 0 ? 'cooldown' : 'ok',
        taxCode: mst,
        portalUrl: gdtClient.portalUrl ?? null,
        activeJob: activeJob ? status(activeJob) : null,
        latestJob: job ? status(job) : null,
        lastSyncAt: job?.finishedAt?.toISOString() ?? null,
        retryAfterSeconds,
      }
    },
    async start(scope: InvoiceScope, userId: string, raw: unknown) {
      const input = invoiceSyncStartSchema.parse(raw)
      const from = dateValue(input.fromDate); const to = dateValue(input.toDate)
      if (from > to || from > new Date() || to > new Date() || (to.getTime() - from.getTime()) / 86400000 + 1 > INVOICE_SYNC_MAX_WINDOW_DAYS) throw new Error('[internal] Invalid sync date range')
      const normalized = { ...input, scopeTaxCodes: normalizeScope(input.scopeTaxCodes) }
      const existing = await em.findOne(InvoiceSyncJob, { tenantId: scope.tenantId, organizationId: scope.organizationId, idempotencyKey: input.idempotencyKey })
      if (existing) return { state: 'queued', job: status(existing), idempotent: true }
      const availabilityResult = await this.availability(scope)
      if (!availabilityResult.canSync && availabilityResult.reason !== 'cooldown') return { state: 'unavailable', reason: availabilityResult.reason, taxCode: availabilityResult.taxCode, portalUrl: availabilityResult.portalUrl }
      if (availabilityResult.activeJob) return { state: 'already_syncing', job: availabilityResult.activeJob }
      if (availabilityResult.retryAfterSeconds > 0) return { state: 'cooldown', retryAfterSeconds: availabilityResult.retryAfterSeconds }
      if (await this.getCachedToken(scope)) {
        try { return { state: 'queued', job: await enqueue(scope, userId, normalized) } } catch {
          const current = await active(scope)
          if (current) return { state: 'already_syncing', job: status(current) }
          throw new Error('[internal] Sync enqueue failed')
        }
      }
      const captcha = await gdtClient.fetchCaptcha()
      const transactionId = crypto.randomUUID()
      const protectedTransaction = await protect(scope, { ...normalized, userId, captchaKey: captcha.key, sessionCookie: captcha.sessionCookie, attempts: 0 })
      await withTenantCache(scope, () => cache.set(key(scope, `captcha:${transactionId}`), protectedTransaction, { ttl: INVOICE_SYNC_CAPTCHA_TTL_SECONDS * 1000 }))
      return { state: 'auth_required', transactionId, captchaSvg: captcha.svg, captchaTtlSeconds: INVOICE_SYNC_CAPTCHA_TTL_SECONDS }
    },
    async authenticate(scope: InvoiceScope, userId: string, raw: unknown) {
      const input = invoiceSyncAuthenticateSchema.parse(raw)
      const backoff = await remainingSeconds(scope, authBackoffKey(scope))
      if (backoff > 0) return { state: 'too_many_attempts', retryAfterSeconds: backoff }
      const transactionKey = key(scope, `captcha:${input.transactionId}`)
      const cached = await withTenantCache(scope, () => cache.get(transactionKey)) as Record<string, unknown> | null
      if (!cached) throw new Error('[internal] CAPTCHA transaction expired')
      const transaction = await reveal(scope, cached) as ReturnType<typeof invoiceSyncStartSchema.parse> & { userId: string; captchaKey: string; sessionCookie?: string; attempts?: number }
      const result = await gdtClient.authenticate({ mst: await getMst(scope), password: input.password, captchaKey: transaction.captchaKey, captchaSolution: input.captchaSolution, sessionCookie: transaction.sessionCookie })
      if (result.kind === 'account_locked') {
        await withTenantCache(scope, () => cache.delete(transactionKey))
        await setAuthBackoff(scope, INVOICE_SYNC_FAILED_AUTH_BACKOFF_SECONDS)
        return { state: 'account_locked', message: 'The tax portal account is locked.', portalUrl: gdtClient.portalUrl ?? null }
      }
      if (result.kind !== 'success') {
        const attempts = (transaction.attempts ?? 0) + 1
        if (attempts >= INVOICE_SYNC_MAX_AUTH_ATTEMPTS) {
          await withTenantCache(scope, () => cache.delete(transactionKey))
          await setAuthBackoff(scope, INVOICE_SYNC_FAILED_AUTH_BACKOFF_SECONDS)
          return { state: 'too_many_attempts', retryAfterSeconds: INVOICE_SYNC_FAILED_AUTH_BACKOFF_SECONDS }
        }
        const captcha = await gdtClient.fetchCaptcha()
        const protectedTransaction = await protect(scope, { ...transaction, captchaKey: captcha.key, sessionCookie: captcha.sessionCookie, attempts })
        await withTenantCache(scope, () => cache.set(transactionKey, protectedTransaction, { ttl: INVOICE_SYNC_CAPTCHA_TTL_SECONDS * 1000 }))
        return { state: 'retry', reason: result.kind, transactionId: input.transactionId, captchaSvg: captcha.svg, attemptsRemaining: INVOICE_SYNC_MAX_AUTH_ATTEMPTS - attempts }
      }
      const protectedToken = await protect(scope, { token: result.token })
      await withTenantCache(scope, () => cache.set(key(scope, 'token'), protectedToken, { ttl: Math.min(result.expiresInSeconds ?? INVOICE_SYNC_GDT_TOKEN_TTL_CAP_SECONDS, INVOICE_SYNC_GDT_TOKEN_TTL_CAP_SECONDS) * 1000 }))
      await withTenantCache(scope, () => cache.delete(transactionKey))
      await withTenantCache(scope, () => cache.delete(authBackoffKey(scope)))
      const currentAvailability = await this.availability(scope)
      if (currentAvailability.activeJob) return { state: 'already_syncing', job: currentAvailability.activeJob }
      if (currentAvailability.retryAfterSeconds > 0) return { state: 'cooldown', retryAfterSeconds: currentAvailability.retryAfterSeconds }
      return { state: 'queued', job: await enqueue(scope, userId, transaction) }
    },
    async getStatus(scope: InvoiceScope, jobId: string) {
      const job = await em.findOne(InvoiceSyncJob, { id: jobId, tenantId: scope.tenantId, organizationId: scope.organizationId })
      return job ? status(job) : null
    },
    async setTerminalCooldown(scope: InvoiceScope) {
      await setCooldown(scope, INVOICE_SYNC_COOLDOWN_SECONDS)
    },
    constants: { cooldownSeconds: INVOICE_SYNC_COOLDOWN_SECONDS, activeLockTtlSeconds: INVOICE_SYNC_ACTIVE_LOCK_TTL_SECONDS, failedAuthBackoffSeconds: INVOICE_SYNC_FAILED_AUTH_BACKOFF_SECONDS },
  }
}
