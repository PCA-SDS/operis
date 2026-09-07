import { z } from 'zod'
import { isValidIso639 } from '@open-mercato/shared/lib/i18n/iso639'
import { MAX_REACTION_LENGTH, MAX_SPACE_TITLE_LENGTH } from './entities'

export { MAX_REACTION_LENGTH, MAX_SPACE_TITLE_LENGTH }

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

/**
 * The most people one request may add at once — at creation or later.
 *
 * Bounded because each id costs a membership check and a participant row, and
 * because a picker that let someone select an entire organization in one gesture
 * is a mistake with no undo. Adding more is repeating the action, which is cheap.
 */
export const MAX_SPACE_MEMBERS_PER_REQUEST = 50

/** Members returned per page of the member list. */
export const DEFAULT_MEMBER_PAGE_SIZE = 50
export const MAX_MEMBER_PAGE_SIZE = 100

/**
 * A space name, normalized before it is measured.
 *
 * The same treatment a message body gets: line endings normalized, control
 * characters stripped, then trimmed — so a name of only spaces, or one carrying
 * an invisible terminal escape into a log or a CSV export, fails `min(1)` rather
 * than being stored. Internal runs of whitespace collapse to single spaces
 * because a name is one line and "Project   Alpha" is a typo, not a choice.
 */
const spaceTitleSchema = z
  .string()
  .transform((value) =>
    value.replace(/\r\n?/g, ' ').replace(CONTROL_CHARACTERS, '').replace(/\s+/g, ' ').trim(),
  )
  .pipe(z.string().min(1).max(MAX_SPACE_TITLE_LENGTH))

const memberIdsSchema = z
  .array(z.string().uuid())
  .min(1)
  .max(MAX_SPACE_MEMBERS_PER_REQUEST)
  // Duplicates in one request are a client bug, not an error worth refusing:
  // adding the same person twice means adding them once.
  .transform((ids) => [...new Set(ids)])

/**
 * Creating a conversation, of either kind.
 *
 * A discriminated union rather than two endpoints, because both produce the same
 * resource. `kind` is optional and defaults to `direct` so a phase-1 client that
 * posts a bare `{ userId }` keeps working unchanged.
 */
export const chatCreateConversationSchema = z.union([
  z.object({
    kind: z.literal('direct').optional(),
    userId: z.string().uuid(),
  }),
  z.object({
    kind: z.literal('space'),
    title: spaceTitleSchema,
    /**
     * Optional: a space with only its creator is valid, and is what "create it
     * now, add people in a minute" produces.
     */
    memberIds: memberIdsSchema.optional(),
  }),
])

export const chatRenameConversationSchema = z.object({
  title: spaceTitleSchema,
})

export const chatAddMembersSchema = z.object({
  memberIds: memberIdsSchema,
})

export const chatSetMemberRoleSchema = z.object({
  role: z.enum(['owner', 'member']),
})

export const chatMemberListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_MEMBER_PAGE_SIZE).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  q: z.string().max(200).optional(),
})

export const chatMessageListQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_MESSAGE_PAGE_SIZE).optional(),
})

/**
 * The most attachment ids one message may name.
 *
 * The looser of the two product limits (media), because the array cannot tell
 * media from files — the real per-kind check happens server-side once the rows
 * are read and their true types are known.
 */
export const MAX_MESSAGE_ATTACHMENTS = 20

/**
 * The same normalisation as `messageBodySchema`, without the `min(1)`.
 *
 * A message may be text, an attachment, or both (§3), so "is there anything
 * here" is a question about the whole payload and not about this field — the
 * refinement below asks it once the attachments are also in view. Sending a
 * file should not require typing a character first.
 */
const sendMessageBodySchema = z
  .string()
  .transform((value) => value.replace(/\r\n?/g, '\n').replace(CONTROL_CHARACTERS, '').trim())
  .pipe(z.string().max(MAX_MESSAGE_LENGTH))

export const chatSendMessageSchema = z.object({
  body: sendMessageBodySchema,
  /**
   * The message this replies to. Validated server-side against the conversation
   * it is being sent to — a client cannot make a message reference one from
   * somewhere else by naming it here.
   */
  replyToMessageId: z.string().uuid().optional(),
  /**
   * Client-generated idempotency key. A retry after a timeout reuses it, and the
   * server returns the message it already stored instead of posting twice.
   */
  clientMessageId: z.string().min(1).max(64).optional(),
  /**
   * Drafts to carry on this message.
   *
   * Ids only. Everything else about the file — who staged it, which
   * conversation, whether the scan cleared it — is read from the server's own
   * row, because a client that could assert those could attach somebody else's
   * file.
   */
  attachmentIds: z.array(z.string().uuid()).max(MAX_MESSAGE_ATTACHMENTS).optional(),
}).refine(
  (value) => value.body.length > 0 || (value.attachmentIds?.length ?? 0) > 0,
  {
    // Reported against `body` because that is the field a composer with nothing
    // in it would highlight.
    path: ['body'],
    message: 'A message needs either text or an attachment.',
  },
)

/**
 * A reaction is a single emoji, and nothing else.
 *
 * Bounded by grapheme count rather than by code points, because one emoji can be
 * several joined code points — a flag, a skin tone, a family. Anything that
 * renders as more than one character is a message, not a reaction, and belongs
 * in the composer.
 */
export const chatReactionSchema = z.object({
  emoji: z
    .string()
    .trim()
    .min(1)
    .max(MAX_REACTION_LENGTH)
    .refine(
      (value) => [...new Intl.Segmenter().segment(value)].length === 1,
      { message: 'A reaction must be a single emoji.' },
    )
    // No control characters, for the same reason a message body strips them:
    // they carry terminal escapes into logs and exports.
    .refine((value) => !CONTROL_CHARACTERS.test(value), { message: 'Invalid reaction.' }),
})


export const chatMessageContextQuerySchema = z.object({
  /** Centre the returned window on this message — how pin navigation reaches history. */
  around: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(MAX_MESSAGE_PAGE_SIZE).optional(),
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
export type ChatRenameConversationInput = z.infer<typeof chatRenameConversationSchema>
export type ChatAddMembersInput = z.infer<typeof chatAddMembersSchema>
export type ChatSetMemberRoleInput = z.infer<typeof chatSetMemberRoleSchema>
export type ChatMemberListQuery = z.infer<typeof chatMemberListQuerySchema>
export type ChatMessageListQuery = z.infer<typeof chatMessageListQuerySchema>
export type ChatSendMessageInput = z.infer<typeof chatSendMessageSchema>
export type ChatMarkReadInput = z.infer<typeof chatMarkReadSchema>
export type ChatReactionInput = z.infer<typeof chatReactionSchema>
export type ChatMessageContextQuery = z.infer<typeof chatMessageContextQuerySchema>

/**
 * How many messages one translate request may name.
 *
 * The header control asks for the loaded page in a single call rather than one
 * request per message; a page is 30, and the ceiling leaves room for a longer
 * one without letting a caller queue arbitrary work on the engine.
 */
export const MAX_TRANSLATE_BATCH = 60

/**
 * ISO-639-1, validated against the real table rather than the five UI locales.
 * The languages colleagues write to each other in are not limited to the
 * languages the interface ships in - which is the entire reason the reading
 * language is a separate setting.
 */
const translationLocaleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((value) => isValidIso639(value), { message: 'Unknown language code' })

export const chatTranslateSchema = z.object({
  messageIds: z.array(z.string().uuid()).min(1).max(MAX_TRANSLATE_BATCH),
  targetLocale: translationLocaleSchema,
})

export const chatSetLocaleSchema = z.object({
  // Null clears the preference and falls back to the interface language.
  translationLocale: translationLocaleSchema.nullable(),
})

export type ChatTranslateInput = z.infer<typeof chatTranslateSchema>
export type ChatSetLocaleInput = z.infer<typeof chatSetLocaleSchema>

/**
 * Message search input.
 *
 * The query is bounded before it reaches the parser, so an oversized payload is
 * refused by the schema rather than truncated somewhere downstream. Filters use
 * canonical ids rather than display names: two colleagues may share a name, and
 * a name is not a stable handle.
 */
export const MAX_SEARCH_QUERY_LENGTH = 256
export const DEFAULT_SEARCH_PAGE_SIZE = 20
export const MAX_SEARCH_PAGE_SIZE = 50
/** Past this the exact number costs more to produce than it is worth. */
export const SEARCH_COUNT_CAP = 500

const searchFiltersSchema = z.object({
  from: z
    .string()
    .transform((value) => value.split(',').map((id) => id.trim()).filter(Boolean))
    .pipe(z.array(z.string().uuid()).max(20))
    .optional(),
  after: z.coerce.date().optional(),
  before: z.coerce.date().optional(),
  pinned: z.enum(['true', 'false']).optional(),
})

export const chatMessageSearchQuerySchema = searchFiltersSchema.extend({
  q: z.string().trim().min(1).max(MAX_SEARCH_QUERY_LENGTH),
  limit: z.coerce.number().int().min(1).max(MAX_SEARCH_PAGE_SIZE).optional(),
  cursor: z.string().optional(),
})

export type ChatMessageSearchQuery = z.infer<typeof chatMessageSearchQuerySchema>
