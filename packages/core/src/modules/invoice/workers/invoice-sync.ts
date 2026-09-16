import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ProgressService, ProgressServiceContext } from '../../progress/lib/progressService'
import { InvoiceSyncJob } from '../data/entities'
import type { InvoiceScope } from '../data/scope'
import { emitInvoiceEvent } from '../events'
import { GdtProviderError, classifyGdtError } from '../services/gdt/errors'
import type { GdtStream } from '../services/gdt/types'
import type { InvoiceSyncPersistenceResult } from '../services/sync-persistence-service'
import type { NormalizedInvoiceSource } from '../services/gdt/invoice-normalizer'

const logger = createLogger('invoice').child({ component: 'invoice-sync-worker' })

export type InvoiceSyncJobPayload = {
  syncJobId: string
  progressJobId: string
  tenantId: string
  organizationId: string
  userId?: string | null
  fromDate: string
  toDate: string
  scopeTaxCodes: string[]
}

export const metadata: WorkerMeta = {
  queue: 'invoice-sync',
  id: 'invoice:sync',
  concurrency: 1,
}

type HandlerContext = JobContext & { resolve: <T = unknown>(name: string) => T }

type SyncCounts = {
  processed: number
  imported: number
  updated: number
  skipped: number
  errors: number
  ar: StreamCounts
  ap: StreamCounts
}

type StreamCounts = { fetched: number; new: number; updated: number; skipped: number; errors: number }

const emptyStreamCounts = (): StreamCounts => ({ fetched: 0, new: 0, updated: 0, skipped: 0, errors: 0 })
const emptyCounts = (): SyncCounts => ({ processed: 0, imported: 0, updated: 0, skipped: 0, errors: 0, ar: emptyStreamCounts(), ap: emptyStreamCounts() })

function addCounts(target: SyncCounts, stream: 'ar' | 'ap', result: InvoiceSyncPersistenceResult): void {
  target.imported += result.created
  target.updated += result.updated
  target.skipped += result.skipped
  target.errors += result.failed
  target[stream].new += result.created
  target[stream].updated += result.updated
  target[stream].skipped += result.skipped
  target[stream].errors += result.failed
}

const MAX_FAILURE_MESSAGE_LENGTH = 500

/**
 * `failure_message` is an unbounded `text` column that `status()` returns to every caller with
 * `invoice.sync`. A driver exception's message carries the failing SQL and its bound parameters
 * — partner names, tax codes, amounts — so only messages we construct ourselves are persisted.
 * Anything else is reduced to a marker; the real error still goes to the logs with full detail.
 */
function safeErrorMessage(error: unknown): string {
  if (error instanceof GdtProviderError) return error.message.slice(0, MAX_FAILURE_MESSAGE_LENGTH)
  return '[internal] Invoice sync failed'
}

export default async function handle(job: QueuedJob<InvoiceSyncJobPayload>, ctx: HandlerContext): Promise<void> {
  const payload = job.payload
  const scope: InvoiceScope = { tenantId: payload.tenantId, organizationId: payload.organizationId }
  const progressContext: ProgressServiceContext = { ...scope, userId: payload.userId ?? null }
  const em = ctx.resolve<EntityManager>('em')
  const progressService = ctx.resolve<ProgressService>('progressService')
  const syncService = ctx.resolve('invoiceSyncService') as {
    getCachedToken(input: InvoiceScope): Promise<string | null>
    clearCachedToken(input: InvoiceScope): Promise<void>
    setTerminalCooldown(input: InvoiceScope): Promise<void>
  }
  const fetcher = ctx.resolve('gdtFetcherService') as {
    fetch(input: { stream: GdtStream; token: string; fromDate: Date; toDate: Date }): AsyncGenerator<Record<string, unknown>>
  }
  const persistence = ctx.resolve('invoiceSyncPersistenceService') as {
    persist(input: InvoiceScope, sources: NormalizedInvoiceSource[]): Promise<InvoiceSyncPersistenceResult>
  }
  const normalizer = ctx.resolve('invoiceNormalizer') as { normalize(stream: GdtStream, record: Record<string, unknown>): NormalizedInvoiceSource }
  const autoPaid = ctx.resolve('invoiceAutoPaidService') as { applyAll(input: InvoiceScope): Promise<unknown> }
  const syncJob = await em.findOne(InvoiceSyncJob, {
    id: payload.syncJobId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })

  if (!syncJob) throw new Error('[internal] Invoice sync job not found')
  if (syncJob.progressJobId !== payload.progressJobId) throw new Error('[internal] Invoice sync progress job mismatch')
  if (syncJob.state === 'DONE' || syncJob.state === 'FAILED') return

  const counts = { ...emptyCounts(), ...(syncJob.counts as Partial<SyncCounts>) }
  const updateJob = async (state: InvoiceSyncJob['state'], progress: number, finished = false) => {
    syncJob.state = state
    syncJob.progress = progress
    syncJob.counts = counts
    if (finished) syncJob.finishedAt = new Date()
    syncJob.updatedAt = new Date()
    await em.flush()
  }
  const updateProgress = async () => {
    await progressService.updateProgress(payload.progressJobId, {
      processedCount: counts.processed,
      meta: counts,
    }, progressContext)
  }

  try {
    syncJob.startedAt ??= new Date()
    await updateJob('AUTHENTICATING', 0)
    await progressService.startJob(payload.progressJobId, progressContext)
    await emitInvoiceEvent('invoice.sync.started', { syncJobId: syncJob.id, progressJobId: payload.progressJobId, ...scope })

    const token = await syncService.getCachedToken(scope)
    if (!token) throw new Error('[internal] Cached GDT token unavailable')

    await updateJob('FETCHING', 5)
    const fromDate = syncJob.fromDate
    const toDate = syncJob.toDate
    for (const stream of ['sold', 'purchased'] as const) {
      const batch: NormalizedInvoiceSource[] = []
      for await (const record of fetcher.fetch({ stream, token, fromDate, toDate })) {
        counts.processed += 1
        counts[stream === 'sold' ? 'ar' : 'ap'].fetched += 1
        try {
          const normalized = normalizer.normalize(stream, record)
          const partnerTaxCode = normalized.direction === 'AP' ? normalized.sellerTaxCode : normalized.buyerTaxCode
          if (syncJob.scopeTaxCodes.length === 0 || (partnerTaxCode && syncJob.scopeTaxCodes.includes(partnerTaxCode))) {
            batch.push(normalized)
          } else {
            counts.skipped += 1
            counts[stream === 'sold' ? 'ar' : 'ap'].skipped += 1
          }
        } catch {
          counts.skipped += 1
          counts[stream === 'sold' ? 'ar' : 'ap'].skipped += 1
        }
        if (batch.length >= 100) {
          await updateJob('PERSISTING', Math.min(95, 5 + counts.processed))
          addCounts(counts, stream === 'sold' ? 'ar' : 'ap', await persistence.persist(scope, batch.splice(0, batch.length)))
          await updateProgress()
          await updateJob('FETCHING', Math.min(95, 5 + counts.processed))
        }
      }
      if (batch.length > 0) {
        await updateJob('PERSISTING', Math.min(95, 5 + counts.processed))
        addCounts(counts, stream === 'sold' ? 'ar' : 'ap', await persistence.persist(scope, batch))
        await updateProgress()
      }
    }

    try {
      await autoPaid.applyAll(scope)
    } catch (error) {
      logger.warn('Invoice sync Auto-Paid application failed', { ...scope, syncJobId: syncJob.id, err: error })
    }

    await updateProgress()
    await updateJob('DONE', 100, true)
    await progressService.completeJob(payload.progressJobId, { resultSummary: counts }, progressContext)
    await syncService.setTerminalCooldown(scope)
    await emitInvoiceEvent('invoice.sync.completed', { syncJobId: syncJob.id, progressJobId: payload.progressJobId, counts, ...scope })
  } catch (error) {
    const failureCategory = classifyGdtError(error)
    if (failureCategory === 'AUTH_FAILED') await syncService.clearCachedToken(scope)
    syncJob.state = 'FAILED'
    syncJob.progress = Math.min(syncJob.progress, 99)
    syncJob.counts = counts
    syncJob.failureCategory = failureCategory
    syncJob.failureMessage = safeErrorMessage(error)
    syncJob.failureRequestId = crypto.randomUUID()
    syncJob.finishedAt = new Date()
    syncJob.updatedAt = new Date()
    await em.flush()
    await progressService.failJob(payload.progressJobId, {
      errorMessage: syncJob.failureMessage,
      resultSummary: counts,
    }, progressContext)
    await syncService.setTerminalCooldown(scope)
    await emitInvoiceEvent('invoice.sync.failed', {
      syncJobId: syncJob.id,
      progressJobId: payload.progressJobId,
      failureCategory,
      counts,
      ...scope,
    })
    logger.error('Invoice sync failed', { ...scope, syncJobId: syncJob.id, progressJobId: payload.progressJobId, failureCategory, counts, err: error })
    throw error
  }
}
