import type { EntityManager } from '@mikro-orm/postgresql'
import { ChatMessage } from '../data/entities'
import type { ChatReplyTargetDto } from '../data/types'
import { loadOrganizationMembers, type ChatScope } from './scope'

/**
 * How much of the original travels with a reply.
 *
 * This is a PAYLOAD bound, not the visual one — the quote is clamped to three
 * rendered lines in CSS, which is the only truncation a reader sees. The cap
 * just has to be comfortably more than three lines can hold at any pane width
 * (roughly 90 characters a line at the widest) so the clamp always has enough
 * text to fill, and small enough that a page of 30 replies stays a modest
 * response.
 */
export const REPLY_PREVIEW_LENGTH = 300

/**
 * The original as the quote carries it: its own text, capped.
 *
 * Deliberately NOT `buildMessagePreview`. That builds a one-line row for the
 * conversation list, so it collapses newlines and caps at 200 — and routing
 * through it meant the quote silently kept the 200 and lost the message's
 * shape, while the card renders `whitespace-pre-wrap` and expects to see it.
 * A two-line question quoted here should read as two lines.
 */
function truncate(body: string): string {
  const trimmed = body.trim()
  return trimmed.length > REPLY_PREVIEW_LENGTH
    ? `${trimmed.slice(0, REPLY_PREVIEW_LENGTH - 1)}…`
    : trimmed
}

/**
 * The reply targets for a page of messages, in one query.
 *
 * Called once per page rather than once per message: a transcript where every
 * bubble is a reply would otherwise be 30 extra round trips to render 30 rows.
 *
 * The lookup is pinned to the same conversation and scope as the page it
 * decorates, so even a row whose `reply_to_message_id` somehow pointed elsewhere
 * would resolve to "unavailable" rather than leaking a line of text from another
 * conversation. The composite foreign key makes that unreachable; this makes it
 * unreachable twice.
 *
 * A target that is missing or soft-deleted comes back as `deleted: true` with an
 * empty body instead of being dropped, so the UI can say "original message
 * unavailable" rather than rendering a reply that appears to quote nothing.
 */
export async function resolveReplyTargets(
  em: EntityManager,
  scope: ChatScope,
  conversationId: string,
  messages: readonly ChatMessage[],
  /**
   * Display names already loaded by the caller. The transcript resolves every
   * sender on the page anyway, and an original is almost always one of them —
   * so passing them in usually makes this cost zero extra name lookups.
   */
  knownNames?: ReadonlyMap<string, string>,
  fallbackName = '',
): Promise<Map<string, ChatReplyTargetDto>> {
  const resolved = new Map<string, ChatReplyTargetDto>()
  const targetIds = [
    ...new Set(
      messages
        .map((message) => message.replyToMessageId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ]
  if (targetIds.length === 0) return resolved

  const targets = await em.find(ChatMessage, {
    id: { $in: targetIds },
    conversationId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })

  // Only the authors the caller did not already have. In the common case —
  // replying to something visible on screen — this list is empty and no query
  // runs at all.
  const missingAuthorIds = [
    ...new Set(
      targets
        .map((target) => target.senderUserId)
        .filter((userId) => !(knownNames?.has(userId) ?? false)),
    ),
  ]
  const extraNames =
    missingAuthorIds.length > 0
      ? await loadOrganizationMembers(em, scope, missingAuthorIds)
      : new Map<string, { name: string }>()

  for (const target of targets) {
    resolved.set(target.id, {
      id: target.id,
      senderUserId: target.senderUserId,
      senderName:
        knownNames?.get(target.senderUserId) ??
        extraNames.get(target.senderUserId)?.name ??
        fallbackName,
      body: target.deletedAt ? '' : truncate(target.body),
      deleted: Boolean(target.deletedAt),
    })
  }

  // An id with no row at all — a target hard-removed outside this module — is
  // still represented, so the quote degrades to "unavailable" instead of the
  // reply silently losing its reference.
  for (const id of targetIds) {
    if (resolved.has(id)) continue
    resolved.set(id, { id, senderUserId: '', senderName: fallbackName, body: '', deleted: true })
  }

  return resolved
}

/** The single-message form, for the send command's response. */
export async function resolveReplyTarget(
  em: EntityManager,
  scope: ChatScope,
  message: ChatMessage,
  fallbackName = '',
): Promise<ChatReplyTargetDto | null> {
  if (!message.replyToMessageId) return null
  const resolved = await resolveReplyTargets(
    em,
    scope,
    message.conversationId,
    [message],
    undefined,
    fallbackName,
  )
  return resolved.get(message.replyToMessageId) ?? null
}
