/**
 * Uploading straight to storage, and proving it afterwards.
 *
 * The server sees none of the bytes, so everything it records has to come from
 * somewhere the client does not control. Each case here is one of those facts
 * being asserted rather than accepted.
 */
import { finalizeChatDirectUpload, resolveChatDirectUpload } from '../lib/directUpload'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const UPLOADER = 'user-1'
const CONVERSATION = 'conversation-1'
const PARTITION = { code: 'privateAttachments', storageDriver: 's3' }

function factory(driver: Record<string, unknown>) {
  return { resolveForPartition: jest.fn(async () => driver) } as never
}

function quota(overrides: Record<string, unknown> = {}) {
  return {
    reserve: jest.fn(async () => ({ id: 'reservation-1', leaseToken: 'lease-1' })),
    release: jest.fn(async () => undefined),
    completeAttachment: jest.fn(async () => undefined),
    ...overrides,
  } as never
}

/** An `em` that answers partition lookups and whatever reservation is given. */
function entityManager(reservation: unknown = null) {
  return {
    // Answers by entity, not by position. Lumping every lookup together handed
    // the scan step a reservation where it asked for an Attachment, and it
    // wrote the verdict onto the wrong row without anything noticing.
    findOne: jest.fn(async (entity: { name?: string }) => {
      if (entity?.name === 'AttachmentPartition') return PARTITION
      if (entity?.name === 'Attachment') return null
      return reservation
    }),
    find: jest.fn(async () => []),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    // `persist` returns the EntityManager in MikroORM v7, and production code
    // chains `em.persist(x).flush()`. A mock returning `undefined` made that
    // chain throw, and because the caller logs and swallows scan failures the
    // suite stayed green while the scan never ran at all.
    persist: jest.fn(function (this: unknown) {
      return this
    }),
    flush: jest.fn(async () => undefined),
    transactional: jest.fn(async (run: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        persist: jest.fn(() => tx),
        flush: jest.fn(async () => undefined),
      }
      return run(tx)
    }),
    fork: jest.fn(function (this: unknown) {
      return this
    }),
    // `ensureDefaultPartitions` seeds through a repository; these tests are
    // about verification, and the partition already exists in every deployment.
    getRepository: jest.fn(() => ({
      findAll: jest.fn(async () => [{ code: PARTITION.code }]),
      create: jest.fn(),
    })),
  } as never
}

const ticketDriver = {
  createDirectUpload: jest.fn(async () => ({
    url: 'https://storage.example.com/signed',
    method: 'PUT' as const,
    headers: { 'content-type': 'application/pdf' },
    storagePath: 'chat/org-1/tenant-1/123_abc_report.pdf',
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
  })),
}

const ask = (overrides: Record<string, unknown> = {}) =>
  resolveChatDirectUpload({
    em: entityManager(),
    scope,
    uploaderUserId: UPLOADER,
    conversationId: CONVERSATION,
    storageDriverFactory: factory(ticketDriver),
    quotaService: quota(),
    fileName: 'report.pdf',
    contentType: 'application/pdf',
    contentLength: 1024,
    ...overrides,
  } as never)

describe('asking for a direct upload', () => {
  it('issues a ticket the client cannot redirect', async () => {
    const result = (await ask()) as { supported: boolean; url?: string; uploadId?: string }
    expect(result.supported).toBe(true)
    expect(result.url).toBe('https://storage.example.com/signed')
    // The key is minted server-side. A client that could choose it could write
    // outside its tenant's prefix, which is what the whole isolation rests on.
    const call = ticketDriver.createDirectUpload.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(call.tenantId).toBe(scope.tenantId)
    expect(call.orgId).toBe(scope.organizationId)
  })

  it('reserves the quota before the upload is allowed to happen', async () => {
    // Reserving afterwards means the bytes are already stored when the tenant
    // turns out to be over its limit.
    const quotaService = quota()
    await ask({ quotaService })
    expect((quotaService as unknown as { reserve: jest.Mock }).reserve).toHaveBeenCalled()
  })

  it('refuses a dangerous file before any capability exists', async () => {
    await expect(ask({ fileName: 'setup.exe' })).rejects.toBeDefined()
  })

  it('refuses a file over the limit before any capability exists', async () => {
    await expect(ask({ contentLength: 400 * 1024 * 1024 })).rejects.toBeDefined()
  })

  it('sends archives down the path where the server can inspect them', async () => {
    // An archive cannot be inspected before it exists, and accepting one
    // uninspected is the bypass the inspection closes.
    await expect(ask({ fileName: 'bundle.zip' })).resolves.toEqual({ supported: false })
  })

  it('says so when the store cannot presign, rather than failing', async () => {
    // Development runs on the local driver; the client falls back to multipart.
    await expect(ask({ storageDriverFactory: factory({}) })).resolves.toEqual({ supported: false })
  })
})

describe('finalising a direct upload', () => {
  const storagePath = 'chat/org-1/tenant-1/123_abc_report.pdf'
  const { createHash } = require('node:crypto') as typeof import('node:crypto')
  const tokenFor = (user: string, conversation: string) =>
    createHash('sha256').update(`${user}|${conversation}|${storagePath}`).digest('hex')

  const reservation = (overrides: Record<string, unknown> = {}) => ({
    id: 'reservation-1',
    leaseToken: 'lease-1',
    storagePath,
    partitionCode: PARTITION.code,
    reservedBytes: 1024,
    uploadTokenHash: tokenFor(UPLOADER, CONVERSATION),
    ...overrides,
  })

  const driver = (overrides: Record<string, unknown> = {}) => ({
    stat: jest.fn(async () => ({ size: 512, contentType: 'application/pdf' })),
    read: jest.fn(async () => ({ buffer: Buffer.from('%PDF-1.4'), contentType: 'application/pdf' })),
    delete: jest.fn(async () => undefined),
    ...overrides,
  })

  const finalize = (row: unknown, storageDriver: Record<string, unknown>, quotaService = quota()) =>
    finalizeChatDirectUpload({
      em: entityManager(row),
      scope,
      uploaderUserId: UPLOADER,
      conversationId: CONVERSATION,
      uploadId: 'reservation-1',
      storageDriverFactory: factory(storageDriver),
      quotaService,
    } as never)

  it('creates the attachment from what storage says, not what the client said', async () => {
    const storageDriver = driver()
    const attachment = (await finalize(reservation(), storageDriver)) as Record<string, unknown>
    // 512, from `stat` — not the 1024 the ticket was asked for.
    expect(attachment.fileSize).toBe(512)
    expect(attachment.storagePath).toBe(storagePath)
    expect(attachment.tenantId).toBe(scope.tenantId)
  })

  it('settles the scan before returning, rather than leaving the row pending', async () => {
    // `finalizeChatDirectUpload` logs and swallows scan failures so a scanner
    // outage cannot lose an upload that is already stored. That also means a
    // scan which throws every time looks exactly like one that worked, so the
    // verdict is asserted here directly. With no scanner configured the no-op
    // one settles inline and clears the file; a row still `pending` is a file
    // the reader would get a 409 for, forever.
    const attachment = (await finalize(reservation(), driver())) as Record<string, unknown>
    expect(attachment.scanStatus).toBe('clean')
    expect(attachment.scannedAt).toBeInstanceOf(Date)
  })

  it('refuses a reservation that is not this uploader’s', async () => {
    await expect(
      finalize(reservation({ uploadTokenHash: tokenFor('someone-else', CONVERSATION) }), driver()),
    ).rejects.toBeDefined()
  })

  it('refuses a reservation raised for a different conversation', async () => {
    await expect(
      finalize(reservation({ uploadTokenHash: tokenFor(UPLOADER, 'another-conversation') }), driver()),
    ).rejects.toBeDefined()
  })

  it('refuses an upload id that does not exist', async () => {
    await expect(finalize(null, driver())).rejects.toBeDefined()
  })

  it('refuses, and releases the quota, when nothing was actually uploaded', async () => {
    // A client that never uploaded looks exactly like one that succeeded.
    const quotaService = quota()
    const storageDriver = driver({ stat: jest.fn(async () => null) })
    await expect(finalize(reservation(), storageDriver, quotaService)).rejects.toBeDefined()
    expect((quotaService as unknown as { release: jest.Mock }).release).toHaveBeenCalled()
  })

  it('refuses an object larger than what was reserved, and removes it', async () => {
    const quotaService = quota()
    const storageDriver = driver({ stat: jest.fn(async () => ({ size: 99_999_999, contentType: 'application/pdf' })) })
    await expect(finalize(reservation(), storageDriver, quotaService)).rejects.toBeDefined()
    expect(storageDriver.delete).toHaveBeenCalled()
    expect((quotaService as unknown as { release: jest.Mock }).release).toHaveBeenCalled()
  })

  it('refuses an object whose real bytes are an executable, whatever it was called', async () => {
    // The type is sniffed from the stored object. A ticket obtained for a
    // harmless name does not make the thing that landed harmless.
    const storageDriver = driver({
      read: jest.fn(async () => ({ buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00]), contentType: 'application/pdf' })),
    })
    const quotaService = quota()
    await expect(finalize(reservation(), storageDriver, quotaService)).rejects.toBeDefined()
    expect(storageDriver.delete).toHaveBeenCalled()
  })

  it('stages it as a draft owned by the uploader, not as a sent attachment', async () => {
    const attachment = (await finalize(reservation(), driver())) as Record<string, unknown>
    expect(attachment.entityId).toBe('chat:chat_message_draft')
    expect(JSON.stringify(attachment.storageMetadata)).toContain(UPLOADER)
  })
})
