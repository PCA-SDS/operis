/**
 * Deciding whether a line of chat is a command, and never guessing.
 *
 * Pure and isomorphic, like `lib/mentionDraft.ts` beside it, so the composer's
 * menu and any test can reach the same answer without a request.
 *
 * Two separate questions, deliberately not one:
 *
 * - **Should the menu be open?** Only while the caret is still inside a leading
 *   `/token` — the moment a space is typed the menu closes, because from then on
 *   the line is being written rather than picked from a list.
 * - **Did the writer mean a command?** Only when the first token is *exactly* a
 *   command this build offers. `/etc/passwd is unreadable` and
 *   `see /docs/setup for the steps` are ordinary messages and must stay ordinary:
 *   a slash is punctuation far more often than it is a verb, and a composer that
 *   swallowed either would be worse than one with no commands at all.
 *
 * A slash anywhere but the first character is never a command, so nothing inside
 * a URL, a pasted block, a quote or a code fragment can become one.
 */

/** The leading `/token` the caret currently sits inside, if it does. */
export type SlashCommandDraft = {
  /** What follows the slash, used to filter the menu. */
  query: string
}

/** The characters a command name may contain. Anything else ends the token. */
const COMMAND_TOKEN = /^\/([a-zA-Z0-9_-]*)$/

/**
 * The menu is open while the caret is inside a leading command token.
 *
 * `caret` matters: moving the caret back into an earlier word of a long line must
 * not reopen a menu over text that is no longer being typed.
 */
export function detectSlashCommandDraft(value: string, caret: number | null): SlashCommandDraft | null {
  if (caret === null) return null
  if (!value.startsWith('/')) return null
  const head = value.slice(0, caret)
  const match = COMMAND_TOKEN.exec(head)
  if (!match) return null
  return { query: match[1] ?? '' }
}

export type SlashCommandInvocation = {
  /** The command name, without the slash and folded to lower case. */
  name: string
  /** Everything after the command token, trimmed. Empty when there was nothing. */
  argument: string
}

/**
 * The command this line explicitly names, or null.
 *
 * `known` is the set of command names this build offers — resolved from the
 * modules that claimed the composer spot, so a name is only a command while
 * something is there to run it. An unknown leading token is not a command and
 * not an error: it is a message that happens to start with a slash.
 *
 * The token must be followed by end-of-line or a single space. `/tasks/2026` is
 * therefore a path, not the `tasks` command with a stray argument.
 */
export function resolveSlashCommand(
  value: string,
  known: readonly string[],
): SlashCommandInvocation | null {
  if (!value.startsWith('/')) return null
  const firstLine = value.split('\n', 1)[0] ?? ''
  const match = /^\/([a-zA-Z0-9_-]+)(?:[ \t]+([\s\S]*))?$/.exec(
    firstLine === value ? value : firstLine,
  )
  if (!match) return null
  const name = (match[1] ?? '').toLowerCase()
  if (!known.some((candidate) => candidate.toLowerCase() === name)) return null

  // Everything after the first line belongs to the argument too — a writer who
  // used Shift+Enter inside a command's description meant to keep those lines.
  const rest = firstLine === value ? (match[2] ?? '') : `${match[2] ?? ''}\n${value.slice(firstLine.length + 1)}`
  return { name, argument: rest.trim() }
}
