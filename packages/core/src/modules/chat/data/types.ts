/**
 * The wire shapes. Everything the browser sees about a person is what a
 * colleague already sees in the staff directory — id, display name, work email,
 * role names. No internal scope ids, no tenant or organization ids, and no
 * columns the UI does not render.
 */

export type ChatDirectoryEntryDto = {
  id: string
  name: string
  email: string
  roleNames: string[]
}

export type ChatParticipantDto = {
  id: string
  name: string
  email: string
}

export type ChatConversationDto = {
  id: string
  /** The other person in a direct conversation; null when they left the organization. */
  counterpart: ChatParticipantDto | null
  lastMessageAt: string | null
  lastMessagePreview: string | null
  lastMessageSenderUserId: string | null
  unreadCount: number
  lastReadAt: string | null
}

export type ChatMessageDto = {
  id: string
  conversationId: string
  senderUserId: string
  body: string
  createdAt: string
  clientMessageId: string | null
}

export type ChatConversationListDto = {
  items: ChatConversationDto[]
  /**
   * Whether more conversations exist beyond the requested limit.
   *
   * The conversation list is a bounded "top N", not a cursor walk: its ordering
   * key (`last_message_at`) is rewritten by every send, and a descending keyset
   * cannot return a row that has moved above the cursor — so a conversation
   * bumped mid-scroll silently vanished from the list at the moment it became
   * most relevant. Asking for a larger N re-reads the current top in the current
   * order, which has no such gap.
   */
  hasMore: boolean
}

export type ChatMessagePageDto = {
  items: ChatMessageDto[]
  /**
   * Cursor for the page *before* these messages — older history. Messages come
   * back oldest-first for rendering, but paging walks backwards from newest.
   */
  nextCursor: string | null
  hasMore: boolean
}

export type ChatSendMessageResultDto = {
  message: ChatMessageDto
  /** True when an idempotency key matched an existing message and nothing was written. */
  deduplicated: boolean
}

export type ChatUnreadCountDto = {
  unreadCount: number
}
