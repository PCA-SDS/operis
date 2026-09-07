/**
 * What chat accepts as an attachment, and how many.
 *
 * The limits are a product decision, so what matters here is that they are one
 * decision — read from a single place, applied to the stored MIME type rather
 * than to anything a client claimed.
 */
import {
  MAX_FILE_ATTACHMENTS_PER_MESSAGE,
  MAX_MEDIA_ATTACHMENTS_PER_MESSAGE,
  checkAttachmentCounts,
  isChatMediaMimeType,
  resolveChatAttachmentLimits,
} from '../lib/attachmentPolicy'
import { chatSendMessageSchema } from '../data/validators'

describe('chat attachment limits', () => {
  const original = { ...process.env }
  afterEach(() => {
    process.env = { ...original }
  })

  it('defaults to the 200 MB per-file ceiling Google Chat uses', () => {
    delete process.env.OM_CHAT_ATTACHMENT_MAX_UPLOAD_MB
    expect(resolveChatAttachmentLimits().maxBytes).toBe(200 * 1024 * 1024)
  })

  it('is configurable without touching code', () => {
    process.env.OM_CHAT_ATTACHMENT_MAX_UPLOAD_MB = '50'
    expect(resolveChatAttachmentLimits().maxBytes).toBe(50 * 1024 * 1024)
  })

  it('ignores a nonsense override rather than disabling the limit', () => {
    // A limit that silently becomes zero or NaN is worse than one that ignores
    // a typo in an environment file.
    process.env.OM_CHAT_ATTACHMENT_MAX_UPLOAD_MB = 'not-a-number'
    expect(resolveChatAttachmentLimits().maxBytes).toBe(200 * 1024 * 1024)
    process.env.OM_CHAT_ATTACHMENT_MAX_UPLOAD_MB = '-5'
    expect(resolveChatAttachmentLimits().maxBytes).toBe(200 * 1024 * 1024)
  })
})

describe('media and file classification', () => {
  it.each(['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm'])(
    'treats %s as media',
    (mimeType) => expect(isChatMediaMimeType(mimeType)).toBe(true),
  )

  it.each(['application/pdf', 'text/csv', 'application/zip', null, undefined, ''])(
    'treats %s as a file',
    (mimeType) => expect(isChatMediaMimeType(mimeType)).toBe(false),
  )
})

describe('per-message counts', () => {
  const media = (count: number) => Array.from({ length: count }, () => 'image/png')
  const files = (count: number) => Array.from({ length: count }, () => 'application/pdf')

  it('allows the documented number of images or videos', () => {
    expect(checkAttachmentCounts(media(MAX_MEDIA_ATTACHMENTS_PER_MESSAGE))).toEqual({ ok: true })
  })

  it('refuses one more than that', () => {
    expect(checkAttachmentCounts(media(MAX_MEDIA_ATTACHMENTS_PER_MESSAGE + 1))).toEqual({
      ok: false,
      reason: 'too_many_media',
    })
  })

  it('allows the documented number of non-media files', () => {
    expect(checkAttachmentCounts(files(MAX_FILE_ATTACHMENTS_PER_MESSAGE))).toEqual({ ok: true })
  })

  it('refuses one more than that', () => {
    expect(checkAttachmentCounts(files(MAX_FILE_ATTACHMENTS_PER_MESSAGE + 1))).toEqual({
      ok: false,
      reason: 'too_many_files',
    })
  })

  it('counts the two kinds separately, so a message may carry both', () => {
    expect(checkAttachmentCounts([...media(5), ...files(1)])).toEqual({ ok: true })
  })

  it('allows a message with no attachments at all', () => {
    expect(checkAttachmentCounts([])).toEqual({ ok: true })
  })
})

describe('a message may be text, an attachment, or both', () => {
  const uuid = '11111111-1111-4111-8111-111111111111'

  it('accepts text on its own', () => {
    expect(chatSendMessageSchema.parse({ body: 'here you go' }).body).toBe('here you go')
  })

  it('accepts an attachment with no text', () => {
    // Sending a file should not require typing a character first (§3).
    const parsed = chatSendMessageSchema.parse({ body: '', attachmentIds: [uuid] })
    expect(parsed.body).toBe('')
    expect(parsed.attachmentIds).toEqual([uuid])
  })

  it('accepts text and an attachment together', () => {
    const parsed = chatSendMessageSchema.parse({ body: 'the report', attachmentIds: [uuid] })
    expect(parsed.body).toBe('the report')
    expect(parsed.attachmentIds).toHaveLength(1)
  })

  it('still refuses a message that is neither', () => {
    expect(() => chatSendMessageSchema.parse({ body: '' })).toThrow()
    expect(() => chatSendMessageSchema.parse({ body: '   \n\t ' })).toThrow()
    expect(() => chatSendMessageSchema.parse({ body: '', attachmentIds: [] })).toThrow()
  })

  it('refuses more attachment ids than a message could ever carry', () => {
    const many = Array.from({ length: 21 }, () => uuid)
    expect(() => chatSendMessageSchema.parse({ body: 'x', attachmentIds: many })).toThrow()
  })
})
