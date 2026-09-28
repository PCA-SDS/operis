import { safeJson, truncate } from '../log-format'
import { isIndexerVerbose } from '../verbose'

describe('indexer log formatting', () => {
  it('truncates long text with an ellipsis and passes short text through', () => {
    expect(truncate('abcdefghij', 8)).toBe('abcde...')
    expect(truncate('short', 8)).toBe('short')
    expect(truncate(null, 8)).toBeNull()
  })

  it('makes payloads JSON-safe', () => {
    expect(safeJson({ a: 1, when: new Date('2026-01-01T00:00:00.000Z') })).toEqual({ a: 1, when: '2026-01-01T00:00:00.000Z' })
    expect(safeJson(undefined)).toBeNull()
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(safeJson(circular)).toEqual({ note: 'unserializable', asString: '[object Object]' })
  })
})

describe('isIndexerVerbose', () => {
  const original = process.env.OM_INDEXER_VERBOSE
  afterEach(() => {
    if (original === undefined) delete process.env.OM_INDEXER_VERBOSE
    else process.env.OM_INDEXER_VERBOSE = original
  })

  it('reads OM_INDEXER_VERBOSE as a boolean token', () => {
    process.env.OM_INDEXER_VERBOSE = 'yes'
    expect(isIndexerVerbose()).toBe(true)
    process.env.OM_INDEXER_VERBOSE = 'nope'
    expect(isIndexerVerbose()).toBe(false)
    delete process.env.OM_INDEXER_VERBOSE
    expect(isIndexerVerbose()).toBe(false)
  })
})
