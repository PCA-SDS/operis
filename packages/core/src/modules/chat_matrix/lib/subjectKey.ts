/**
 * The identity of a mirrored thing that is not a message.
 *
 * `chat_message_reactions` is unique on (message, user, emoji) and its row is
 * DELETED on un-react, so the mapping between an Operis reaction and its Matrix
 * annotation cannot be keyed on a row id. It is keyed on the tuple instead,
 * which is unique by construction and survives the row.
 *
 * It lives in its own file because both directions need it and neither should
 * import the other: the transport writes the key when it mirrors a reaction
 * outward, and the projector writes the same key when it records one arriving
 * inward — which is what makes the outbound mirror recognise an inbound
 * reaction as already represented and decline to send it straight back.
 */
export function reactionSubjectKey(input: {
  messageId: string
  userId: string
  emoji: string
}): string {
  return `reaction:${input.messageId}:${input.userId}:${input.emoji}`
}

/**
 * The identity of one file copied into the media repo.
 *
 * An attachment is not a message and has no `chat_matrix_events.message_id` of
 * its own, so it is keyed the same way a reaction is. Keying it makes a retried
 * publish find the copy it already made instead of uploading the bytes again
 * and putting a second `m.image` in the room.
 */
export function attachmentSubjectKey(attachmentId: string): string {
  return `attachment:${attachmentId}`
}

/**
 * The identity of one revision of a message, and of its removal.
 *
 * Neither an edit nor a redaction gets a `message_id` mapping — that one
 * belongs to the message itself and there is only ever one of it — so without
 * these the events they produce come back on the next `/sync` as things Operis
 * has never seen. The projector then applies its own edit again, or deletes an
 * already-deleted message. Both converge and neither is harmful, but "we
 * re-project what we sent" is the exact property the loop is built not to have.
 *
 * The edit key carries `editedAt` because a message can be edited many times
 * and each revision is its own event; a message is deleted once, so its
 * redaction needs no discriminator.
 */
export function editSubjectKey(messageId: string, editedAt: Date): string {
  return `edit:${messageId}:${editedAt.toISOString()}`
}

export function redactionSubjectKey(messageId: string): string {
  return `redaction:${messageId}`
}
