import { z } from 'zod'

export const CHAT_TAG = 'Chat'

export const errorSchema = z.object({ error: z.string() })

export const COMMON_ERRORS = [
  { status: 400, description: 'Validation failed, or no organization scope could be resolved', schema: errorSchema },
  { status: 401, description: 'Authentication required', schema: errorSchema },
  { status: 403, description: 'Forbidden', schema: errorSchema },
  { status: 404, description: 'Not found, or not a conversation the caller belongs to', schema: errorSchema },
] as const

export const RATE_LIMITED_ERRORS = [
  { status: 429, description: 'Rate limit exceeded', schema: errorSchema },
  { status: 503, description: 'Rate limiter unavailable; the write was refused rather than left uncounted', schema: errorSchema },
] as const

export const directoryEntrySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string(),
  roleNames: z.array(z.string()),
})

export const participantSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string(),
})

export const conversationSchema = z.object({
  id: z.string().uuid(),
  counterpart: participantSchema.nullable(),
  lastMessageAt: z.string().nullable(),
  lastMessagePreview: z.string().nullable(),
  lastMessageSenderUserId: z.string().uuid().nullable(),
  unreadCount: z.number(),
  lastReadAt: z.string().nullable(),
  counterpartLastReadAt: z.string().nullable(),
})

export const messageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  senderUserId: z.string().uuid(),
  body: z.string(),
  createdAt: z.string(),
  clientMessageId: z.string().nullable(),
})

export const conversationListSchema = z.object({
  items: z.array(conversationSchema),
  hasMore: z.boolean(),
})

export const messagePageSchema = z.object({
  items: z.array(messageSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
})

export const directoryResponseSchema = z.object({
  items: z.array(directoryEntrySchema),
  truncated: z.boolean(),
})

export const sendMessageResponseSchema = z.object({
  message: messageSchema,
  deduplicated: z.boolean(),
})

export const unreadCountSchema = z.object({ unreadCount: z.number() })

export const markReadResponseSchema = z.object({ lastReadAt: z.string() })

export const markAllReadResponseSchema = z.object({
  conversationIds: z.array(z.string().uuid()),
  lastReadAt: z.string(),
})
