import {
  buildSearchDocument,
  buildSnippet,
  compactTerm,
  findMatchRanges,
  foldForSearch,
  foldWithMap,
  searchableBody,
  tokenize,
} from '../lib/searchText'
import { userToken, EVERYONE_TOKEN } from '../lib/mentions'

const ALICE = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

describe('foldForSearch', () => {
  /**
   * The pairings the feature exists for. Someone reading Vietnamese on a
   * keyboard without diacritics must find what a colleague typed with them.
   */
  it.each([
    ['Tôi sẽ gửi báo cáo', 'toi se gui bao cao'],
    ['người dùng', 'nguoi dung'],
    ['được', 'duoc'],
    ['Đặng', 'dang'],
    ['đường', 'duong'],
    ['Hồ Chí Minh', 'ho chi minh'],
  ])('folds Vietnamese %s', (input, expected) => {
    expect(foldForSearch(input)).toBe(expected)
  })

  it.each([
    ['José', 'jose'],
    ['café', 'cafe'],
    ['München', 'munchen'],
    ['François', 'francois'],
    ['Ærø', 'aero'],
    ['Straße', 'strasse'],
  ])('folds European diacritics %s', (input, expected) => {
    expect(foldForSearch(input)).toBe(expected)
  })

  /**
   * `đ` has no canonical decomposition — it is one indivisible code point, not
   * a `d` with a mark — so Unicode alone leaves it and `được` would fold to
   * `đuoc`. This asserts the supplement is actually needed and actually works.
   */
  it('handles characters Unicode will not decompose', () => {
    expect('đ'.normalize('NFKD')).toHaveLength(1)
    expect(foldForSearch('đ')).toBe('d')
    expect(foldForSearch('Đ')).toBe('d')
  })

  /** The same visible text typed two ways must reach the same index entry. */
  it('folds composed and decomposed forms identically', () => {
    const composed = 'Tôi được'
    const decomposed = composed.normalize('NFD')
    expect(composed).not.toBe(decomposed)
    expect(foldForSearch(decomposed)).toBe(foldForSearch(composed))
  })

  it('folds compatibility forms, so full-width text is searchable', () => {
    expect(foldForSearch('ＯＰＥＲＩＳ')).toBe('operis')
    expect(foldForSearch('ﬁle')).toBe('file')
  })

  it('is case-insensitive', () => {
    expect(foldForSearch('OPERIS')).toBe(foldForSearch('Operis'))
    expect(foldForSearch('BÁO CÁO')).toBe(foldForSearch('báo cáo'))
  })

  /** CJK carries no diacritics and must pass through untouched. */
  it('leaves CJK alone', () => {
    expect(foldForSearch('会议已推迟')).toBe('会议已推迟')
    expect(foldForSearch('회의가')).toBe('회의가')
  })

  it('does not split emoji or astral characters', () => {
    expect(foldForSearch('ok 👍🏽 done')).toContain('👍🏽')
    expect(foldForSearch('𝕆peris')).toContain('operis')
  })
})

describe('foldWithMap', () => {
  it('maps every folded character back to the character that produced it', () => {
    const { text, origin } = foldWithMap('Đặng')
    expect(text).toBe('dang')
    expect(origin).toHaveLength(text.length)
    for (const index of origin) expect(index).toBeLessThan('Đặng'.length)
  })

  it('keeps the map aligned when one character folds to several', () => {
    const { text, origin } = foldWithMap('Straße')
    expect(text).toBe('strasse')
    // Both characters of `ss` point at the single `ß`.
    expect(origin[4]).toBe(origin[5])
  })
})

describe('searchableBody', () => {
  /**
   * A body stores `<@uuid>` where a name was typed. Indexing it raw would put
   * user ids in the corpus and let a hex fragment match; resolving the id to a
   * name would freeze that name at index time.
   */
  it('keeps mention tokens out of the indexed text', () => {
    const indexed = searchableBody(`${userToken(ALICE)} peux-tu regarder la facture`)
    expect(indexed).not.toContain('<@')
    expect(indexed).not.toContain(ALICE)
    expect(indexed).toContain('facture')
  })

  it('does not glue the words either side of a mention together', () => {
    const indexed = searchableBody(`bonjour${userToken(ALICE)}merci`)
    expect(tokenize(indexed)).toEqual(['bonjour', 'merci'])
  })

  it('removes the everyone token too', () => {
    expect(searchableBody(`${EVERYONE_TOKEN} standup now`).trim()).toBe('standup now')
  })
})

describe('tokenize', () => {
  /**
   * Business identifiers are what ERP users actually search. Shattering
   * `PO-2026-00421` into `po`, `2026`, `00421` makes the exact search useless.
   */
  it.each([
    ['node.js', ['node.js']],
    ['c++', ['c++']],
    ['c#', ['c#']],
    ['v2.1', ['v2.1']],
    ['PO-2026-00421', ['po-2026-00421']],
    ['user@example.com', ['user@example.com']],
    ['INV-2026-0012', ['inv-2026-0012']],
  ])('keeps %s as one term', (input, expected) => {
    expect(tokenize(foldForSearch(input))).toEqual(expected)
  })

  it('splits on ordinary punctuation and whitespace', () => {
    expect(tokenize(foldForSearch('Hello, world! How are you?'))).toEqual([
      'hello', 'world', 'how', 'are', 'you',
    ])
  })

  it('keeps a URL findable by its domain', () => {
    expect(tokenize(foldForSearch('see https://github.com/PCA-SDS/operis')))
      .toContain('github.com')
  })
})

describe('compactTerm', () => {
  /** `PO-4432` and `PO4432` are the same identifier to the person searching. */
  it('offers a separator-free form as a second signal', () => {
    expect(compactTerm('po-2026-00421')).toBe('po202600421')
    expect(compactTerm('v2.1')).toBe('v21')
  })

  it('offers nothing when there is nothing to compact', () => {
    expect(compactTerm('deployment')).toBeNull()
    expect(compactTerm('a-b')).toBeNull()
  })
})

describe('buildSearchDocument', () => {
  it('indexes the folded body plus compact identifier forms', () => {
    const doc = buildSearchDocument('Please approve PO-2026-00421')
    expect(doc).toContain('po-2026-00421')
    expect(doc).toContain('po202600421')
  })

  it('adds nothing when no term carries separators', () => {
    expect(buildSearchDocument('bonjour tout le monde')).toBe('bonjour tout le monde')
  })
})

describe('findMatchRanges', () => {
  /**
   * The heart of §36: an accentless query must highlight the accented original.
   * Ranges are expressed against the ORIGINAL string, so the reader never sees
   * normalised text.
   */
  it('highlights accented text from an accentless query', () => {
    const original = 'Tôi sẽ gửi báo cáo tài chính'
    const ranges = findMatchRanges(original, ['bao', 'cao'])

    expect(ranges).toHaveLength(2)
    expect(original.slice(ranges[0]!.start, ranges[0]!.end)).toBe('báo')
    expect(original.slice(ranges[1]!.start, ranges[1]!.end)).toBe('cáo')
  })

  it('highlights the same text when the query carries the accents', () => {
    const original = 'Tôi sẽ gửi báo cáo'
    expect(findMatchRanges(original, ['báo'])).toEqual(findMatchRanges(original, ['bao']))
  })

  it('highlights across composed and decomposed originals identically', () => {
    const composed = 'báo cáo'
    const decomposed = composed.normalize('NFD')
    const fromComposed = findMatchRanges(composed, ['bao'])
    const fromDecomposed = findMatchRanges(decomposed, ['bao'])

    expect(composed.slice(fromComposed[0]!.start, fromComposed[0]!.end)).toBe('báo')
    expect(decomposed.slice(fromDecomposed[0]!.start, fromDecomposed[0]!.end).normalize('NFC'))
      .toBe('báo')
  })

  /** Otherwise `an` lights up the middle of `Nguyễn` and every result is noise. */
  it('matches whole terms, not fragments inside words', () => {
    expect(findMatchRanges('Nguyễn An', ['an'])).toHaveLength(1)
    expect(findMatchRanges('deployment', ['deploy'])).toHaveLength(0)
  })

  it('highlights a prefix term, because the query matched it as one', () => {
    // The search appends `:*` to the last term, so `duy` genuinely matches
    // `duyệt`. Demanding a whole word here returned the message with nothing
    // marked, which reads as a wrong result rather than a partial one.
    const ranges = findMatchRanges('sẵn sàng để duyệt', [{ text: 'duy', prefix: true }])
    expect(ranges).toHaveLength(1)
    expect('sẵn sàng để duyệt'.slice(ranges[0]!.start, ranges[0]!.end)).toBe('duy')
  })

  it('still refuses a prefix term inside a word, not just at its start', () => {
    expect(findMatchRanges('deployment', [{ text: 'ploy', prefix: true }])).toHaveLength(0)
  })

  it('merges overlapping matches so nothing is highlighted twice', () => {
    const ranges = findMatchRanges('production build', ['production', 'production'])
    expect(ranges).toHaveLength(1)
  })

  it('returns nothing for an empty query', () => {
    expect(findMatchRanges('anything at all', [])).toEqual([])
    expect(findMatchRanges('anything at all', ['   '])).toEqual([])
  })

  it('handles emoji and CJK without corrupting offsets', () => {
    const original = '✅ 会议 done'
    const ranges = findMatchRanges(original, ['done'])
    expect(original.slice(ranges[0]!.start, ranges[0]!.end)).toBe('done')
  })
})

describe('buildSnippet', () => {
  it('returns short text unchanged', () => {
    const snippet = buildSnippet('short message', [{ start: 0, end: 5 }])
    expect(snippet.text).toBe('short message')
    expect(snippet.truncatedStart).toBe(false)
  })

  /** A naive slice can split a surrogate pair and render a replacement char. */
  it('never cuts inside a character', () => {
    const original = `${'👨‍👩‍👧‍👦 '.repeat(40)}production build here`
    const ranges = findMatchRanges(original, ['production'])
    const snippet = buildSnippet(original, ranges, 30)

    expect(snippet.text).not.toContain('�')
    expect(Array.from(snippet.text).join('')).toBe(snippet.text)
  })

  it('keeps the match inside the window and re-bases its range', () => {
    const original = `${'padding '.repeat(30)}production build${' trailing'.repeat(30)}`
    const ranges = findMatchRanges(original, ['production'])
    const snippet = buildSnippet(original, ranges, 40)

    expect(snippet.truncatedStart).toBe(true)
    expect(snippet.truncatedEnd).toBe(true)
    expect(snippet.text.slice(snippet.ranges[0]!.start, snippet.ranges[0]!.end)).toBe('production')
  })
})
