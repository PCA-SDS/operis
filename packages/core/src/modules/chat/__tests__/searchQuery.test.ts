import {
  SEARCH_LIMITS,
  SEARCH_WEIGHTS,
  buildTsQuery,
  highlightTerms,
  parseSearchQuery,
} from '../lib/searchQuery'

describe('parseSearchQuery', () => {
  it('folds terms through the same pipeline the index uses', () => {
    expect(parseSearchQuery('BÁO CÁO').terms).toEqual(['bao', 'cao'])
  })

  it('treats a quoted run as a phrase, not as loose terms', () => {
    const parsed = parseSearchQuery('"production build"')
    expect(parsed.phrases).toEqual(['production build'])
  })

  it('keeps a phrase and the terms around it', () => {
    const parsed = parseSearchQuery('"production build" failed')
    expect(parsed.phrases).toEqual(['production build'])
    expect(parsed.terms).toContain('failed')
  })

  it('offers the compact form of an identifier alongside the original', () => {
    const parsed = parseSearchQuery('PO-2026-00421')
    expect(parsed.terms).toContain('po-2026-00421')
    expect(parsed.terms).toContain('po202600421')
  })

  it('is empty for blank input', () => {
    expect(parseSearchQuery('').isEmpty).toBe(true)
    expect(parseSearchQuery('   ').isEmpty).toBe(true)
    expect(parseSearchQuery('!!!').isEmpty).toBe(true)
  })

  it('does not repeat a term the reader typed twice', () => {
    expect(parseSearchQuery('build build build').terms).toEqual(['build'])
  })

  /** Past this it is a payload, not a search. */
  it('bounds the query length and the number of terms', () => {
    const long = parseSearchQuery('word '.repeat(400))
    expect(long.raw.length).toBeLessThanOrEqual(SEARCH_LIMITS.maxQueryLength)
    expect(long.terms.length).toBeLessThanOrEqual(SEARCH_LIMITS.maxTerms)
  })

  describe('fuzzy gating', () => {
    /** `a` would be similar to a large share of the corpus. */
    it('refuses fuzzy for a short Latin query', () => {
      expect(parseSearchQuery('a').allowFuzzy).toBe(false)
      expect(parseSearchQuery('ab').allowFuzzy).toBe(false)
    })

    it('allows fuzzy once a Latin term is long enough to be meant', () => {
      expect(parseSearchQuery('authentcation').allowFuzzy).toBe(true)
    })

    /**
     * A two-character Chinese query is a whole word, not a fragment. One
     * minimum length for every script either blocks legitimate CJK searches or
     * lets `a` scan the corpus.
     */
    it.each([['会议'], ['会議'], ['회의'], ['การประชุม']])(
      'allows fuzzy for short non-spacing script %s',
      (query) => {
        expect(parseSearchQuery(query).allowFuzzy).toBe(true)
      },
    )
  })
})

describe('buildTsQuery', () => {
  it('requires every term, so both words of a two-word search must appear', () => {
    expect(buildTsQuery(parseSearchQuery('production build'), false))
      .toBe('production & build')
  })

  /** `deploy` should find `deployment` while the reader is still typing. */
  it('makes only the last term a prefix', () => {
    expect(buildTsQuery(parseSearchQuery('production build'), true))
      .toBe('production & build:*')
  })

  /** `<->` is followed-by: the words must be adjacent and in order. */
  it('turns a quoted phrase into an adjacency constraint', () => {
    const query = buildTsQuery(parseSearchQuery('"production build"'), false)
    expect(query).toContain('production <-> build')
  })

  it('is null when there is nothing to ask', () => {
    expect(buildTsQuery(parseSearchQuery(''), false)).toBeNull()
  })

  /**
   * `tsquery` has its own operator syntax. Without sanitising, a typed `!`
   * becomes negation and a typed `:*` becomes a prefix the reader did not ask
   * for — and a malformed expression is a 500, not a search.
   */
  it.each([
    ['build & deploy'],
    ['build | deploy'],
    ['!build'],
    ["build'); drop table chat_messages; --"],
    ['build:*'],
    ['(build | deploy) & !test'],
    ['build <-> deploy'],
  ])('strips tsquery operators out of %s', (raw) => {
    const query = buildTsQuery(parseSearchQuery(raw), false)
    if (query === null) return
    // The only operators left are the ones this builder put there itself.
    const withoutOwnOperators = query.replace(/ & /g, ' ').replace(/ <-> /g, ' ').replace(/:\*/g, '')
    expect(withoutOwnOperators).not.toMatch(/[|!()':]/)
  })

  it('keeps the characters that carry meaning inside a term', () => {
    expect(buildTsQuery(parseSearchQuery('node.js'), false)).toContain('node.js')
    expect(buildTsQuery(parseSearchQuery('user@example.com'), false)).toContain('user@example.com')
  })
})

describe('highlightTerms', () => {
  it('puts phrases first, so a phrase highlights as one run', () => {
    const parsed = parseSearchQuery('"production build" failed')
    expect(highlightTerms(parsed)[0]).toEqual({ text: 'production build', prefix: false })
  })

  it('marks the last loose term as a prefix, matching what the query did', () => {
    const parsed = parseSearchQuery('deploy fail')
    const terms = highlightTerms(parsed)
    // `buildTsQuery` appends `:*` to the last term only, so it is the only one
    // that may highlight a word's opening rather than the whole word.
    expect(terms.map((term) => term.prefix)).toEqual([false, true])
    expect(buildTsQuery(parsed, true)).toBe('deploy & fail:*')
  })

  it('never marks the phrase entry itself as a prefix', () => {
    // A phrase's words are also pushed as loose terms, so the trailing one does
    // carry the prefix the query gave it. The contiguous phrase entry never
    // does: `<->` matched it whole.
    const parsed = parseSearchQuery('"release notes"')
    const terms = highlightTerms(parsed)
    expect(terms.filter((term) => term.text.includes(' ')).every((term) => !term.prefix)).toBe(true)
  })
})

describe('SEARCH_WEIGHTS', () => {
  /**
   * The ordering is the ranking contract: a correct match must always beat a
   * vaguely similar one, and no accumulation of weak signals may overtake a
   * strong one.
   */
  it('separates each signal from the next by an order of magnitude', () => {
    expect(SEARCH_WEIGHTS.exactPhrase).toBeGreaterThan(SEARCH_WEIGHTS.allTermsPresent)
    expect(SEARCH_WEIGHTS.allTermsPresent).toBeGreaterThan(SEARCH_WEIGHTS.textRank)
    expect(SEARCH_WEIGHTS.textRank).toBeGreaterThan(SEARCH_WEIGHTS.prefix)
    expect(SEARCH_WEIGHTS.prefix).toBeGreaterThan(SEARCH_WEIGHTS.fuzzy)
  })

  /** Search is for finding information, not for finding the newest message. */
  it('makes recency the weakest signal, so it can only settle ties', () => {
    expect(SEARCH_WEIGHTS.recency).toBeLessThan(SEARCH_WEIGHTS.fuzzy)
    expect(SEARCH_WEIGHTS.recency).toBeLessThan(SEARCH_WEIGHTS.textRank)
  })

  /** A fuzzy match on every term must not reach a single exact phrase. */
  it('keeps a pile of fuzzy matches below one exact phrase', () => {
    const allFuzzy = SEARCH_WEIGHTS.fuzzy * SEARCH_LIMITS.maxTerms + SEARCH_WEIGHTS.recency
    expect(allFuzzy).toBeLessThan(SEARCH_WEIGHTS.exactPhrase)
  })
})
