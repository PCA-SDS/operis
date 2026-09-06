import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import type { ChatScope } from './scope'
import { CHAT_MESSAGE_ATTACHMENT_ENTITY_ID } from './attachments'
import { isChatMediaMimeType } from './attachmentPolicy'

/**
 * Everything shared in a conversation, found again.
 *
 * Three views over two sources rather than three systems: files and media are
 * the same attachment rows split by MIME type, and links are their own index.
 * Splitting files from media in the query rather than in the client is what
 * lets each tab page independently — a workspace with ten thousand photos and
 * six documents should not have to read the photos to show the documents.
 *
 * Every query is bounded and ordered by creation time descending, because "what
 * was shared here" is a question about the recent past far more often than
 * about the beginning.
 */

export const SHARED_PAGE_SIZE = 30
export const MAX_SHARED_PAGE_SIZE = 60

export type SharedKind = 'files' | 'media' | 'links'

export type SharedFileEntry = {
  kind: 'file' | 'media'
  attachmentId: string
  messageId: string
  fileName: string
  mimeType: string
  fileSize: number
  uploaderUserId: string
  createdAt: string
}

export type SharedLinkEntry = {
  kind: 'link'
  id: string
  messageId: string
  url: string
  host: string
  sharedByUserId: string
  createdAt: string
}

export type SharedEntry = SharedFileEntry | SharedLinkEntry

/**
 * Where the previous page stopped.
 *
 * Time plus id, because several files can share a timestamp — a message sent
 * with twenty photos writes twenty rows at one instant — and ordering by time
 * alone would let a page boundary fall inside that group and repeat or skip it.
 */
export type SharedCursor = { createdAt: string; id: string }

export function encodeSharedCursor(cursor: SharedCursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, 'utf8').toString('base64url')
}

export function decodeSharedCursor(raw: string | undefined): SharedCursor | null {
  if (!raw) return null
  try {
    const [createdAt, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|')
    if (!createdAt || !id) return null
    if (Number.isNaN(Date.parse(createdAt))) return null
    return { createdAt, id }
  } catch {
    // A stale bookmark means "start from the top", matching how the transcript's
    // own cursor behaves. Refusing would turn it into an error nobody can act on.
    return null
  }
}

type SharedDatabase = {
  chat_messages: {
    id: string
    conversation_id: string
    tenant_id: string
    organization_id: string
    sender_user_id: string
    kind: string
    deleted_at: Date | null
  }
  chat_message_links: {
    id: string
    message_id: string
    conversation_id: string
    tenant_id: string
    organization_id: string
    url: string
    host: string
    created_at: Date
  }
  attachments: {
    id: string
    entity_id: string
    record_id: string
    tenant_id: string | null
    organization_id: string | null
    file_name: string
    mime_type: string
    file_size: number
    scan_status: string
    created_at: Date
  }
}

export type SharedQueryInput = {
  em: EntityManager
  scope: ChatScope
  conversationId: string
  kind: SharedKind
  limit?: number
  cursor?: string
}

export type SharedResult = {
  items: SharedEntry[]
  nextCursor: string | null
  hasMore: boolean
}

/**
 * Files and media shared in a conversation.
 *
 * The join to `chat_messages` is not decoration: an attachment knows only which
 * message it hangs off, so the message is what ties it to a conversation — and
 * it is also what excludes files whose message was deleted, which is the rule
 * that keeps the panel from pointing at something the transcript no longer has.
 */
async function queryFiles(input: SharedQueryInput & { media: boolean }): Promise<SharedResult> {
  const { em, scope, conversationId, media } = input
  const limit = Math.min(Math.max(input.limit ?? SHARED_PAGE_SIZE, 1), MAX_SHARED_PAGE_SIZE)
  const cursor = decodeSharedCursor(input.cursor)

  const db = em.getKysely<SharedDatabase>()

  let query = db
    .selectFrom('attachments as a')
    .innerJoin('chat_messages as m', (join) =>
      join
        // `record_id` is `text`, because an attachment can hang off any record
        // in any module and not every module keys on a uuid. Postgres will not
        // compare the two without being told to, and the cast has to be on the
        // message side: casting `record_id` to uuid would throw on the first
        // row some other module wrote with a non-uuid key.
        .on(sql<boolean>`m.id::text = a.record_id`)
        .on('m.conversation_id', '=', conversationId)
        .on('m.tenant_id', '=', scope.tenantId)
        .on('m.organization_id', '=', scope.organizationId)
        // A deleted message takes its files out of the panel with it. Leaving
        // them would be an entry that navigates to nothing.
        .on('m.deleted_at', 'is', null)
        .on('m.kind', '=', 'user'),
    )
    .where('a.entity_id', '=', CHAT_MESSAGE_ATTACHMENT_ENTITY_ID)
    .where('a.tenant_id', '=', scope.tenantId)
    .where('a.organization_id', '=', scope.organizationId)
    // Only files that cleared the scan. A panel is a place people download
    // from, so anything not servable has no business being listed there.
    .where('a.scan_status', '=', 'clean')
    .where(
      media
        ? sql<boolean>`(a.mime_type like 'image/%' or a.mime_type like 'video/%')`
        : sql<boolean>`(a.mime_type not like 'image/%' and a.mime_type not like 'video/%')`,
    )

  if (cursor) {
    query = query.where(
      sql<boolean>`(a.created_at, a.id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
    )
  }

  const rows = await query
    .select([
      'a.id as attachmentId',
      'a.record_id as messageId',
      'a.file_name as fileName',
      'a.mime_type as mimeType',
      'a.file_size as fileSize',
      'a.created_at as createdAt',
      'm.sender_user_id as uploaderUserId',
    ])
    .orderBy('a.created_at', 'desc')
    .orderBy('a.id', 'desc')
    // One more than asked for, so "is there another page" costs no second query.
    .limit(limit + 1)
    .execute()

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page[page.length - 1]

  return {
    items: page.map((row) => ({
      kind: isChatMediaMimeType(row.mimeType) ? ('media' as const) : ('file' as const),
      attachmentId: row.attachmentId,
      messageId: row.messageId,
      fileName: row.fileName,
      mimeType: row.mimeType,
      fileSize: Number(row.fileSize),
      uploaderUserId: row.uploaderUserId,
      createdAt: new Date(row.createdAt).toISOString(),
    })),
    hasMore,
    nextCursor:
      hasMore && last
        ? encodeSharedCursor({
            createdAt: new Date(last.createdAt).toISOString(),
            id: last.attachmentId,
          })
        : null,
  }
}

/**
 * Links shared in a conversation, newest first.
 *
 * Joined to the message for two reasons: the sender is who shared the link, and
 * the join is what excludes links whose message was deleted. The keyset is
 * applied in SQL, not after the fact — filtering a page that has already been
 * limited drops rows that should have been on it.
 */
async function queryLinks(input: SharedQueryInput): Promise<SharedResult> {
  const { em, scope, conversationId } = input
  const limit = Math.min(Math.max(input.limit ?? SHARED_PAGE_SIZE, 1), MAX_SHARED_PAGE_SIZE)
  const cursor = decodeSharedCursor(input.cursor)

  const db = em.getKysely<SharedDatabase>()

  let query = db
    .selectFrom('chat_message_links as l')
    .innerJoin('chat_messages as m', (join) =>
      join
        .onRef('m.id', '=', 'l.message_id')
        .on('m.conversation_id', '=', conversationId)
        .on('m.deleted_at', 'is', null)
        .on('m.kind', '=', 'user'),
    )
    .where('l.conversation_id', '=', conversationId)
    .where('l.tenant_id', '=', scope.tenantId)
    .where('l.organization_id', '=', scope.organizationId)

  if (cursor) {
    query = query.where(
      sql<boolean>`(l.created_at, l.id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
    )
  }

  const rows = await query
    .select([
      'l.id as id',
      'l.message_id as messageId',
      'l.url as url',
      'l.host as host',
      'l.created_at as createdAt',
      'm.sender_user_id as sharedByUserId',
    ])
    .orderBy('l.created_at', 'desc')
    .orderBy('l.id', 'desc')
    .limit(limit + 1)
    .execute()

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page[page.length - 1]

  return {
    items: page.map((row) => ({
      kind: 'link' as const,
      id: row.id,
      messageId: row.messageId,
      url: row.url,
      host: row.host,
      sharedByUserId: row.sharedByUserId,
      createdAt: new Date(row.createdAt).toISOString(),
    })),
    hasMore,
    nextCursor:
      hasMore && last
        ? encodeSharedCursor({
            createdAt: new Date(last.createdAt).toISOString(),
            id: last.id,
          })
        : null,
  }
}

/**
 * One entry point for all three views.
 *
 * The caller has already established that this person may read the
 * conversation; scope is still part of every query, because a check made
 * upstream is not a substitute for one the database enforces.
 */
export async function querySharedResources(input: SharedQueryInput): Promise<SharedResult> {
  if (input.kind === 'links') return queryLinks(input)
  return queryFiles({ ...input, media: input.kind === 'media' })
}

/** Counts for the panel's tabs. Bounded, because an exact total is not needed. */
export async function countSharedResources(input: {
  em: EntityManager
  scope: ChatScope
  conversationId: string
}): Promise<{ files: number; media: number; links: number }> {
  const [files, media, links] = await Promise.all([
    querySharedResources({ ...input, kind: 'files', limit: MAX_SHARED_PAGE_SIZE }),
    querySharedResources({ ...input, kind: 'media', limit: MAX_SHARED_PAGE_SIZE }),
    querySharedResources({ ...input, kind: 'links', limit: MAX_SHARED_PAGE_SIZE }),
  ])
  return {
    files: files.items.length,
    media: media.items.length,
    links: links.items.length,
  }
}
