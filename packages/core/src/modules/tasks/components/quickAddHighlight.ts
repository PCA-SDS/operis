import type { QuickAddRecognizedTokenDto } from '../data/types'

export type HighlightSegment = {
  text: string
  token: QuickAddRecognizedTokenDto | null
}

/**
 * Split the composer's raw input into plain and recognised spans so the overlay
 * can tint what the parser claimed.
 *
 * Returns `null` — meaning "render the plain textarea, no overlay" — whenever
 * the offsets cannot be trusted: the parse is stale relative to what is typed
 * now, a token span falls outside the text, or the text at a span no longer
 * matches what the parser saw. A misaligned overlay is far worse than none,
 * because it silently mislabels the user's own words.
 */
export function buildHighlightSegments(
  text: string,
  originalText: string,
  tokens: readonly QuickAddRecognizedTokenDto[],
): HighlightSegment[] | null {
  if (tokens.length === 0 || text.length === 0) return null
  if (text.trim() !== originalText) return null
  // Offsets are relative to the trimmed text the parser was handed.
  const lead = text.length - text.trimStart().length

  const ordered = [...tokens].sort((a, b) => a.start - b.start)
  const segments: HighlightSegment[] = []
  let cursor = 0

  for (const token of ordered) {
    const start = token.start + lead
    const end = token.end + lead
    if (start < cursor || end > text.length) continue
    if (text.slice(start, end) !== token.text) continue
    if (start > cursor) segments.push({ text: text.slice(cursor, start), token: null })
    segments.push({ text: token.text, token })
    cursor = end
  }

  if (cursor === 0) return null
  if (cursor < text.length) segments.push({ text: text.slice(cursor), token: null })
  return segments
}
