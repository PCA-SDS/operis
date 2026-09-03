import { z } from 'zod'

/**
 * The longest message the server will store.
 *
 * Long enough that no normal workplace message hits it, short enough that a
 * conversation page stays bounded and a paste of a whole document is rejected at
 * the edge rather than swallowed.
 */
export const MAX_MESSAGE_LENGTH = 4000

/** Messages per page. Keeps the first paint small and the payload predictable. */
export const DEFAULT_MESSAGE_PAGE_SIZE = 30
export const MAX_MESSAGE_PAGE_SIZE = 50

export const DEFAULT_CONVERSATION_PAGE_SIZE = 30
/**
 * The ceiling on the conversation list.
 *
 * "Load more" grows the requested limit rather than walking a cursor, so this
 * caps how large one response can get. It is generous for the domain — a person
 * has as many direct conversations as colleagues they talk to — and the list is
 * still one indexed query at the maximum.
 */
export const MAX_CONVERSATION_PAGE_SIZE = 200
/** How much each "load more" adds. */
export const CONVERSATION_PAGE_STEP = 30

/**
 * Control characters that are never legitimate message content: the C0 and C1
 * ranges minus tab and newline, plus DEL. Stripping them stops a body from
 * carrying terminal escape sequences or invisible framing into a log, a CSV
 * export, or a screen reader.
 */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g

/**
 * A message body, normalized before it is measured.
 *
 * Line endings are normalized and control characters removed first, then the
 * result is trimmed — so a body of only whitespace fails the `min(1)` check
 * instead of being stored as an empty bubble.
 */
const messageBodySchema = z
  .string()
  .transform((value) => value.replace(/\r\n?/g, '\n').replace(CONTROL_CHARACTERS, '').trim())
  .pipe(z.string().min(1).max(MAX_MESSAGE_LENGTH))

export const chatDirectoryQuerySchema = z.object({
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(25).optional(),
})

export const chatConversationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_CONVERSATION_PAGE_SIZE).optional(),
})

export const chatCreateConversationSchema = z.object({
  userId: z.string().uuid(),
})

export const chatMessageListQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_MESSAGE_PAGE_SIZE).optional(),
})

export const chatSendMessageSchema = z.object({
  body: messageBodySchema,
  /**
   * Client-generated idempotency key. A retry after a timeout reuses it, and the
   * server returns the message it already stored instead of posting twice.
   */
  clientMessageId: z.string().min(1).max(64).optional(),
})

export const chatMarkReadSchema = z.object({
  /**
   * Read up to this instant. Omitted means "everything currently in the
   * conversation", which is what opening it does.
   */
  readAt: z.string().datetime().optional(),
})

export type ChatDirectoryQuery = z.infer<typeof chatDirectoryQuerySchema>
export type ChatConversationListQuery = z.infer<typeof chatConversationListQuerySchema>
export type ChatCreateConversationInput = z.infer<typeof chatCreateConversationSchema>
export type ChatMessageListQuery = z.infer<typeof chatMessageListQuerySchema>
export type ChatSendMessageInput = z.infer<typeof chatSendMessageSchema>
export type ChatMarkReadInput = z.infer<typeof chatMarkReadSchema>
