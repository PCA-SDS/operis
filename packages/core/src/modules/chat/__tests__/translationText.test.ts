import {
  MAX_TRANSLATABLE_SEGMENTS,
  detectionSegment,
  introducesMention,
  isTranslatable,
  normalizeText,
  reassembleBody,
  segmentBody,
  translatableSegmentIndexes,
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
    const decomposed = 'Vie\u0323\u0302t Nam'
    const composed = 'Việt Nam'
    expect(decomposed).not.toBe(composed)
    expect(normalizeText(decomposed)).toBe(composed)
    expect(normalizeText(composed)).toBe(composed)
  })

  it('leaves French accents alone', () => {
    expect(normalizeText('déjà vu, à côté')).toBe('déjà vu, à côté')
  })
})

describe('segmentBody', () => {
  /**
   * The engine never sees a mention. Measured against the real M2M100 weights,
   * an in-band marker survived generation zero times out of twelve, and two or
   * more of them drove the decoder into a degenerate loop that replaced the
   * message with repeated filler. A structure the model cannot see cannot be
   * dropped, reordered, mangled or invented.
   */
  it('keeps every mention out of the translatable runs', () => {
    const body = `Hi ${userToken(ALICE)}, ask ${userToken(BOB)} please`
    const segments = segmentBody(body)

    const mentions = segments.filter((s) => s.kind === 'mention').map((s) => s.value)
    expect(mentions).toEqual([userToken(ALICE), userToken(BOB)])
    for (const index of translatableSegmentIndexes(segments)) {
      expect(segments[index]!.value).not.toContain('<@')
    }
  })

  it('loses no characters', () => {
    for (const body of [
      `${userToken(ALICE)} bonjour`,
      `bonjour ${userToken(ALICE)}`,
      `${userToken(ALICE)}${userToken(BOB)}`,
      `${EVERYONE_TOKEN} standup now`,
      'no mentions at all',
    ]) {
      expect(segmentBody(body).map((s) => s.value).join('')).toBe(normalizeText(body))
    }
  })

  it('treats @everyone like any other mention', () => {
    const segments = segmentBody(`${EVERYONE_TOKEN} standup now`)
    expect(segments[0]).toEqual({ kind: 'mention', value: EVERYONE_TOKEN })
  })

  it('does not split on text that merely looks like a mention', () => {
    const segments = segmentBody('email me at <@not-a-uuid> please')
    expect(segments.every((s) => s.kind === 'text')).toBe(true)
  })

  /** Repeats are separate segments, so one cannot swallow the other. */
  it('keeps a repeated mention as two segments', () => {
    const body = `${userToken(ALICE)} merci ${userToken(ALICE)} encore`
    const mentions = segmentBody(body).filter((s) => s.kind === 'mention')
    expect(mentions).toHaveLength(2)
  })
})

describe('detectionSegment', () => {
  /**
   * Detection is settled once, on the longest run. A three-word fragment is
   * exactly where fastText is least reliable, and letting each run decide for
   * itself lets a fragment disagree with the sentence it came from.
   */
  it('hands over all of the prose, not the longest run of it', () => {
    const segments = segmentBody(
      `${userToken(ALICE)} et ${userToken(BOB)} doivent valider le budget avant vendredi`,
    )
    // Detection quality tracks how much text it sees, and the runs around a
    // mention are exactly the fragments it is worst on.
    expect(detectionSegment(segments)).toBe('et doivent valider le budget avant vendredi')
  })

  it('leaves the identifiers out — a UUID is not evidence of a language', () => {
    const segments = segmentBody(`${userToken(ALICE)} bonjour tout le monde`)
    expect(detectionSegment(segments)).toBe('bonjour tout le monde')
  })

  it('is null when there is nothing worth detecting', () => {
    expect(detectionSegment(segmentBody(userToken(ALICE)))).toBeNull()
    expect(detectionSegment(segmentBody('👍'))).toBeNull()
  })
})

describe('reassembleBody', () => {
  it('puts translated runs back between untouched mentions', () => {
    const body = `${userToken(ALICE)} peux-tu regarder la facture`
    const segments = segmentBody(body)
    const [index] = translatableSegmentIndexes(segments)
    const out = reassembleBody(segments, new Map([[index!, 'can you check the invoice']]))

    expect(out).toBe(`${userToken(ALICE)} can you check the invoice`)
  })

  /** The engine trims; the spacing around a mention comes from the original. */
  it('preserves the whitespace that surrounded the run', () => {
    const segments = segmentBody(`${userToken(ALICE)}   bonjour   ${userToken(BOB)}`)
    const [index] = translatableSegmentIndexes(segments)
    const out = reassembleBody(segments, new Map([[index!, 'hello']]))

    expect(out).toBe(`${userToken(ALICE)}   hello   ${userToken(BOB)}`)
  })

  it('leaves a run with no translation exactly as it was', () => {
    const segments = segmentBody(`${userToken(ALICE)} bonjour`)
    expect(reassembleBody(segments, new Map())).toBe(`${userToken(ALICE)} bonjour`)
  })

  it('emits every mention exactly once, in the original order', () => {
    const body = `${userToken(ALICE)} et ${userToken(BOB)} puis ${userToken(ALICE)}`
    const segments = segmentBody(body)
    const translations = new Map(
      translatableSegmentIndexes(segments).map((index) => [index, 'and then']),
    )
    const out = reassembleBody(segments, translations)

    expect(out.indexOf(userToken(BOB))).toBeGreaterThan(out.indexOf(userToken(ALICE)))
    expect(out.split(userToken(ALICE)).length - 1).toBe(2)
    expect(out.split(userToken(BOB)).length - 1).toBe(1)
  })
})

describe('introducesMention', () => {
  /**
   * A mention is a live relationship in the renderer. The model never sees one,
   * so emitting one would be an invention — and an invented `@everyone` is an
   * organization-wide ping nobody wrote.
   */
  it('catches a mention the engine invented', () => {
    expect(introducesMention(`hello ${userToken(ALICE)}`)).toBe(true)
    expect(introducesMention(`hello ${EVERYONE_TOKEN}`)).toBe(true)
  })

  it('passes ordinary prose, including text that resembles a token', () => {
    expect(introducesMention('hello everyone')).toBe(false)
    expect(introducesMention('see <@someone>')).toBe(false)
  })
})

describe('MAX_TRANSLATABLE_SEGMENTS', () => {
  it('is small enough that one message cannot fan out into many inferences', () => {
    expect(MAX_TRANSLATABLE_SEGMENTS).toBeLessThanOrEqual(8)
  })

  it('still allows an ordinary multi-line message with a mention', () => {
    const body = `${userToken(ALICE)} bonjour\nla réunion est jeudi\nmerci à tous`
    expect(translatableSegmentIndexes(segmentBody(body)).length).toBeLessThanOrEqual(
      MAX_TRANSLATABLE_SEGMENTS,
    )
  })
})

describe('line breaks', () => {
  /**
   * Measured against the real model: three lines came back as one and the
   * greeting was dropped. A newline is whitespace to the engine, so a list or
   * an address loses its shape and some of its content, silently and cached.
   */
  it('keeps line breaks out of the engine', () => {
    const segments = segmentBody('bonjour\nla réunion est jeudi')
    expect(segments.map((s) => s.kind)).toEqual(['text', 'break', 'text'])
    for (const index of translatableSegmentIndexes(segments)) {
      expect(segments[index]!.value).not.toContain('\n')
    }
  })

  it('restores the exact break run, however many', () => {
    const segments = segmentBody('un\n\n\ndeux')
    const translated = new Map(
      translatableSegmentIndexes(segments).map((index, order) => [index, order === 0 ? 'one' : 'two']),
    )
    expect(reassembleBody(segments, translated)).toBe('one\n\n\ntwo')
  })

  it('leaves detection unaffected by where the lines fall', () => {
    expect(detectionSegment(segmentBody('bonjour\ntout le monde'))).toBe('bonjour tout le monde')
  })
})

describe('isTranslatable', () => {
  it('accepts ordinary sentences in any script', () => {
    for (const s of ['bonjour', 'xin chào', '안녕하세요', 'dzień dobry']) {
      expect(isTranslatable(s)).toBe(true)
    }
  })

  it('rejects text with nothing to translate', () => {
    for (const s of ['', '   ', '+1', '123', '👍', '🎉🎉']) {
      expect(isTranslatable(s)).toBe(false)
    }
  })

  it('rejects a message that is only a mention', () => {
    expect(isTranslatable(userToken(ALICE))).toBe(false)
    expect(isTranslatable(EVERYONE_TOKEN)).toBe(false)
  })

  it('counts letters, not length, so a short real word passes', () => {
    expect(isTranslatable('oui')).toBe(true)
    expect(isTranslatable('a')).toBe(false)
  })
})
