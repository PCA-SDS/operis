/**
 * Finding the links people meant to share.
 *
 * The Links tab is a list somebody will scan, so a false positive costs more
 * than a miss: padded with identifier fragments and half-parsed prose, it stops
 * being worth opening.
 */
import { extractLinks } from '../lib/links'

const urls = (body: string) => extractLinks(body).map((link) => link.url)

describe('extractLinks', () => {
  it('finds an absolute link', () => {
    expect(urls('see https://example.com/report')).toEqual(['https://example.com/report'])
  })

  it('records the host so the panel need not parse on every render', () => {
    expect(extractLinks('https://docs.example.com/a')[0]).toEqual({
      url: 'https://docs.example.com/a',
      host: 'docs.example.com',
    })
  })

  it('leaves sentence punctuation out of the link', () => {
    expect(urls('read https://example.com/report.')).toEqual(['https://example.com/report'])
    expect(urls('here: https://example.com/a, and more')).toEqual(['https://example.com/a'])
  })

  it('keeps balanced brackets that belong to the URL', () => {
    expect(urls('(https://example.com/a_(b))')).toEqual(['https://example.com/a_(b)'])
  })

  it('ignores a mention, even though it contains hex', () => {
    // A body stores `<@` plus a UUID. Read as text next to a URL, that hex can
    // look like part of one.
    expect(urls('ask <@11111111-1111-4111-8111-111111111111> about it')).toEqual([])
  })

  it('ignores bare domains and schemeless prose', () => {
    // `example.com` in a sentence is more often prose than a link, and nobody
    // clicked "share" on it.
    expect(urls('the site is example.com')).toEqual([])
    expect(urls('go to www.example.com')).toEqual([])
  })

  it('ignores schemes that are not the web', () => {
    expect(urls('file:///etc/passwd')).toEqual([])
    expect(urls('javascript:alert(1)')).toEqual([])
    expect(urls('mailto:someone@example.com')).toEqual([])
  })

  it('says the same link once however often it is repeated', () => {
    expect(urls('https://example.com/a and again https://example.com/a')).toEqual([
      'https://example.com/a',
    ])
  })

  it('keeps distinct links in the order they were written', () => {
    expect(urls('https://a.example.com then https://b.example.com')).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ])
  })

  it('is bounded, so one message cannot become unbounded rows', () => {
    const many = Array.from({ length: 40 }, (_, index) => `https://example.com/${index}`).join(' ')
    expect(extractLinks(many)).toHaveLength(20)
  })

  it('finds nothing in a message with nothing to find', () => {
    expect(urls('')).toEqual([])
    expect(urls('just talking about the report')).toEqual([])
  })
})
