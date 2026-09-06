import type {
  ChatConversationKind,
  ChatMessageKind,
  ChatParticipantRole,
  ChatSystemEvent,
} from './entities'

export type { ChatConversationKind, ChatMessageKind, ChatParticipantRole, ChatSystemEvent }

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

/** A person in a space, with their standing in it. */
export type ChatMemberDto = ChatParticipantDto & {
  role: ChatParticipantRole
  joinedAt: string
}

export type ChatMemberListDto = {
  items: ChatMemberDto[]
  /** Total members, so the header can say "8 members" without loading all of them. */
  total: number
  hasMore: boolean
}

export type ChatConversationDto = {
  id: string
  kind: ChatConversationKind
  /**
   * What to call this conversation. The space's own name, or the other person's
   * for a direct — resolved server-side so every surface renders the same label
   * without each one reimplementing the fallback.
   */
  title: string
  /** Members of a space, excluding the caller. Empty for a direct. */
  memberCount: number
  /** The caller's own standing. `member` in a direct, where it is not read. */
  viewerRole: ChatParticipantRole
  /** The other person in a direct conversation; null for a space, and null when they left the organization. */
  counterpart: ChatParticipantDto | null
  lastMessageAt: string | null
  lastMessagePreview: string | null
  lastMessageSenderUserId: string | null
  unreadCount: number
  /**
   * Whether any of those unread messages names the viewer, directly or through
   * `@everyone`. One badge with two states rather than a second counter.
   */
  hasUnreadMention: boolean
  /** How many messages are pinned here, for the header control. */
  pinnedCount: number
  lastReadAt: string | null
  /**
   * How far the other person has read, which is the read receipt for everything
   * you have sent: a message of yours is read once this passes its `createdAt`.
   *
   * `null` means they have never opened the conversation — not that nothing has
   * been read, and not that they are offline. Delivery is a separate thing: a
   * stored message is delivered, so its own `createdAt` is the delivery time.
   */
  counterpartLastReadAt: string | null
}

/**
 * The message a reply points at, as rendered in the quote strip.
 *
 * Resolved server-side in one batch per page rather than fetched per bubble, and
 * deliberately not the full message: a quote shows an author and a truncated
 * line, so sending more would be payload nobody renders.
 */
export type ChatReplyTargetDto = {
  id: string
  senderUserId: string
  /** The original author's display name, resolved with the page. */
  senderName: string
  /** Truncated to a single preview line. Empty when the target was deleted. */
  body: string
  /** The original is gone; the quote renders "Original message unavailable". */
  deleted: boolean
}

/**
 * One emoji on one message, already aggregated.
 *
 * The client never sees the individual rows: it gets the emoji, how many people
 * chose it, whether the viewer is one of them, and a short list of names for the
 * tooltip. Sending the rows would make a busy message the most expensive thing
 * on the page and would leak the full reactor list of a large space into every
 * transcript payload.
 */
export type ChatReactionDto = {
  emoji: string
  count: number
  /** Whether the viewer holds this emoji — what the toggle needs to know. */
  mine: boolean
  /** A few reactor names for the tooltip, capped server-side. */
  sampleNames: string[]
}

export type ChatPinnedMessageDto = {
  messageId: string
  pinnedByUserId: string
  pinnedByName: string
  pinnedAt: string
  senderUserId: string
  senderName: string
  /** Truncated for the panel — a pin is a pointer, not a second transcript. */
  preview: string
  createdAt: string
  /** True when the pinned message is itself a reply, so the panel can say so. */
  isReply: boolean
}

export type ChatPinnedListDto = {
  items: ChatPinnedMessageDto[]
  total: number
}

/** See `lib/attachmentDto.ts`; re-exported so DTO consumers need one import. */
export type ChatAttachmentDto = {
  id: string
  fileName: string
  mimeType: string
  fileSize: number
  kind: 'media' | 'file'
  status: 'pending' | 'ready' | 'rejected' | 'failed'
  createdAt: string
}

export type ChatMessageDto = {
  id: string
  conversationId: string
  senderUserId: string
  /**
   * The sender's display name, resolved server-side with the page.
   *
   * A space's transcript can carry messages from anyone in it, so the client
   * would otherwise need the whole membership loaded just to label a bubble —
   * and would still be wrong for a message from someone who has since left.
   */
  senderName: string
  kind: ChatMessageKind
  body: string
  createdAt: string
  clientMessageId: string | null
  /** The message this replies to, already resolved. Null for a normal message. */
  replyTo: ChatReplyTargetDto | null
  /** Which membership change this row records. Null for `kind: 'user'`. */
  systemEvent: ChatSystemEvent | null
  /** Who the membership change was about. The actor is `senderUserId`. */
  systemTargetUserId: string | null
  /** That person's display name, so a system line reads without a member fetch. */
  systemTargetName: string | null
  /** Aggregated reactions, newest emoji last. Empty when nobody has reacted. */
  reactions: ChatReactionDto[]
  /**
   * Display names for the people this message names, so the transcript can
   * render `<@id>` tokens without a lookup of its own.
   */
  mentionNames: Record<string, string>
  /** Whether this message addressed the whole space. */
  mentionsEveryone: boolean
  /** Whether this message is pinned in its conversation. */
  pinned: boolean
  /**
   * Files carried by this message.
   *
   * Metadata only — never a storage path or a download URL. The id is the
   * stable reference and the client asks for bytes through an authorized
   * endpoint, so a transcript that is cached, logged or forwarded carries no
   * means of reaching the file.
   */
  attachments: ChatAttachmentDto[]
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

/** One message rendered into the reader's language. */
export type ChatTranslationDto = {
  messageId: string
  /** Null when nothing was produced; `skipped` says why. */
  body: string | null
  sourceLocale: string | null
  cached: boolean
  skipped?:
    | 'same-language'
    | 'nothing-to-translate'
    | 'unsupported-language'
    | 'detection-declined'
    | 'unavailable'
    | 'overloaded'
    | 'deadline-exceeded'
    | 'mentions-unsafe'
    | 'failed'
}

export type ChatTranslationListDto = { translations: ChatTranslationDto[] }

export type ChatSettingsDto = {
  /** ISO-639-1, or null to follow the interface language. */
  translationLocale: string | null
  /**
   * What the engine registered on this deployment can translate into. Empty
   * when none is configured. Every ISO-639-1 code stays choosable regardless —
   * this is what the picker uses to say which choices will actually work.
   */
  translatableLocales: string[]
}

/** One entry in the Shared panel: a file, a piece of media, or a link. */
export type ChatSharedFileDto = {
  kind: 'file' | 'media'
  attachmentId: string
  messageId: string
  fileName: string
  mimeType: string
  fileSize: number
  uploaderUserId: string
  uploaderName: string
  createdAt: string
}

export type ChatSharedLinkDto = {
  kind: 'link'
  id: string
  messageId: string
  url: string
  host: string
  sharedByUserId: string
  sharedByName: string
  createdAt: string
}

export type ChatSharedEntryDto = ChatSharedFileDto | ChatSharedLinkDto

export type ChatSharedResourcesDto = {
  items: ChatSharedEntryDto[]
  nextCursor: string | null
  hasMore: boolean
}

/**
 * The answer to "may I upload straight to storage?".
 *
 * `supported: false` is a normal answer, not a failure: the deployment's store
 * cannot presign, and the client should use the multipart endpoint instead.
 */
export type ChatDirectUploadTicketDto =
  | {
      supported: true
      uploadId: string
      url: string
      method: 'PUT'
      headers: Record<string, string>
      expiresAt: string
    }
  | { supported: false }
