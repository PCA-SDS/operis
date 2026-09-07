/** @jest-environment node */
import {
  DEFAULT_MAX_TEXT_SIZE,
  DEFAULT_PRICE_MISMATCH_THRESHOLD,
  DEFAULT_TRANSLATION_TIMEOUT_MS,
  resolveMaxTextSize,
  resolvePriceMismatchThreshold,
  resolveTranslationTimeoutMs,
} from '../config'

const ENV_KEYS = [
  'INBOX_OPS_MAX_TEXT_SIZE',
  'INBOX_OPS_TRANSLATION_TIMEOUT_MS',
  'INBOX_OPS_PRICE_MISMATCH_THRESHOLD',
] as const

const originals = new Map<string, string | undefined>()

beforeAll(() => {
  for (const key of ENV_KEYS) originals.set(key, process.env[key])
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = originals.get(key)
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  }
})

// `slice(0, NaN)` returns an empty string rather than the full text, so a
// malformed value used to drop every email body instead of truncating it.
describe('resolveMaxTextSize', () => {
  it.each(['abc', 'kb200', ' ', '0', '-1'])('falls back when the value is unusable: %p', (raw) => {
    process.env.INBOX_OPS_MAX_TEXT_SIZE = raw
    expect(resolveMaxTextSize()).toBe(DEFAULT_MAX_TEXT_SIZE)
  })

  it('keeps a text budget the caller can actually slice with', () => {
    process.env.INBOX_OPS_MAX_TEXT_SIZE = 'abc'
    expect('hello world'.slice(0, resolveMaxTextSize())).toBe('hello world')
  })

  it('honours a valid override', () => {
    process.env.INBOX_OPS_MAX_TEXT_SIZE = '512'
    expect(resolveMaxTextSize()).toBe(512)
  })

  // parseNumberWithDefault parses with parseInt when integer:true, so a unit
  // suffix is truncated rather than rejected. Pinned so the behaviour is a
  // documented choice rather than a surprise.
  it('prefix-parses a suffixed value instead of rejecting it', () => {
    process.env.INBOX_OPS_MAX_TEXT_SIZE = '200kb'
    expect(resolveMaxTextSize()).toBe(200)
  })
})

describe('resolveTranslationTimeoutMs', () => {
  it.each(['abc', 'ms30', ' ', '0'])('falls back when the value is unusable: %p', (raw) => {
    process.env.INBOX_OPS_TRANSLATION_TIMEOUT_MS = raw
    expect(resolveTranslationTimeoutMs()).toBe(DEFAULT_TRANSLATION_TIMEOUT_MS)
  })

  it('honours a valid override', () => {
    process.env.INBOX_OPS_TRANSLATION_TIMEOUT_MS = '5000'
    expect(resolveTranslationTimeoutMs()).toBe(5000)
  })
})

// A NaN threshold makes `priceDiff > threshold` false for every line, which
// silently disables price-mismatch detection.
describe('resolvePriceMismatchThreshold', () => {
  it.each(['abc', ' ', '-0.1'])('falls back when the value is unusable: %p', (raw) => {
    process.env.INBOX_OPS_PRICE_MISMATCH_THRESHOLD = raw
    expect(resolvePriceMismatchThreshold()).toBe(DEFAULT_PRICE_MISMATCH_THRESHOLD)
  })

  it('still flags a discrepancy above the resolved threshold', () => {
    process.env.INBOX_OPS_PRICE_MISMATCH_THRESHOLD = 'abc'
    const priceDiff = 0.2
    expect(priceDiff > resolvePriceMismatchThreshold()).toBe(true)
  })

  it('honours a valid override, including zero', () => {
    process.env.INBOX_OPS_PRICE_MISMATCH_THRESHOLD = '0'
    expect(resolvePriceMismatchThreshold()).toBe(0)
  })
})
