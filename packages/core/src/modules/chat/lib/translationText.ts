import { EVERYONE_TOKEN, MENTION_TOKEN, userToken } from './mentions'

/**
 * Preparing a message body for a translation engine, and putting it back
 * together afterwards.
 *
 * Two things here are correctness, not polish. Both corrupt data rather than
 * degrade it, and both are invisible until someone reports nonsense.
 */

/**
 * Compose every string that crosses this boundary.
 *
 * Vietnamese stacks diacritics: `ế` is a single codepoint in NFC and three in
 * NFD, and both render identically. Postgres stores exactly the bytes it is
 * given, so an engine that answers in the other normalisation produces rows
 * that look right, compare unequal to the same text typed by a human, and miss
 * every cache lookup keyed on the string -- meaning the same message is
 * re-translated forever at cost, with no visible symptom.
 *
 * NFC is what browsers submit and what the rest of the product already holds,
 * so it is the form to converge on.
 */
export function normalizeText(value: string): string {
  return value.normalize('NFC')
}

/** A mention lifted out of the body, and the opaque marker left in its place. */
type Placeholder = { marker: string; token: string }

/**
 * Private Use Area, which no natural language uses and no translation model
 * emits. A marker built from ASCII letters or digits would be translated,
 * reordered, case-folded or split by tokenisation like any other word.
 */
const MARKER_OPEN = '\uE000'
const MARKER_CLOSE = '\uE001'

/**
 * The index inside a marker, at a fixed width.
 *
 * Padding is what keeps one index from being a prefix of another. With plain
 * integers, the pattern for marker `1` matches the leading digit of marker `10`
 * the moment an engine drops the opening delimiter, so one mention is restored
 * over another's digits and both are lost.
 */
function markerIndex(index: number): string {
  return String(index).padStart(2, '0')
}

/**
 * A marker the engine mangled but did not erase.
 *
 * Some engines strip one Private Use Area character and keep its neighbour and
 * the digits between them. At least one delimiter must survive for this to
 * match: a pattern that accepted bare digits would rewrite ordinary numbers in
 * the message -- "0 blockers" becomes a mention -- and, worse, would match a
 * digit inside a UUID this function had already appended for an earlier
 * placeholder, nesting one mention inside another and destroying both.
 */
function looseMarkerPattern(index: number): RegExp {
  const digits = markerIndex(index)
  return new RegExp(
    `${MARKER_OPEN}\\s*${digits}\\s*${MARKER_CLOSE}?|${MARKER_OPEN}?\\s*${digits}\\s*${MARKER_CLOSE}`,
  )
}

/**
 * Remove Private Use Area delimiters the sender typed.
 *
 * U+E000 is the start of the icon-font range, so a glyph pasted from Font
 * Awesome or Material Icons carries one into the body. Left in place it is
 * indistinguishable from a delimiter this module wrote, and a body can forge a
 * marker that swallows another mention's restoration.
 */
const SENDER_MARKERS = new RegExp(`[${MARKER_OPEN}${MARKER_CLOSE}]`, 'g')

export type PreparedBody = {
  /** What to hand the engine. */
  text: string
  placeholders: Placeholder[]
}

/**
 * Replace every `<@uuid>` and `<@everyone>` with a marker the engine will carry
 * through untouched.
 *
 * A mention token handed to a translator comes back mangled -- lowercased,
 * space-separated, or partially "translated" -- and a mangled token no longer
 * matches `MENTION_TOKEN`, so the mention silently stops being a mention. The
 * name is not translatable content in the first place: it is an identifier that
 * happens to live inside a sentence.
 */
export function prepareForTranslation(body: string): PreparedBody {
  const placeholders: Placeholder[] = []
  const pattern = new RegExp(MENTION_TOKEN.source, 'g')
  const text = normalizeText(body)
    .replace(SENDER_MARKERS, '')
    .replace(pattern, (token) => {
      const marker = `${MARKER_OPEN}${markerIndex(placeholders.length)}${MARKER_CLOSE}`
      placeholders.push({ marker, token })
      return marker
    })
  return { text, placeholders }
}

/**
 * Put the mentions back.
 *
 * A marker the engine dropped or mangled is restored by appending its token, so
 * the mention survives even when the model misbehaves -- losing the word order
 * is recoverable, losing the mention is not.
 */
export function restoreAfterTranslation(translated: string, placeholders: Placeholder[]): string {
  let result = normalizeText(translated)
  placeholders.forEach(({ marker, token }, index) => {
    if (result.includes(marker)) {
      result = result.split(marker).join(token)
      return
    }
    const loose = looseMarkerPattern(index)
    if (loose.test(result)) {
      result = result.replace(loose, token)
      return
    }
    result = `${result} ${token}`.trim()
  })
  return result
}

/**
 * Whether asking an engine about this text could tell us anything.
 *
 * Short, symbol-only and mention-only messages are where detection is least
 * reliable and translation least useful -- "ok", "+1", an emoji, a bare
 * `@someone`. Sending them costs a request to be told what we already know, and
 * risks a confident wrong answer on text with no linguistic content at all.
 */
export function isTranslatable(body: string): boolean {
  const withoutMentions = normalizeText(body)
    .replace(new RegExp(MENTION_TOKEN.source, 'g'), ' ')
    .replace(new RegExp(EVERYONE_TOKEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ' ')
  // At least two letters in any script. `\p{L}` covers Latin, Han, Hangul and
  // the rest, so this is not an English-shaped test.
  const letters = withoutMentions.match(/\p{L}/gu)
  return (letters?.length ?? 0) >= 2
}

/** Exported for tests that need to assert on the exact marker shape. */
export const TRANSLATION_MARKERS = { open: MARKER_OPEN, close: MARKER_CLOSE }

/** Re-exported so callers building a token do not reach past this module. */
export { userToken }
