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
  kind: z.enum(['direct', 'space']),
  title: z.string(),
  memberCount: z.number(),
  viewerRole: z.enum(['owner', 'member']),
})

export const memberSchema = participantSchema.extend({
  role: z.enum(['owner', 'member']),
  joinedAt: z.string(),
})

export const memberListSchema = z.object({
  items: z.array(memberSchema),
  total: z.number(),
  hasMore: z.boolean(),
})

export const addMembersResponseSchema = z.object({ added: z.array(z.string().uuid()) })
export const removeMemberResponseSchema = z.object({
  removed: z.string().uuid(),
  spaceDeleted: z.boolean(),
})
export const memberRoleResponseSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['owner', 'member']),
})

export const replyTargetSchema = z.object({
  id: z.string().uuid(),
  senderUserId: z.string(),
  senderName: z.string(),
  body: z.string(),
  deleted: z.boolean(),
})

export const messageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  senderUserId: z.string().uuid(),
  senderName: z.string(),
  body: z.string(),
  createdAt: z.string(),
  clientMessageId: z.string().nullable(),
  kind: z.enum(['user', 'system']),
  replyTo: replyTargetSchema.nullable(),
  systemEvent: z
    .enum(['member_added', 'member_removed', 'member_left', 'space_renamed'])
    .nullable(),
  systemTargetUserId: z.string().uuid().nullable(),
  systemTargetName: z.string().nullable(),
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
