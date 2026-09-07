/**
 * What the client is told about a file.
 *
 * The DTO is a boundary: it decides what leaves the server, and the things it
 * must never carry are exactly the things that would let a cached transcript
 * reach storage on its own.
 */
import { toChatAttachmentDto } from '../lib/attachmentDto'
import { formatFileSize } from '../components/ComposerAttachments'
import type { Attachment } from '@open-mercato/core/modules/attachments/data/entities'

function row(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'attachment-1',
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    fileSize: 2048,
    scanStatus: 'clean',
    createdAt: new Date('2026-09-10T10:00:00.000Z'),
    storagePath: 'tenants/t1/private/abc123.pdf',
    storageDriver: 's3',
    partitionCode: 'privateAttachments',
    url: '/api/attachments/file/attachment-1',
    ...overrides,
  } as Attachment
}

describe('chat attachment DTO', () => {
  it('never leaks where the file is kept', () => {
    // A storage path, a driver and a partition are facts about Operis's
    // buckets. Putting them on the wire is how a private layout ends up in a
    // browser's network tab.
    const dto = toChatAttachmentDto(row()) as Record<string, unknown>
    expect(dto.storagePath).toBeUndefined()
    expect(dto.storageDriver).toBeUndefined()
    expect(dto.partitionCode).toBeUndefined()
    expect(dto.url).toBeUndefined()
    expect(JSON.stringify(dto)).not.toContain('abc123')
  })

  it('carries only what a card needs to be drawn', () => {
    expect(toChatAttachmentDto(row())).toEqual({
      id: 'attachment-1',
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      fileSize: 2048,
      kind: 'file',
      status: 'ready',
      createdAt: '2026-09-10T10:00:00.000Z',
    })
  })

  it('classifies images and videos as media', () => {
    expect(toChatAttachmentDto(row({ mimeType: 'image/png' })).kind).toBe('media')
    expect(toChatAttachmentDto(row({ mimeType: 'video/mp4' })).kind).toBe('media')
  })

  it('reports only a cleared file as ready', () => {
    // `rejected` and `failed` stay distinct: one is "this is dangerous", the
    // other is "we could not tell", and the UI says different things.
    expect(toChatAttachmentDto(row({ scanStatus: 'clean' })).status).toBe('ready')
    expect(toChatAttachmentDto(row({ scanStatus: 'pending' })).status).toBe('pending')
    expect(toChatAttachmentDto(row({ scanStatus: 'infected' })).status).toBe('rejected')
    expect(toChatAttachmentDto(row({ scanStatus: 'failed' })).status).toBe('failed')
  })
})

describe('file sizes as people read them', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [2048, '2.0 KB'],
    [1024 * 1024 * 3.5, '3.5 MB'],
    [1024 * 1024 * 200, '200 MB'],
  ])('renders %i bytes as %s', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected)
  })

  it('says nothing rather than something wrong for a nonsense size', () => {
    expect(formatFileSize(Number.NaN)).toBe('')
    expect(formatFileSize(-1)).toBe('')
  })
})
