import type { ChatParticipantAccess } from '../data/entities'

/**
 * Levels in a client (external) conversation, lowest first.
 *
 * - `viewer` reads everything and writes internal notes — never to the client.
 * - `participant` also answers the client, reacts, edits and deletes what went out.
 * - `manager` also adds and removes colleagues and sets their levels.
 */
const RANK: Record<ChatParticipantAccess, number> = { viewer: 0, participant: 1, manager: 2 }

export const CHAT_ACCESS_LEVELS: readonly ChatParticipantAccess[] = ['viewer', 'participant', 'manager']

/**
 * A colleague's level. A row from before levels existed was backfilled as
 * `manager` by the migration; a NULL read here is the same promise, never less.
 */
export function accessOf(participant: { access?: ChatParticipantAccess | null } | null | undefined): ChatParticipantAccess {
  return participant?.access ?? 'manager'
}

export function hasAccess(
  participant: { access?: ChatParticipantAccess | null } | null | undefined,
  required: ChatParticipantAccess,
): boolean {
  return RANK[accessOf(participant)] >= RANK[required]
}

export function isChatAccess(value: unknown): value is ChatParticipantAccess {
  return value === 'viewer' || value === 'participant' || value === 'manager'
}
