/**
 * Finding the `@` the caret is currently inside.
 *
 * Follows the shape `tasks/QuickAddComposer` already uses for its own token
 * menu: walk back from the caret, stop at whitespace, and only treat the `@` as
 * live if it starts a word. That last rule is what stops an email address
 * opening a member menu halfway through typing it.
 */
export type MentionDraft = {
  /** Where the `@` sits, so replacing the token knows what to cut. */
  start: number
  /** What has been typed after it, used to filter the menu. */
  query: string
}

export function detectMentionDraft(value: string, caret: number | null): MentionDraft | null {
  if (caret === null) return null

  for (let index = caret - 1; index >= 0; index -= 1) {
    const char = value[index]!
    // A mention is one word. Hitting whitespace before an `@` means the caret is
    // not inside one.
    if (/\s/.test(char)) return null
    if (char !== '@') continue

    // Only when the `@` starts a word — otherwise `name@example.com` would open
    // the menu as soon as the caret passed the address's `@`.
    const before = index > 0 ? value[index - 1]! : ' '
    if (!/\s/.test(before)) return null

    return { start: index, query: value.slice(index + 1, caret) }
  }
  return null
}

/**
 * Replace the draft token with a finished mention.
 *
 * Returns the new value and where the caret should land, because the caller has
 * to restore it: React re-renders the textarea from state, and without an
 * explicit position the caret jumps to the end of the message.
 */
export function applyMention(
  value: string,
  draft: MentionDraft,
  caret: number,
  token: string,
): { value: string; caret: number } {
  const before = value.slice(0, draft.start)
  const after = value.slice(caret)
  // The trailing space is what lets someone keep typing straight after picking a
  // colleague, and it also closes the draft so the menu does not reopen.
  const inserted = `${token} `
  return { value: `${before}${inserted}${after}`, caret: before.length + inserted.length }
}
