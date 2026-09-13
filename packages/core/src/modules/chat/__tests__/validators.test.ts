import {
  chatCreateConversationSchema,
  chatEditMessageSchema,
  chatMessageListQuerySchema,
  chatSendMessageSchema,
  MAX_MESSAGE_LENGTH,
  MAX_MESSAGE_PAGE_SIZE,
} from '../data/validators'

describe('chatSendMessageSchema', () => {
  it('accepts an ordinary message', () => {
    const parsed = chatSendMessageSchema.parse({ body: 'Standup in five?' })
    expect(parsed.body).toBe('Standup in five?')
  })

  it('rejects an empty body', () => {
    expect(() => chatSendMessageSchema.parse({ body: '' })).toThrow()
  })

  it('rejects a whitespace-only body — a blank bubble is not a message', () => {
    expect(() => chatSendMessageSchema.parse({ body: '   \n\t  ' })).toThrow()
  })

  it('keeps intentional newlines and tabs', () => {
    const parsed = chatSendMessageSchema.parse({ body: 'line one\nline two\tindented' })
    expect(parsed.body).toBe('line one\nline two\tindented')
  })

  it('normalizes CRLF so the stored body matches what was typed', () => {
    expect(chatSendMessageSchema.parse({ body: 'a\r\nb' }).body).toBe('a\nb')
  })

  it('strips control characters that could carry terminal escapes', () => {
    const parsed = chatSendMessageSchema.parse({ body: 'safe\u001b[31m text' })
    expect(parsed.body).toBe('safe[31m text')
  })

  it('strips a NUL byte rather than storing it', () => {
    expect(chatSendMessageSchema.parse({ body: 'a\u0000b' }).body).toBe('ab')
  })

  it('rejects a body over the length limit', () => {
    expect(() => chatSendMessageSchema.parse({ body: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) })).toThrow()
  })

  it('accepts a body exactly at the limit', () => {
    expect(chatSendMessageSchema.parse({ body: 'x'.repeat(MAX_MESSAGE_LENGTH) }).body).toHaveLength(
      MAX_MESSAGE_LENGTH,
    )
  })

  it('carries the idempotency key through when supplied', () => {
    expect(chatSendMessageSchema.parse({ body: 'hi', clientMessageId: 'abc' }).clientMessageId).toBe('abc')
  })
})

describe('chatEditMessageSchema', () => {
  it('accepts a rewritten body', () => {
    expect(chatEditMessageSchema.parse({ body: 'the corrected wording' })).toEqual({
      body: 'the corrected wording',
    })
  })

  /**
   * Unlike a send, which may be an attachment on its own. An edit that emptied
   * the body would be a deletion wearing a different name, and it would strand
   * the attachments on a message with nothing left to read.
   */
  it('rejects an empty body, which a send would allow alongside a file', () => {
    expect(() => chatEditMessageSchema.parse({ body: '' })).toThrow()
    expect(() => chatEditMessageSchema.parse({ body: '   ' })).toThrow()
  })

  it('applies the same normalisation a send does', () => {
    // Otherwise editing would be a way to store what a send refuses.
    expect(chatEditMessageSchema.parse({ body: '  line one\r\nline two  ' })).toEqual({
      body: 'line one\nline two',
    })
    expect(chatEditMessageSchema.parse({ body: 'clean\u0007ed' })).toEqual({ body: 'cleaned' })
  })

  it('applies the same length ceiling', () => {
    expect(() => chatEditMessageSchema.parse({ body: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) })).toThrow()
    expect(chatEditMessageSchema.parse({ body: 'x'.repeat(MAX_MESSAGE_LENGTH) }).body).toHaveLength(
      MAX_MESSAGE_LENGTH,
    )
  })

  it('takes nothing but the body — attachments are not editable', () => {
    const parsed = chatEditMessageSchema.parse({
      body: 'ok',
      attachmentIds: ['11111111-1111-4111-8111-111111111111'],
    })
    expect(parsed).toEqual({ body: 'ok' })
  })
})

describe('chatCreateConversationSchema', () => {
  it('requires a uuid, so a forged non-uuid id never reaches the command', () => {
    expect(() => chatCreateConversationSchema.parse({ userId: 'someone-else' })).toThrow()
  })

  it('accepts a uuid', () => {
    const userId = '11111111-1111-4111-8111-111111111111'
    expect(chatCreateConversationSchema.parse({ userId }).userId).toBe(userId)
  })
})

describe('chatMessageListQuerySchema', () => {
  it('caps the page size so a caller cannot ask for the whole history', () => {
    expect(() => chatMessageListQuerySchema.parse({ limit: String(MAX_MESSAGE_PAGE_SIZE + 1) })).toThrow()
  })

  it('coerces a numeric limit from the query string', () => {
    expect(chatMessageListQuerySchema.parse({ limit: '10' }).limit).toBe(10)
  })
})
