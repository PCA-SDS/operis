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

/**
 * A run of the message, split at the things that must not be translated.
 *
 * `mention` segments never reach the engine. That is the whole point: an
 * in-band marker was tried first and measured against the real model, and it
 * does not work. M2M100 carries ``/`` in its vocabulary, so they
 * tokenise cleanly and the approach looks sound -- but the decoder never emits
 * them. Across every pairing measured (fr->en, fr->vi, one/two/three/repeated
 * mentions) the markers survived generation zero times, and two or more of them
 * pushed the decoder into a degenerate loop that returned a wall of `⭐` in
 * place of the message. Restoring by appending the token then produced garbage
 * text with the mentions dumped after it, labelled as a translation.
 *
 * Splitting instead means the identifier is never at risk: it cannot be
 * dropped, reordered, mangled, or invented, because the model never sees it.
 */
export type BodySegment =
  | { kind: 'text'; value: string }
  | { kind: 'mention'; value: string }
  /**
   * A run of line breaks, kept out of the engine for the same reason.
   *
   * Measured: `"Bonjour.\nLa réunion est jeudi.\nMerci."` came back as
   * `"The meeting is Thursday, thank you."` — three lines collapsed into one
   * and the greeting dropped entirely. The model treats a newline as
   * whitespace, so a list, an address or a paste of several lines loses its
   * shape and some of its content, silently, and is cached that way.
   */
  | { kind: 'break'; value: string }

/**
 * How many separate runs of prose one message may be split into.
 *
 * Each run is its own engine call, so a message that alternates protected
 * content and prose many times would cost many inferences and read as many
 * disconnected fragments. Past this it is better to decline than to bill the
 * engine for a result nobody would want.
 *
 * Eight rather than four because lines count too: an ordinary short multi-line
 * message is several runs before a single mention is involved, and declining
 * those would be worse than the collapse this replaces.
 */
export const MAX_TRANSLATABLE_SEGMENTS = 8

/**
 * Split a body at everything the engine must not see, preserving order and
 * every character.
 */
export function segmentBody(body: string): BodySegment[] {
  const protectedRun = new RegExp(`${MENTION_TOKEN.source}|\\n+`, 'g')
  const segments: BodySegment[] = []
  const text = normalizeText(body)
  let cursor = 0
  for (const match of text.matchAll(protectedRun)) {
    const start = match.index ?? 0
    if (start > cursor) segments.push({ kind: 'text', value: text.slice(cursor, start) })
    segments.push({
      kind: match[0].startsWith('<@') ? 'mention' : 'break',
      value: match[0],
    })
    cursor = start + match[0].length
  }
  if (cursor < text.length) segments.push({ kind: 'text', value: text.slice(cursor) })
  return segments
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

/** The indices of the segments worth sending, in order. */
export function translatableSegmentIndexes(segments: BodySegment[]): number[] {
  const indexes: number[] = []
  segments.forEach((segment, index) => {
    if (segment.kind === 'text' && isTranslatable(segment.value)) indexes.push(index)
  })
  return indexes
}

/**
 * Everything in the message worth detecting on, joined.
 *
 * All of the prose, not the longest run of it. Detection quality tracks how
 * much text it is given, and measured against the real detector a single run of
 * ordinary French scored 0.40 — below the confidence gate — while the same
 * message read whole was unambiguous. The mentions are left out because an
 * identifier is not evidence of a language.
 */
export function detectionSegment(segments: BodySegment[]): string | null {
  const candidates = translatableSegmentIndexes(segments).map((index) =>
    segments[index]!.value.trim(),
  )
  if (candidates.length === 0) return null
  return candidates.join(' ')
}

/**
 * A translated body must not contain a mention the original did not.
 *
 * A mention is a live relationship in the renderer, so an engine that happened
 * to emit `<@everyone>` would turn a translation into an organization-wide
 * ping that nobody wrote. The model never sees the token, which makes this
 * unlikely rather than impossible -- and "unlikely" is not a property to leave
 * unchecked on a path that renders to every reader.
 */
export function introducesMention(translated: string): boolean {
  return new RegExp(MENTION_TOKEN.source, 'g').test(translated)
}

/**
 * Put the message back together.
 *
 * `translations` is keyed by segment index; a segment with no entry is emitted
 * unchanged. The surrounding whitespace of a translated run is preserved from
 * the original rather than taken from the engine, so `@alice can you...` does
 * not come back as `@aliceCan you...`.
 */
export function reassembleBody(
  segments: BodySegment[],
  translations: ReadonlyMap<number, string>,
): string {
  const out = segments.map((segment, index) => {
    const translated = translations.get(index)
    if (segment.kind !== 'text' || translated === undefined) return segment.value
    const leading = segment.value.match(/^\s*/)?.[0] ?? ''
    const trailing = segment.value.match(/\s*$/)?.[0] ?? ''
    return `${leading}${translated.trim()}${trailing}`
  })
  return normalizeText(out.join(''))
}

/** Re-exported so callers building a token do not reach past this module. */
export { userToken }
