import {
  EVERYONE_TOKEN,
  extractMentionedUserIds,
  mentionsEveryone,
  parseMessageBody,
  renderMentionsAsText,
  userToken,
} from '../lib/mentions'
import { applyMention, detectMentionDraft } from '../lib/mentionDraft'

const ALICE = '11111111-1111-4111-8111-111111111111'
const BOB = '22222222-2222-4222-8222-222222222222'
const LABELS = { everyone: 'everyone', unknownPerson: 'Former colleague' }

/**
 * Mentions are a relationship, not a piece of text. These assertions are what
 * keeps that true: the body stores an id, the name is looked up at render, and a
 * body that merely *looks* like a mention stays the characters somebody typed.
 */
describe('mention tokens', () => {
  it('finds the people a body names, in order and without repeats', () => {
    const body = `${userToken(ALICE)} and ${userToken(BOB)} and ${userToken(ALICE)} again`
    expect(extractMentionedUserIds(body)).toEqual([ALICE, BOB])
  })

  it('does not count @everyone as a person', () => {
    expect(extractMentionedUserIds(`${EVERYONE_TOKEN} hello`)).toEqual([])
    expect(mentionsEveryone(`${EVERYONE_TOKEN} hello`)).toBe(true)
    expect(mentionsEveryone('nothing here')).toBe(false)
  })

  it('leaves text that only resembles a token alone', () => {
    // A malformed id is somebody typing, not a mention — and must never become
    // one, or a message could name a person by accident.
    expect(extractMentionedUserIds('<@not-a-uuid> hi')).toEqual([])
    expect(extractMentionedUserIds('email me at <@example.com>')).toEqual([])
  })

  it('resolves names at render, so a rename reaches old messages', () => {
    const body = `${userToken(ALICE)} shipped it`
    const before = parseMessageBody(body, new Map([[ALICE, 'Alice Tan']]), LABELS)
    const after = parseMessageBody(body, new Map([[ALICE, 'Alice Chen']]), LABELS)
    expect(before[0]).toEqual({ kind: 'mention', userId: ALICE, label: 'Alice Tan' })
    expect(after[0]).toEqual({ kind: 'mention', userId: ALICE, label: 'Alice Chen' })
  })

  it('falls back to a label rather than leaking a raw id', () => {
    const [segment] = parseMessageBody(userToken(ALICE), new Map(), LABELS)
    expect(segment).toEqual({ kind: 'mention', userId: ALICE, label: 'Former colleague' })
  })

  it('splits a body into text and mentions without losing characters', () => {
    const segments = parseMessageBody(`hi ${userToken(ALICE)}!`, new Map([[ALICE, 'Alice']]), LABELS)
    expect(segments).toEqual([
      { kind: 'text', text: 'hi ' },
      { kind: 'mention', userId: ALICE, label: 'Alice' },
      { kind: 'text', text: '!' },
    ])
  })

  it('renders a readable line for surfaces that cannot show chips', () => {
    const body = `${userToken(ALICE)} ping ${EVERYONE_TOKEN}`
    expect(renderMentionsAsText(body, new Map([[ALICE, 'Alice']]), LABELS)).toBe('@Alice ping @everyone')
  })
})

/**
 * The composer's half: which `@` the caret is inside, and what replacing it
 * does. The word-start rule is the one that matters — without it, typing an
 * email address opens a member menu halfway through.
 */
describe('mention drafting', () => {
  it('detects a mention the caret is inside', () => {
    expect(detectMentionDraft('hey @al', 7)).toEqual({ start: 4, query: 'al' })
  })

  it('treats a bare @ as the start of one', () => {
    expect(detectMentionDraft('hey @', 5)).toEqual({ start: 4, query: '' })
  })

  it('ignores an @ that does not start a word', () => {
    expect(detectMentionDraft('mail me at bob@acme.com', 23)).toBeNull()
  })

  it('closes once the caret moves past whitespace', () => {
    expect(detectMentionDraft('@alice said hi', 14)).toBeNull()
  })

  it('is inert with no caret', () => {
    expect(detectMentionDraft('@alice', null)).toBeNull()
  })

  it('replaces the draft with a token and reports where the caret lands', () => {
    const result = applyMention('hey @al', { start: 4, query: 'al' }, 7, userToken(ALICE))
    expect(result.value).toBe(`hey ${userToken(ALICE)} `)
    // Past the trailing space, so typing continues straight after the colleague.
    expect(result.caret).toBe(result.value.length)
  })

  it('keeps whatever followed the draft', () => {
    const result = applyMention('hey @al there', { start: 4, query: 'al' }, 7, userToken(ALICE))
    expect(result.value).toBe(`hey ${userToken(ALICE)}  there`)
  })
})
