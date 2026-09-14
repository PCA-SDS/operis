import { hashRequest, reclaim } from '../commands/links'

/**
 * The request fingerprint is what stops a reused key returning a task the caller
 * never described, and what lets a genuine retry be recognised as one. Both halves
 * are tested: equal meanings must hash equal, and any change that would alter the
 * resulting task must hash differently.
 */
describe('hashRequest', () => {
  const base = {
    conversationId: 'c-1',
    sourceMessageId: null,
    title: 'Prepare the proposal',
    description: null,
    priority: 'high',
    assigneeIds: ['u-1', 'u-2'],
    projectId: 'p-1',
    dueDate: '2026-09-20',
    labelIds: ['l-1'],
    publishCard: true,
  }

  it('is stable across key order, so an object built differently still matches', () => {
    const reordered = {
      publishCard: true,
      labelIds: ['l-1'],
      dueDate: '2026-09-20',
      projectId: 'p-1',
      assigneeIds: ['u-1', 'u-2'],
      priority: 'high',
      description: null,
      title: 'Prepare the proposal',
      sourceMessageId: null,
      conversationId: 'c-1',
    }
    expect(hashRequest(reordered)).toBe(hashRequest(base))
  })

  it('ignores keys whose value is undefined, so an omitted field matches an absent one', () => {
    expect(hashRequest({ ...base, milestoneId: undefined })).toBe(hashRequest(base))
  })

  it('distinguishes undefined from null, because null is a stated choice', () => {
    expect(hashRequest({ ...base, milestoneId: null })).not.toBe(hashRequest(base))
  })

  it.each([
    ['a different title', { title: 'Something else' }],
    ['a different assignee set', { assigneeIds: ['u-1'] }],
    ['a different due date', { dueDate: '2026-09-21' }],
    ['a different project', { projectId: 'p-2' }],
    ['a different priority', { priority: 'low' }],
    ['a different source message', { sourceMessageId: 'm-1' }],
    ['a different label set', { labelIds: [] }],
    ['a different card choice', { publishCard: false }],
  ])('changes for %s', (_label, patch) => {
    expect(hashRequest({ ...base, ...patch })).not.toBe(hashRequest(base))
  })

  it('is order-sensitive inside an array, so the caller must sort before hashing', () => {
    // The command sorts every id list before hashing. This asserts the helper itself
    // does NOT sort, so that responsibility stays visible at the call site rather
    // than being silently absorbed here.
    expect(hashRequest({ ...base, assigneeIds: ['u-2', 'u-1'] })).not.toBe(hashRequest(base))
  })

  it('produces a fixed-width hex digest, so the column can be a plain text key', () => {
    expect(hashRequest(base)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('separates nested structures rather than flattening them into one string', () => {
    // Without real delimiters, `{a:'1',b:''}` and `{a:'',b:'1'}` would collide — and a
    // collision here means one caller's key replaying another caller's task.
    expect(hashRequest({ a: '1', b: '' })).not.toBe(hashRequest({ a: '', b: '1' }))
    expect(hashRequest({ a: ['1', '2'] })).not.toBe(hashRequest({ a: ['12'] }))
  })
})

/**
 * The ledger's state machine, which is the whole duplicate-prevention guarantee.
 *
 * These are about the transitions rather than the hash: what a second request
 * carrying a key that is already on the ledger is allowed to do.
 */
describe('claiming a key that is already on the ledger', () => {
  const HASH = 'a'.repeat(64)
  const flush = jest.fn()
  const em = { flush } as unknown as Parameters<typeof reclaim>[0]
  const row = (over: Record<string, unknown>) =>
    ({ requestHash: HASH, failureReason: null, ...over }) as never

  beforeEach(() => jest.clearAllMocks())

  it('replays a completed request without touching it', async () => {
    const outcome = await reclaim(em, row({ status: 'completed', taskId: 't-1', linkId: 'l-1' }), HASH)
    expect(outcome).toEqual({ kind: 'replay', taskId: 't-1', linkId: 'l-1' })
    expect(flush).not.toHaveBeenCalled()
  })

  it('refuses a key whose first attempt is still running', async () => {
    const outcome = await reclaim(em, row({ status: 'pending' }), HASH)
    expect(outcome).toEqual({ kind: 'in_progress' })
  })

  it('refuses a key reused with different details, ahead of every other check', async () => {
    // Before the status check: answering "already done" for a request the caller
    // never made would hand back the wrong task.
    const outcome = await reclaim(em, row({ status: 'completed', taskId: 't-1' }), 'b'.repeat(64))
    expect(outcome).toEqual({ kind: 'hash_mismatch' })
  })

  /**
   * The window this closes: attempt 1 fails, attempt 2 is admitted and creates the
   * task, then dies before completing the ledger. If the row still said `failed`,
   * attempt 3 would be admitted too and would create a SECOND task under a key
   * whose entire purpose is that it cannot.
   */
  it('re-arms a failed row to pending, so a crashed retry cannot be retried again', async () => {
    const failed = row({ status: 'failed', failureReason: 'boom' })
    const outcome = await reclaim(em, failed, HASH)

    expect(outcome).toEqual({ kind: 'claimed' })
    expect((failed as unknown as { status: string }).status).toBe('pending')
    expect((failed as unknown as { failureReason: string | null }).failureReason).toBeNull()
    // Durably, before the caller goes on to create anything.
    expect(flush).toHaveBeenCalledTimes(1)

    // And the next attempt now meets `pending`, not `failed`.
    expect(await reclaim(em, failed, HASH)).toEqual({ kind: 'in_progress' })
  })
})
