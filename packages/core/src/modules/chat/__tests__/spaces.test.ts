import {
  chatAddMembersSchema,
  chatCreateConversationSchema,
  chatRenameConversationSchema,
  chatSendMessageSchema,
  chatSetMemberRoleSchema,
  MAX_SPACE_MEMBERS_PER_REQUEST,
  MAX_SPACE_TITLE_LENGTH,
} from '../data/validators'

const ALICE = '11111111-1111-4111-8111-111111111111'
const BOB = '22222222-2222-4222-8222-222222222222'
const CAROL = '33333333-3333-4333-8333-333333333333'

/**
 * The create endpoint is one union over two shapes, and the whole point of the
 * union is that the direct branch did not change. These assertions are the
 * backward-compatibility contract for every phase-1 client.
 */
describe('chatCreateConversationSchema', () => {
  it('still accepts a bare userId as a direct conversation', () => {
    expect(chatCreateConversationSchema.parse({ userId: BOB })).toEqual({ userId: BOB })
  })

  it('accepts an explicit direct kind', () => {
    expect(chatCreateConversationSchema.parse({ kind: 'direct', userId: BOB })).toEqual({
      kind: 'direct',
      userId: BOB,
    })
  })

  it('accepts a space with members', () => {
    expect(
      chatCreateConversationSchema.parse({
        kind: 'space',
        title: 'Project Alpha',
        memberIds: [BOB, CAROL],
      }),
    ).toEqual({ kind: 'space', title: 'Project Alpha', memberIds: [BOB, CAROL] })
  })

  it('accepts a space with nobody but its creator', () => {
    expect(chatCreateConversationSchema.parse({ kind: 'space', title: 'Solo' })).toEqual({
      kind: 'space',
      title: 'Solo',
    })
  })

  it('collapses duplicate member ids instead of failing', () => {
    expect(
      chatCreateConversationSchema.parse({ kind: 'space', title: 'Dupes', memberIds: [BOB, BOB, CAROL] }),
    ).toEqual({ kind: 'space', title: 'Dupes', memberIds: [BOB, CAROL] })
  })

  it('rejects a space with no title', () => {
    expect(() => chatCreateConversationSchema.parse({ kind: 'space' })).toThrow()
  })

  it('rejects a whitespace-only title rather than storing a blank space', () => {
    expect(() => chatCreateConversationSchema.parse({ kind: 'space', title: '   \n  ' })).toThrow()
  })

  it('strips control characters, so a title cannot smuggle a terminal escape', () => {
    const parsed = chatCreateConversationSchema.parse({
      kind: 'space',
      title: 'Finance\u001b[31m',
      memberIds: [BOB],
    })
    expect(parsed).toMatchObject({ title: 'Finance[31m' })
  })

  it('collapses internal whitespace so a name is one line', () => {
    expect(
      chatCreateConversationSchema.parse({ kind: 'space', title: '  Project   Alpha \n Team ' }),
    ).toMatchObject({ title: 'Project Alpha Team' })
  })

  it('rejects a title past the length limit', () => {
    expect(() =>
      chatCreateConversationSchema.parse({
        kind: 'space',
        title: 'x'.repeat(MAX_SPACE_TITLE_LENGTH + 1),
      }),
    ).toThrow()
  })

  it('refuses more members than one request may carry', () => {
    const tooMany = Array.from(
      { length: MAX_SPACE_MEMBERS_PER_REQUEST + 1 },
      (_, index) => `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
    )
    expect(() =>
      chatCreateConversationSchema.parse({ kind: 'space', title: 'Big', memberIds: tooMany }),
    ).toThrow()
  })

  it('refuses a non-uuid member id', () => {
    expect(() =>
      chatCreateConversationSchema.parse({ kind: 'space', title: 'Bad', memberIds: ['not-a-uuid'] }),
    ).toThrow()
  })
})

describe('chatRenameConversationSchema', () => {
  it('normalizes exactly as creation does, so a rename cannot store what create refuses', () => {
    expect(chatRenameConversationSchema.parse({ title: '  Finance   Team  ' })).toEqual({
      title: 'Finance Team',
    })
  })

  it('rejects an empty title', () => {
    expect(() => chatRenameConversationSchema.parse({ title: '  ' })).toThrow()
  })
})

describe('chatAddMembersSchema', () => {
  it('requires at least one person', () => {
    expect(() => chatAddMembersSchema.parse({ memberIds: [] })).toThrow()
  })

  it('deduplicates', () => {
    expect(chatAddMembersSchema.parse({ memberIds: [ALICE, ALICE] })).toEqual({ memberIds: [ALICE] })
  })
})

describe('chatSetMemberRoleSchema', () => {
  it('accepts only the two roles the model has', () => {
    expect(chatSetMemberRoleSchema.parse({ role: 'owner' })).toEqual({ role: 'owner' })
    expect(chatSetMemberRoleSchema.parse({ role: 'member' })).toEqual({ role: 'member' })
    expect(() => chatSetMemberRoleSchema.parse({ role: 'admin' })).toThrow()
  })
})

describe('chatSendMessageSchema with replies', () => {
  it('accepts a reply target', () => {
    expect(chatSendMessageSchema.parse({ body: 'sure', replyToMessageId: ALICE })).toMatchObject({
      body: 'sure',
      replyToMessageId: ALICE,
    })
  })

  it('leaves a plain message without one', () => {
    expect(chatSendMessageSchema.parse({ body: 'sure' }).replyToMessageId).toBeUndefined()
  })

  it('refuses a non-uuid reply target rather than passing it to the database', () => {
    expect(() => chatSendMessageSchema.parse({ body: 'sure', replyToMessageId: '../../etc' })).toThrow()
  })
})
