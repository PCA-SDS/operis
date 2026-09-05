import {
  isTranslatable,
  normalizeText,
  prepareForTranslation,
  restoreAfterTranslation,
} from '../lib/translationText'
import { userToken, EVERYONE_TOKEN } from '../lib/mentions'

const ALICE = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const BOB = '11111111-2222-4333-8444-555555555555'

describe('normalizeText', () => {
  /**
   * Vietnamese stacks diacritics, so the same visible character has two byte
   * representations. Mismatched normalisation gives rows that look right,
   * compare unequal, and miss every cache lookup - so the same message is
   * re-translated forever with no visible symptom.
   */
  it('composes decomposed Vietnamese to a single representation', () => {
    const decomposed = 'Vie\u0323\u0302t Nam' // e + dot below + circumflex
    const composed = 'Việt Nam'
    expect(decomposed).not.toBe(composed)
    expect(normalizeText(decomposed)).toBe(composed)
    expect(normalizeText(composed)).toBe(composed)
  })

  it('makes the two forms compare equal once normalised', () => {
    const a = normalizeText('ti\u00ea\u0301ng Vie\u0323\u0302t')
    const b = normalizeText('tiếng Việt')
    expect(a).toBe(b)
  })

  it('leaves French accents alone', () => {
    expect(normalizeText('déjà vu, à côté')).toBe('déjà vu, à côté')
  })
})

describe('prepareForTranslation', () => {
  it('lifts every mention out and leaves a marker', () => {
    const body = `Hi ${userToken(ALICE)}, ask ${userToken(BOB)} please`
    const prepared = prepareForTranslation(body)
    expect(prepared.placeholders).toHaveLength(2)
    // Nothing resembling a token reaches the engine.
    expect(prepared.text).not.toContain('<@')
    expect(prepared.text).toContain('Hi ')
    expect(prepared.text).toContain(' please')
  })

  it('lifts an everyone token too', () => {
    const prepared = prepareForTranslation(`${EVERYONE_TOKEN} standup now`)
    expect(prepared.placeholders).toHaveLength(1)
    expect(prepared.text).not.toContain('<@')
  })

  it('normalises on the way out', () => {
    const prepared = prepareForTranslation('Vie\u0323\u0302t')
    expect(prepared.text).toBe('Việt')
  })

  it('leaves a body with no mentions untouched apart from normalising', () => {
    const prepared = prepareForTranslation('bonjour tout le monde')
    expect(prepared.placeholders).toHaveLength(0)
    expect(prepared.text).toBe('bonjour tout le monde')
  })
})

describe('restoreAfterTranslation', () => {
  const roundTrip = (body: string, translate: (text: string) => string) => {
    const prepared = prepareForTranslation(body)
    return restoreAfterTranslation(translate(prepared.text), prepared.placeholders)
  }

  it('puts every mention back exactly as it was', () => {
    const body = `Hi ${userToken(ALICE)}, ask ${userToken(BOB)}`
    // A well-behaved engine carries the markers through.
    const out = roundTrip(body, (t) => t.replace('Hi', 'Bonjour').replace('ask', 'demande à'))
    expect(out).toContain(userToken(ALICE))
    expect(out).toContain(userToken(BOB))
    expect(out).toContain('Bonjour')
  })

  it('survives an engine that reorders the markers', () => {
    // Word order changes between languages; the mentions must follow.
    const body = `${userToken(ALICE)} sent ${userToken(BOB)} a file`
    const prepared = prepareForTranslation(body)
    const reversed = prepared.text.split(' ').reverse().join(' ')
    const out = restoreAfterTranslation(reversed, prepared.placeholders)
    expect(out).toContain(userToken(ALICE))
    expect(out).toContain(userToken(BOB))
  })

  it('recovers a mention the engine dropped entirely', () => {
    // Losing word order is recoverable; losing a mention is not, so a dropped
    // marker is appended rather than silently discarded.
    const body = `ping ${userToken(ALICE)}`
    const out = roundTrip(body, () => 'ping')
    expect(out).toContain(userToken(ALICE))
  })

  it('normalises what the engine returns', () => {
    const out = restoreAfterTranslation('Vie\u0323\u0302t', [])
    expect(out).toBe('Việt')
  })

  /**
   * The delimiters are what make a marker a marker. Recognising the digits on
   * their own turns every number in the message into a restoration target: the
   * mention lands on the sender's "0", and the marker's own digits survive as
   * literal text.
   */
  it('leaves ordinary numbers alone when the engine erases a marker', () => {
    const body = `${userToken(ALICE)} we have 0 blockers`
    const prepared = prepareForTranslation(body)
    const erased = prepared.text.replace(/[\uE000\uE001]/g, '')
    const out = restoreAfterTranslation(erased, prepared.placeholders)

    expect(out).toContain('0 blockers')
    expect(out.match(new RegExp(userToken(ALICE), 'g'))).toHaveLength(1)
  })

  /**
   * The token appended for a lost marker is a UUID, which is full of digits. A
   * later placeholder that matched bare digits found one inside it and restored
   * itself into the middle of the mention just written, destroying both.
   */
  it('never restores one mention inside another', () => {
    const body = `${userToken(ALICE)} and ${userToken(BOB)} ship it`
    const prepared = prepareForTranslation(body)
    const out = restoreAfterTranslation('expédie-le', prepared.placeholders)

    expect(out).toContain(userToken(ALICE))
    expect(out).toContain(userToken(BOB))
    expect(out).not.toMatch(/<@[^>]*<@/)
  })

  /** One delimiter is enough to identify a marker; the digits alone are not. */
  it('recovers a marker that kept one delimiter', () => {
    const body = `hello ${userToken(ALICE)}`
    const prepared = prepareForTranslation(body)
    const out = restoreAfterTranslation(
      prepared.text.replace('\uE001', ''),
      prepared.placeholders,
    )

    expect(out).toBe(`hello ${userToken(ALICE)}`)
  })

  /**
   * U+E000 opens the icon-font range, so a glyph pasted from Font Awesome puts
   * a delimiter in the body. Left there it forges a marker.
   */
  it('strips delimiters the sender typed', () => {
    // The body forges marker zero, which would otherwise capture the first
    // mention's restoration and leave that mention nowhere.
    const prepared = prepareForTranslation(`\uE00000\uE001 hi ${userToken(BOB)}`)

    expect(prepared.text.match(/[\uE000\uE001]/g)).toHaveLength(2)
    expect(prepared.text.startsWith('00 hi ')).toBe(true)

    const out = restoreAfterTranslation(prepared.text, prepared.placeholders)
    expect(out).toBe(`00 hi ${userToken(BOB)}`)
  })

  /**
   * Marker 1 must not match the leading digit of marker 10, which is what a
   * variable-width index allowed once a delimiter was lost.
   */
  it('keeps double-digit markers distinct from single-digit ones', () => {
    const tokens = Array.from({ length: 11 }, (_, index) =>
      userToken(`${index}0000000-0000-4000-8000-000000000000`),
    )
    const prepared = prepareForTranslation(`${tokens.join(' ')} done`)
    const opened = prepared.text.replace(/\uE001/g, '')
    const out = restoreAfterTranslation(opened, prepared.placeholders)

    for (const token of tokens) expect(out).toContain(token)
  })
})

describe('isTranslatable', () => {
  it('accepts ordinary sentences in any script', () => {
    for (const s of ['bonjour', 'xin chào', '안녕하세요', 'dzień dobry']) {
      expect(isTranslatable(s)).toBe(true)
    }
  })

  it('rejects text with nothing to translate', () => {
    // Asking about these costs a request to be told what we already know, and
    // invites a confident wrong answer on input with no linguistic content.
    for (const s of ['', '   ', '+1', '123', '👍', '🎉🎉']) {
      expect(isTranslatable(s)).toBe(false)
    }
  })

  it('rejects a message that is only a mention', () => {
    expect(isTranslatable(userToken(ALICE))).toBe(false)
    expect(isTranslatable(EVERYONE_TOKEN)).toBe(false)
  })

  it('accepts a mention with real words around it', () => {
    expect(isTranslatable(`${userToken(ALICE)} bonjour`)).toBe(true)
  })

  it('counts letters, not length, so a short real word passes', () => {
    expect(isTranslatable('oui')).toBe(true)
    expect(isTranslatable('a')).toBe(false)
  })
})
