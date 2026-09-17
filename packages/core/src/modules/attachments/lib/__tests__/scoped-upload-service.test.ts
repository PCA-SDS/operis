import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { StorageDriverFactory } from '../drivers'
import type { AttachmentQuotaService } from '../quota-service'
import {
  isScopedAttachmentUploadError,
  ScopedAttachmentUploadError,
  ScopedAttachmentUploadService,
} from '../scoped-upload-service'

jest.mock('../partitions', () => ({
  ensureDefaultPartitions: jest.fn(async () => undefined),
  resolveDefaultPartitionCode: jest.fn(() => 'privateAttachments'),
}))

jest.mock('../ocrQueue', () => ({ requestOcrProcessing: jest.fn(async () => undefined) }))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

function makeHarness(options: {
  persistFails?: boolean
  reserveFails?: boolean
  markStoredFails?: boolean
  storedPath?: string
} = {}) {
  const order: string[] = []
  const attachment = {} as Record<string, unknown>
  const tx = {
    create: jest.fn((_entity: unknown, values: Record<string, unknown>) => {
      Object.assign(attachment, values)
      return attachment
    }),
    persist: jest.fn(() => ({
      flush: jest.fn(async () => {
        order.push('persist')
        if (options.persistFails) throw new Error('db unavailable')
      }),
    })),
  }
  const em = {
    findOne: jest.fn(async () => ({
      code: 'privateAttachments',
      storageDriver: 'local',
      requiresOcr: false,
    })),
    transactional: jest.fn(async (work: (inner: typeof tx) => Promise<void>) => work(tx)),
  } as unknown as EntityManager
  const driver = {
    key: 'local',
    prepareStoragePath: jest.fn(() => 'tenant/org/upload.pdf'),
    store: jest.fn(async () => {
      order.push('store')
      return { storagePath: options.storedPath ?? 'tenant/org/upload.pdf' }
    }),
    deleteStrict: jest.fn(async () => {
      order.push('delete')
    }),
  }
  const storageDriverFactory = {
    resolveForPartition: jest.fn(async () => driver),
  } as unknown as StorageDriverFactory
  const quota = {
    reserve: jest.fn(async () => {
      order.push('reserve')
      if (options.reserveFails) throw Object.assign(new Error('quota exceeded'), { code: 'quota_exceeded' })
      return { id: 'reservation-1', leaseToken: 'lease-1', expiresAt: new Date(Date.now() + 60_000) }
    }),
    beginStorage: jest.fn(async () => {
      order.push('begin')
    }),
    markStored: jest.fn(async () => {
      order.push('stored')
      if (options.markStoredFails) throw new Error('quota ledger unavailable')
    }),
    completeAttachment: jest.fn(async () => {
      order.push('complete')
    }),
    release: jest.fn(async () => {
      order.push('release')
    }),
  } as unknown as AttachmentQuotaService
  const dataEngine = {
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => undefined),
  } as unknown as DataEngine
  const scheduler = jest.fn(async () => undefined)
  const service = new ScopedAttachmentUploadService({
    em,
    dataEngine,
    storageDriverFactory,
    attachmentQuotaService: quota,
    attachmentQuotaRecoveryScheduler: scheduler,
  })
  return { service, order, attachment, driver, quota, dataEngine, em }
}

const input = {
  tenantId,
  organizationId,
  entityId: 'warranty_claims:warranty_claim',
  recordId: '33333333-3333-4333-8333-333333333333',
  fileName: 'damage.pdf',
  declaredMimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.7 sample'),
  tags: ['warranty_claims:customer-visible'],
}

describe('ScopedAttachmentUploadService', () => {
  it('reserves quota before storage and completes it in the persistence transaction', async () => {
    const { service, order, attachment, dataEngine, em } = makeHarness()

    await expect(service.upload(input)).resolves.toBe(attachment)

    expect(order).toEqual(['reserve', 'begin', 'store', 'stored', 'persist', 'complete'])
    expect(attachment).toMatchObject({
      tenantId,
      organizationId,
      entityId: input.entityId,
      recordId: input.recordId,
      storagePath: 'tenant/org/upload.pdf',
    })
    expect(dataEngine.markOrmEntityChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'created' }))
    expect(em.findOne).toHaveBeenCalledWith(expect.anything(), {
      code: 'privateAttachments',
      $or: [
        { tenantId: null, organizationId: null },
        { tenantId, organizationId },
      ],
    })
  })

  it('deletes stored content and releases quota when database persistence fails', async () => {
    const { service, order, driver, quota, dataEngine } = makeHarness({ persistFails: true })

    await expect(service.upload(input)).rejects.toEqual(expect.objectContaining<Partial<ScopedAttachmentUploadError>>({
      code: 'persistence_failed',
      status: 500,
    }))

    expect(driver.deleteStrict).toHaveBeenCalledWith('privateAttachments', 'tenant/org/upload.pdf')
    expect(quota.release).toHaveBeenCalledWith('reservation-1', 'lease-1')
    expect(order).toEqual(['reserve', 'begin', 'store', 'stored', 'persist', 'delete', 'release'])
    expect(dataEngine.markOrmEntityChange).not.toHaveBeenCalled()
  })

  it('deletes the path returned by storage when the quota ledger cannot mark it stored', async () => {
    const { service, driver, quota } = makeHarness({
      markStoredFails: true,
      storedPath: 'tenant/org/driver-selected-upload.pdf',
    })

    await expect(service.upload(input)).rejects.toEqual(expect.objectContaining<Partial<ScopedAttachmentUploadError>>({
      code: 'storage_failed',
      status: 500,
    }))

    expect(driver.deleteStrict).toHaveBeenCalledWith('privateAttachments', 'tenant/org/driver-selected-upload.pdf')
    expect(quota.release).toHaveBeenCalledWith('reservation-1', 'lease-1')
  })

  it('fails before storage when quota reservation is rejected', async () => {
    const { service, driver } = makeHarness({ reserveFails: true })

    await expect(service.upload(input)).rejects.toEqual(expect.objectContaining<Partial<ScopedAttachmentUploadError>>({
      code: 'quota_exceeded',
      status: 413,
    }))
    expect(driver.store).not.toHaveBeenCalled()
  })
})

describe('isScopedAttachmentUploadError', () => {
  it('recognises an error thrown from a DUPLICATE copy of this module', () => {
    // The real failure this guards: Turbopack puts the upload service in the `ssr`
    // chunk group when a server component reaches it, while an API route that also
    // imports it gets its own copy. `instanceof` then compares two different class
    // objects and answers false, turning a deliberate 400 into a 500.
    //
    // A second class declaration is how that duplication looks from inside one realm.
    class DuplicateScopedAttachmentUploadError extends Error {
      constructor(
        public readonly code: string,
        public readonly status: number,
      ) {
        super(code)
        this.name = 'ScopedAttachmentUploadError'
      }
    }

    const duplicate = new DuplicateScopedAttachmentUploadError('dangerous_executable', 400)

    expect(duplicate instanceof ScopedAttachmentUploadError).toBe(false)
    expect(isScopedAttachmentUploadError(duplicate)).toBe(true)
    if (isScopedAttachmentUploadError(duplicate)) {
      expect(duplicate.status).toBe(400)
      expect(duplicate.code).toBe('dangerous_executable')
    }
  })

  it('recognises a same-realm instance', () => {
    expect(isScopedAttachmentUploadError(new ScopedAttachmentUploadError('max_upload_size', 413))).toBe(true)
  })

  it('refuses look-alikes so an unrelated failure never becomes a mapped status', () => {
    expect(isScopedAttachmentUploadError(new Error('dangerous_executable'))).toBe(false)
    expect(isScopedAttachmentUploadError(null)).toBe(false)
    expect(isScopedAttachmentUploadError('dangerous_executable')).toBe(false)
    // Right name, unknown code — a storage driver that set the same name must not be
    // mapped onto an upload status.
    expect(isScopedAttachmentUploadError({ name: 'ScopedAttachmentUploadError', code: 'not_a_real_code', status: 400 })).toBe(false)
    // Right name and code, but no status to answer with.
    expect(isScopedAttachmentUploadError({ name: 'ScopedAttachmentUploadError', code: 'dangerous_executable' })).toBe(false)
  })
})
