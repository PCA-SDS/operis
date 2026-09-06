import { MENTION_TOKEN } from './mentions'

/**
 * Finding the links in a message.
 *
 * Deliberately conservative. The Shared panel's Links tab is a list of things
 * somebody meant to share, so a false positive there is worse than a miss: a
 * list padded with fragments of internal identifiers is one nobody reads.
 *
 * Only absolute `http`/`https` URLs count. A bare `example.com` is more often
 * prose than a link, `www.` without a scheme is ambiguous, and neither is
 * something a reader clicked "share" on.
 */

/** Matched on the body with mention tokens already removed. */
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi

/**
 * Trailing characters that are punctuation around a link rather than part of
 * it. `Look at https://example.com/report.` ends a sentence; the full stop is
 * not in the URL.
 */
const TRAILING_PUNCTUATION = /[.,;:!?]+$/

export type ExtractedLink = {
  url: string
  host: string
}

/** Balance closing brackets so `(https://example.com/a_(b))` survives intact. */
function trimUnbalanced(candidate: string): string {
  let result = candidate.replace(TRAILING_PUNCTUATION, '')
  for (const [open, close] of [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ] as const) {
    while (result.endsWith(close)) {
      const opens = result.split(open).length - 1
      const closes = result.split(close).length - 1
      if (opens >= closes) break
      result = result.slice(0, -1)
    }
  }
  return result
}

/**
 * The links in a message body, in the order they appear, deduplicated.
 *
 * Mention tokens are stripped first: a body stores `<@` plus a UUID, and the
 * hex could otherwise be read as part of an adjacent URL.
 */
export function extractLinks(body: string, limit = 20): ExtractedLink[] {
  const withoutMentions = body.replace(new RegExp(MENTION_TOKEN.source, 'g'), ' ')
  const seen = new Set<string>()
  const links: ExtractedLink[] = []

  for (const match of withoutMentions.matchAll(URL_PATTERN)) {
    const candidate = trimUnbalanced(match[0])
    if (candidate.length === 0) continue

    let parsed: URL
    try {
      parsed = new URL(candidate)
    } catch {
      // Anything the platform's own parser rejects is not a link, whatever it
      // looked like. Better to miss one than to index a malformed string.
      continue
    }
    // The pattern already restricts the scheme, but parsing can still surface
    // something else through an unusual encoding.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
    if (parsed.hostname.length === 0) continue

    // Deduplicated on the URL as written, so the same link said twice in one
    // message is one row.
    const key = parsed.href
    if (seen.has(key)) continue
    seen.add(key)

    links.push({ url: candidate, host: parsed.hostname })
    // Bounded: a message pasted full of URLs should not become an unbounded
    // number of rows in the same transaction as the message.
    if (links.length >= limit) break
  }

  return links
}
