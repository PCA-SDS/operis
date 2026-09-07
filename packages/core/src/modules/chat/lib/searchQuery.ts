import { compactTerm, foldForSearch, tokenize, type HighlightTerm } from './searchText'

/**
 * Turning what someone typed into something safe to ask the database.
 *
 * One parser for both search scopes. The difference between searching a
 * conversation and searching every conversation is a predicate, not a
 * different notion of what a query means -- so ranking, term handling and
 * limits live here once rather than drifting into two dialects.
 */

/** Ceilings, in one place rather than scattered through call sites. */
export const SEARCH_LIMITS = {
  /** Longer than any real query; past this it is a payload, not a search. */
  maxQueryLength: 256,
  /** Beyond this the extra terms cost planning time and add nothing. */
  maxTerms: 12,
  /**
   * Below this, a Latin term is too short to fuzzy-match usefully -- `a` would
   * be similar to a large share of the corpus. Scripts without spaces are
   * exempt; see `isShortScript`.
   */
  minFuzzyLength: 4,
  /** Result page sizes. */
  defaultPageSize: 20,
  maxPageSize: 50,
  /**
   * Similarity below this is noise rather than a typo.
   *
   * Measured against this corpus with 51 generated single-character typos and
   * 61 random strings, scored with `strict_word_similarity`: garbage topped out
   * at 0.333, typos ran from 0.200 with a median of 0.455. Sweeping the
   * threshold, 0.35 is the knee — the lowest value that admits no false
   * positive at all, while still catching 42 of the 51 typos. Below it recall
   * barely improves and nonsense starts matching; above it recall falls away
   * for nothing.
   *
   * A search that answers a word nobody wrote is worse than one that misses a
   * badly mangled typo, because the reader can retype but cannot tell a wrong
   * result from a right one.
   */
  fuzzyThreshold: 0.35,
} as const

export type ParsedQuery = {
  /** What the reader typed, trimmed. Never sent to SQL; kept for echoing back. */
  raw: string
  /** Quoted runs, folded. These must appear contiguously to count as a phrase. */
  phrases: string[]
  /** Individual terms, folded, including compact forms of identifiers. */
  terms: string[]
  /**
   * Whether this query is worth a fuzzy pass. Short queries are not: the
   * candidate set is enormous and the results are noise.
   */
  allowFuzzy: boolean
  /** True when there is nothing worth asking the database. */
  isEmpty: boolean
}

/**
 * Scripts that do not separate words with spaces.
 *
 * A two-character Chinese query is a whole word and must be searched; a
 * two-character Latin query is a fragment. Applying one minimum length to both
 * either blocks legitimate CJK searches or lets `a` scan the corpus, so the
 * rule is script-aware rather than a single number.
 */
function isShortScript(text: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u.test(text)
}

/**
 * Parse a raw query.
 *
 * Quoted runs become phrases; everything else becomes terms. Nothing here
 * builds SQL -- the output is data, and the caller parameterises it. That is
 * what keeps a query containing `'` or `&` or `:*` from meaning anything to the
 * database.
 */
export function parseSearchQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim().slice(0, SEARCH_LIMITS.maxQueryLength)
  if (trimmed.length === 0) {
    return { raw: '', phrases: [], terms: [], allowFuzzy: false, isEmpty: true }
  }

  const phrases: string[] = []
  // Quoted runs are lifted out first so their internal spaces do not become
  // term boundaries.
  const withoutPhrases = trimmed.replace(/"([^"]+)"/g, (_match, inner: string) => {
    const folded = foldForSearch(inner).trim()
    if (folded.length > 0) phrases.push(folded)
    return ' '
  })

  const seen = new Set<string>()
  const terms: string[] = []
  const push = (term: string) => {
    if (term.length === 0 || seen.has(term) || terms.length >= SEARCH_LIMITS.maxTerms) return
    seen.add(term)
    terms.push(term)
  }

  for (const token of tokenize(foldForSearch(withoutPhrases))) {
    push(token)
    // `PO-4432` and `PO4432` are the same identifier to the person searching.
    const compact = compactTerm(token)
    if (compact) push(compact)
  }

  // A phrase with no loose terms still needs its words available for
  // highlighting and for the all-terms-present signal.
  for (const phrase of phrases) for (const token of tokenize(phrase)) push(token)

  const longest = terms.reduce((max, term) => Math.max(max, term.length), 0)
  const allowFuzzy =
    terms.length > 0 && (longest >= SEARCH_LIMITS.minFuzzyLength || isShortScript(trimmed))

  return {
    raw: trimmed,
    phrases,
    terms,
    allowFuzzy,
    isEmpty: phrases.length === 0 && terms.length === 0,
  }
}

/**
 * The terms a highlighter should look for.
 *
 * Phrases first, so a phrase match is highlighted as one run rather than as
 * separate words that happen to be adjacent.
 */
/**
 * Everything a highlighter needs to reproduce this query's matching.
 *
 * One object rather than a term list plus a loose threshold beside it: the two
 * have to describe the same query, and separate arguments are how they end up
 * describing different ones.
 */
export type HighlightPlan = {
  terms: HighlightTerm[]
  /** Set only when the query itself was allowed a fuzzy pass. */
  fuzzyThreshold?: number
}

export function highlightPlan(parsed: ParsedQuery): HighlightPlan {
  return {
    terms: highlightTerms(parsed),
    fuzzyThreshold: parsed.allowFuzzy ? SEARCH_LIMITS.fuzzyThreshold : undefined,
  }
}

export function highlightTerms(parsed: ParsedQuery): HighlightTerm[] {
  return [
    ...parsed.phrases.map((text) => ({ text, prefix: false })),
    // Mirrors `buildTsQuery`, which appends `:*` to the last loose term: that
    // term matched a word's opening, so it has to highlight as one.
    ...parsed.terms.map((text, index) => ({
      text,
      prefix: index === parsed.terms.length - 1,
    })),
  ]
}

/**
 * The `tsquery` string, built from parsed terms.
 *
 * Terms are AND-ed: someone searching `production build` wants messages with
 * both, not either. The last term carries `:*` so search-as-you-type matches a
 * word still being typed -- `deploy` finds `deployment` -- while earlier terms
 * stay exact, because a prefix on every term makes short queries match
 * everything.
 *
 * Every term is sanitised to letters, digits and the few characters that carry
 * meaning inside one. `tsquery` has its own operator syntax (`&`, `|`, `!`,
 * `<->`, `:*`) and this is what stops a typed `!` from becoming negation.
 */
export function buildTsQuery(parsed: ParsedQuery, prefixLastTerm: boolean): string | null {
  const safe = (term: string) => term.replace(/[^\p{L}\p{N}.+#@_-]/gu, '')

  const clauses: string[] = []

  for (const phrase of parsed.phrases) {
    const words = tokenize(phrase).map(safe).filter((word) => word.length > 0)
    // `<->` is the followed-by operator: the words must be adjacent, in order,
    // which is what makes a quoted phrase mean a phrase.
    if (words.length > 0) clauses.push(words.join(' <-> '))
  }

  const looseTerms = parsed.terms.map(safe).filter((term) => term.length > 0)
  looseTerms.forEach((term, index) => {
    const isLast = index === looseTerms.length - 1
    clauses.push(prefixLastTerm && isLast ? `${term}:*` : term)
  })

  if (clauses.length === 0) return null
  return clauses.join(' & ')
}

/**
 * How a result is scored.
 *
 * Ordered so that a correct match always beats a vaguely similar one. Weights
 * are separated by an order of magnitude at each step, so no accumulation of
 * weak signals can overtake a strong one -- a fuzzy match cannot climb above an
 * exact token however many terms it half-matches.
 *
 * Recency is deliberately the smallest term. Search is for finding
 * information, not for finding the newest message: a strong match from last
 * year must outrank a weak one from this morning, and recency only settles ties
 * between comparable matches.
 */
export const SEARCH_WEIGHTS = {
  exactPhrase: 1000,
  allTermsPresent: 400,
  /** `ts_rank_cd` already accounts for term frequency and proximity. */
  textRank: 200,
  prefix: 50,
  fuzzy: 40,
  /** Scaled by age, so it can only ever reorder near-equal matches. */
  recency: 10,
} as const
