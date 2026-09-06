import { MENTION_TOKEN } from './mentions'

/**
 * The one place chat text is normalised for search.
 *
 * Indexing, querying and highlighting must agree exactly. If they diverge by a
 * single rule, a message is indexed under one form and searched under another
 * and simply cannot be found -- with no error and nothing to see. So this is
 * the only implementation: the column is written from it, the query is built
 * from it, and the highlighter maps through it.
 *
 * It runs in TypeScript rather than in Postgres deliberately. `unaccent` is a
 * database extension this deployment does not install by default, it is STABLE
 * rather than IMMUTABLE (so it cannot appear in a generated column without a
 * wrapper), and putting the rules in SQL would mean a second implementation for
 * the client-side highlighter to drift from.
 */

/**
 * Characters Unicode will not decompose, and their search equivalents.
 *
 * NFKD does almost all of the work: `ế` becomes `e` plus a combining mark, and
 * dropping the mark leaves `e`. But a stroke is not a combining mark -- `đ` is
 * a single indivisible code point with no canonical decomposition, so NFKD
 * leaves it untouched and `được` would fold to `đuoc`, which no one types.
 * Measured, not assumed: `'đ'.normalize('NFKD').length === 1`.
 *
 * This is the supplement Unicode cannot provide, not a hand-maintained accent
 * table -- every character here is one that decomposition genuinely does not
 * cover, and each is asserted in the tests.
 */
const INDIVISIBLE: ReadonlyMap<string, string> = new Map([
  ['đ', 'd'], ['Đ', 'd'],
  ['ø', 'o'], ['Ø', 'o'],
  ['ł', 'l'], ['Ł', 'l'],
  ['ß', 'ss'], ['ẞ', 'ss'],
  ['æ', 'ae'], ['Æ', 'ae'],
  ['œ', 'oe'], ['Œ', 'oe'],
  ['ð', 'd'], ['Ð', 'd'],
  ['þ', 'th'], ['Þ', 'th'],
  ['ı', 'i'], ['İ', 'i'],
])

/** One code point, folded. Empty when the character carries no search signal. */
function foldCodePoint(char: string): string {
  const supplement = INDIVISIBLE.get(char)
  if (supplement !== undefined) return supplement
  // NFKD rather than NFD so compatibility forms fold too: full-width `Ｏ`
  // becomes `O`, and the `ﬁ` ligature becomes `fi`. Combining marks are then
  // dropped, which is what makes the result diacritic-insensitive.
  //
  // The recomposition afterwards is not cosmetic. NFKD also decomposes Hangul
  // syllables into their constituent jamo -- `회` becomes three code points
  // that are letters, not marks, so stripping does not put them back. Without
  // the NFC step, Korean would be indexed as jamo sequences: self-consistent,
  // but unrecognisable in any debug output and needlessly fragile. Marks are
  // already gone by this point, so recomposing cannot reintroduce an accent.
  const decomposed = char.normalize('NFKD').replace(/\p{M}/gu, '').normalize('NFC')
  // `toLowerCase` is Unicode-aware in JavaScript, unlike an ASCII-range fold.
  return decomposed.toLowerCase()
}

export type FoldedText = {
  /** The searchable form. */
  text: string
  /**
   * `origin[i]` is the index in the ORIGINAL string that produced `text[i]`.
   *
   * Highlighting needs this and cannot be done without it. Folding is not
   * length-preserving in either direction -- `ế` collapses two code points to
   * one, `ß` expands one to two -- so an offset computed against the folded
   * text and applied to the original lands in the wrong place, which §37 of the
   * brief calls out as worse than no highlighting at all.
   */
  origin: number[]
}

/**
 * Fold text for search, keeping a map back to the original.
 *
 * Per code point rather than over the whole string: NFKD is defined
 * character-wise, so folding one at a time gives the same answer and yields the
 * index map for free. Iteration is over code points (`for...of`), so astral
 * characters and emoji are never split mid-surrogate.
 */
export function foldWithMap(input: string): FoldedText {
  let text = ''
  const origin: number[] = []
  let index = 0
  for (const char of input) {
    const folded = foldCodePoint(char)
    for (let offset = 0; offset < folded.length; offset += 1) origin.push(index)
    text += folded
    index += char.length
  }
  return { text, origin }
}

/** The folded form alone, for callers that do not need to map back. */
export function foldForSearch(input: string): string {
  return foldWithMap(input).text
}

/**
 * What actually gets indexed for a message body.
 *
 * Mention tokens are removed rather than folded. A body stores `<@` plus a
 * UUID where a name was typed, so indexing it raw would put raw user ids in the
 * search corpus and let a stray hex fragment match. Resolving the id to a name
 * at index time is worse: the name would freeze at the moment of indexing,
 * which is the exact failure the token format exists to prevent. "Find messages
 * mentioning Alice" is answered from `chat_message_mentions`, which is indexed
 * for that question.
 *
 * The token is replaced by a space so the words either side stay separate.
 */
export function searchableBody(body: string): string {
  return foldForSearch(body.replace(new RegExp(MENTION_TOKEN.source, 'g'), ' '))
}

/**
 * Terms worth sending to the database.
 *
 * Split on anything that is not a letter, digit or one of the few characters
 * that carry meaning inside a term. `.`, `+`, `#`, `@`, `_` and `-` are kept so
 * `node.js`, `c++`, `c#`, `user@example.com`, `v2.1` and `PO-4432` survive as
 * single terms instead of being shattered into fragments that match everything.
 */
export function tokenize(folded: string): string[] {
  return folded.split(/[^\p{L}\p{N}.+#@_-]+/u).filter((token) => token.length > 0)
}

/**
 * A term with its separators removed, when that is a different string.
 *
 * `PO-4432` and `PO4432` are the same identifier to the person searching, so
 * the compact form is indexed alongside the original as a second signal. It is
 * additive on purpose: the separated form still matches exactly, so this can
 * only add recall, never change what an exact search finds.
 */
export function compactTerm(token: string): string | null {
  const compact = token.replace(/[.+#@_-]/g, '')
  // Below three characters this is noise, not an identifier: joining `a-b` into
  // `ab` adds a term nobody searches and that collides with real words.
  if (compact.length < 3 || compact === token) return null
  return compact
}

/**
 * The text a message is indexed under: its folded body, plus compact forms of
 * any term that carries separators.
 */
export function buildSearchDocument(body: string): string {
  const folded = searchableBody(body)
  const extras: string[] = []
  for (const token of tokenize(folded)) {
    const compact = compactTerm(token)
    if (compact) extras.push(compact)
  }
  return extras.length > 0 ? `${folded} ${extras.join(' ')}` : folded
}

/** A run of the original text that matched, in original-string coordinates. */
export type MatchRange = { start: number; end: number }

/**
 * A word's trigram set, padded the way `pg_trgm` pads.
 *
 * Two leading spaces and one trailing, so `cat` yields `"  c"`, `" ca"`,
 * `"cat"`, `"at "`. Matching that padding matters: it is what makes a word's
 * opening and ending count, and it is the difference between agreeing with the
 * database about what is similar and merely being in the same neighbourhood.
 */
function trigramsOf(word: string): Set<string> {
  const padded = `  ${word} `
  const grams = new Set<string>()
  for (let index = 0; index + 3 <= padded.length; index += 1) {
    grams.add(padded.slice(index, index + 3))
  }
  return grams
}

/** Jaccard overlap of two trigram sets, as `pg_trgm` scores similarity. */
function trigramSimilarity(left: Set<string>, right: Set<string>): number {
  let shared = 0
  for (const gram of left) if (right.has(gram)) shared += 1
  const union = left.size + right.size - shared
  return union === 0 ? 0 : shared / union
}

/**
 * A term to light up, and whether it matched as a prefix.
 *
 * The flag exists so highlighting can reproduce the query's own matching rule
 * rather than approximate it; the two drifting apart is what produces a result
 * with no visible reason for being there.
 */
export type HighlightTerm = { text: string; prefix?: boolean }

/**
 * Where the query matched, expressed against the ORIGINAL text.
 *
 * The caller renders the original and never sees a folded string, which is what
 * keeps `báo cáo` on screen when the query was `bao cao`. Ranges are merged and
 * ordered so a renderer can walk them once.
 */
export function findMatchRanges(
  original: string,
  queryTerms: readonly (string | HighlightTerm)[],
  options?: {
    /**
     * Similarity at or above which a near-miss word is marked, when a term
     * matched nothing exactly.
     *
     * Supplied only when the query itself was allowed a fuzzy pass, so the
     * marks explain the same match the database made. Left out, a term that
     * matched nothing exactly simply marks nothing — which is what a result
     * with no visible reason looks like, and why it is worth passing.
     */
    fuzzyThreshold?: number
  },
): MatchRange[] {
  const terms = queryTerms
    .map((term) => (typeof term === 'string' ? { text: term, prefix: false } : term))
    .map((term) => ({ text: foldForSearch(term.text), prefix: term.prefix === true }))
    .filter((term) => term.text.length > 0)
  if (terms.length === 0) return []

  const { text, origin } = foldWithMap(original)
  const ranges: MatchRange[] = []

  for (const term of terms) {
    let from = 0
    for (;;) {
      const at = text.indexOf(term.text, from)
      if (at === -1) break
      // Whole terms only. Without this, `an` would light up the middle of
      // `Nguyễn` and every result would look like noise.
      const before = at === 0 ? '' : text[at - 1]!
      const after = at + term.text.length >= text.length ? '' : text[at + term.text.length]!
      const isBoundary = (char: string) => char === '' || !/[\p{L}\p{N}]/u.test(char)
      // A prefix term matched the START of a word, which is exactly what `:*`
      // did in the query, so only the left boundary is required. Demanding both
      // would return a hit with nothing lit up -- and a result the reader
      // cannot see the reason for reads as a wrong result, not a partial one.
      if (isBoundary(before) && (term.prefix || isBoundary(after))) {
        const start = origin[at]!
        // The end is the original index one past the last folded character, so
        // a fold that collapsed several code points still covers all of them.
        const lastFolded = at + term.text.length - 1
        const lastOriginal = origin[lastFolded]!
        let end = lastOriginal
        // Advance to the end of the original code point, and over any
        // combining marks that folded away to nothing.
        for (const char of original.slice(lastOriginal)) {
          end += char.length
          if (end >= original.length) break
          const nextOrigin = origin.indexOf(end)
          if (nextOrigin !== -1) break
        }
        ranges.push({ start, end })
      }
      from = at + 1
    }
  }

  const threshold = options?.fuzzyThreshold
  if (threshold !== undefined && ranges.length === 0) {
    // Nothing matched exactly, yet the message was returned — so it was a near
    // miss, and the reader is owed the word that caused it. Whole words only,
    // scored the way the database scored them, so the mark lands where the
    // match came from rather than on the closest-looking fragment.
    let best: { range: MatchRange; score: number } | null = null
    for (const term of terms) {
      const wanted = trigramsOf(term.text)
      for (const word of text.matchAll(/[\p{L}\p{N}]+/gu)) {
        const score = trigramSimilarity(wanted, trigramsOf(word[0]))
        if (score < threshold || (best && score <= best.score)) continue
        const at = word.index
        const start = origin[at]!
        const lastOriginal = origin[at + word[0].length - 1]!
        let end = lastOriginal
        for (const char of original.slice(lastOriginal)) {
          end += char.length
          if (end >= original.length) break
          if (origin.indexOf(end) !== -1) break
        }
        best = { range: { start, end }, score }
      }
    }
    if (best) ranges.push(best.range)
  }

  return mergeRanges(ranges)
}

/** Overlapping or touching ranges become one, so nothing is highlighted twice. */
function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  if (ranges.length === 0) return []
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: MatchRange[] = [sorted[0]!]
  for (const range of sorted.slice(1)) {
    const last = merged[merged.length - 1]!
    if (range.start <= last.end) last.end = Math.max(last.end, range.end)
    else merged.push(range)
  }
  return merged
}

/**
 * A short window of the original text around the first match.
 *
 * Cut on code point boundaries via `Array.from`, never by slicing UTF-16 units:
 * a naive `slice` can split a surrogate pair and produce a replacement
 * character, which for an emoji or a CJK ideograph means visible corruption in
 * a search result.
 */
export function buildSnippet(
  original: string,
  ranges: MatchRange[],
  radius = 60,
): { text: string; ranges: MatchRange[]; truncatedStart: boolean; truncatedEnd: boolean } {
  const chars = Array.from(original)
  if (chars.length <= radius * 2 || ranges.length === 0) {
    return { text: original, ranges, truncatedStart: false, truncatedEnd: false }
  }

  // Work in code point space, then convert back, so the window never lands
  // inside a surrogate pair or between a base character and its combining mark.
  const codePointIndexOf = new Map<number, number>()
  let unitIndex = 0
  chars.forEach((char, position) => {
    codePointIndexOf.set(unitIndex, position)
    unitIndex += char.length
  })

  const firstMatchAt = codePointIndexOf.get(ranges[0]!.start) ?? 0
  const from = Math.max(0, firstMatchAt - radius)
  const to = Math.min(chars.length, firstMatchAt + radius)

  const prefixUnits = chars.slice(0, from).join('').length
  const text = chars.slice(from, to).join('')

  const shifted = ranges
    .map((range) => ({ start: range.start - prefixUnits, end: range.end - prefixUnits }))
    .filter((range) => range.start >= 0 && range.end <= text.length)

  return {
    text,
    ranges: shifted,
    truncatedStart: from > 0,
    truncatedEnd: to < chars.length,
  }
}
