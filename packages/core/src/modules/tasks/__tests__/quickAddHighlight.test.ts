import { buildHighlightSegments } from '../components/quickAddHighlight'
import { parseQuickAdd } from '../lib/quick-add/parser'
import type { QuickAddRecognizedTokenDto } from '../data/types'

const TODAY = '2026-03-04'

function segmentsFor(text: string) {
  const parsed = parseQuickAdd(text.trim(), TODAY)
  return buildHighlightSegments(text, text.trim(), parsed.recognizedTokens)
}

describe('buildHighlightSegments', () => {
  it('splits the text into plain and recognised spans', () => {
    const text = 'Ship the release tomorrow'
    const segments = segmentsFor(text)
    expect(segments).not.toBeNull()
    // Concatenating the segments must reproduce the input exactly, or the
    // overlay would drift from the textarea underneath it.
    expect(segments!.map((segment) => segment.text).join('')).toBe(text)
    expect(segments!.some((segment) => segment.token?.type === 'date')).toBe(true)
  })

  it('handles several tokens in order', () => {
    const text = 'Ship #Ops tomorrow at 3pm p1'
    const segments = segmentsFor(text)!
    const types = segments.filter((segment) => segment.token).map((segment) => segment.token!.type)
    expect(new Set(types)).toEqual(new Set(['project', 'priority', 'time', 'date']))
    expect(segments.map((segment) => segment.text).join('')).toBe(text)
  })

  it('accounts for leading whitespace the parser never saw', () => {
    const text = '   tomorrow ship it'
    const segments = segmentsFor(text)!
    expect(segments.map((segment) => segment.text).join('')).toBe(text)
    const token = segments.find((segment) => segment.token)
    expect(token?.text).toBe('tomorrow')
  })

  it('renders nothing when there is no token to highlight', () => {
    expect(segmentsFor('Ship the release')).toBeNull()
  })

  it('renders nothing for empty input', () => {
    expect(buildHighlightSegments('', '', [])).toBeNull()
  })

  it('refuses to render when the parse is stale', () => {
    // The user typed on after the parse ran; offsets no longer describe the
    // text, and a misaligned overlay would mislabel their own words.
    const parsed = parseQuickAdd('Ship tomorrow', TODAY)
    expect(buildHighlightSegments('Ship tomorrow and more', 'Ship tomorrow', parsed.recognizedTokens)).toBeNull()
  })

  it('drops a token whose span no longer matches the text', () => {
    const bogus: QuickAddRecognizedTokenDto[] = [
      { text: 'nope', type: 'date', start: 0, end: 4 },
    ]
    expect(buildHighlightSegments('Ship it', 'Ship it', bogus)).toBeNull()
  })

  it('drops a token that runs past the end of the text', () => {
    const bogus: QuickAddRecognizedTokenDto[] = [
      { text: 'Ship it and more', type: 'date', start: 0, end: 99 },
    ]
    expect(buildHighlightSegments('Ship it', 'Ship it', bogus)).toBeNull()
  })
})
