import {
  TRANSLATION_MAX_CONCURRENCY,
  TRANSLATION_MAX_QUEUE,
  TranslationOverloadedError,
  coalesce,
  pipelineRevision,
  sourceHash,
  translationGateDepth,
  withTranslationSlot,
} from '../lib/translationGate'

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('withTranslationSlot', () => {
  /**
   * The engine is one CPU-bound container shared by the whole deployment, so
   * the scarce resource is inference slots. Without a ceiling the queue is the
   * engine's own accept backlog, where it is invisible and unattributable.
   */
  it('never runs more work at once than the ceiling allows', async () => {
    let live = 0
    let peak = 0
    await Promise.all(
      Array.from({ length: TRANSLATION_MAX_CONCURRENCY * 5 }, () =>
        withTranslationSlot(async () => {
          live += 1
          peak = Math.max(peak, live)
          await settle(20)
          live -= 1
        }),
      ),
    )

    expect(peak).toBeLessThanOrEqual(TRANSLATION_MAX_CONCURRENCY)
    expect(translationGateDepth()).toEqual({ active: 0, queued: 0 })
  })

  /**
   * Refusing is the point. A caller left waiting behind a saturated engine
   * holds a request, a connection and the reader's "Translating…" state for as
   * long as the backlog lasts.
   */
  it('refuses work past the queue depth instead of waiting forever', async () => {
    const overflow = 6
    let refused = 0
    await Promise.all(
      Array.from(
        { length: TRANSLATION_MAX_CONCURRENCY + TRANSLATION_MAX_QUEUE + overflow },
        () =>
          withTranslationSlot(() => settle(40)).catch((error) => {
            if (error instanceof TranslationOverloadedError) refused += 1
            else throw error
          }),
      ),
    )

    expect(refused).toBe(overflow)
    expect(translationGateDepth()).toEqual({ active: 0, queued: 0 })
  })

  it('releases its slot when the work throws', async () => {
    await expect(
      withTranslationSlot(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(translationGateDepth()).toEqual({ active: 0, queued: 0 })
  })
})

describe('coalesce', () => {
  /**
   * The unique index makes the second WRITE converge, but by then both callers
   * have already paid for the inference. This is what stops the engine doing
   * the same work twice.
   */
  it('runs identical in-flight work once and hands everyone the same result', async () => {
    let calls = 0
    const run = () =>
      coalesce('message:fr', async () => {
        calls += 1
        await settle(20)
        return 'bonjour'
      })

    const results = await Promise.all([run(), run(), run(), run()])

    expect(calls).toBe(1)
    expect(results).toEqual(['bonjour', 'bonjour', 'bonjour', 'bonjour'])
  })

  it('does not conflate different keys', async () => {
    let calls = 0
    const run = (key: string) =>
      coalesce(key, async () => {
        calls += 1
        return key
      })

    await Promise.all([run('a'), run('b')])
    expect(calls).toBe(2)
  })

  it('lets the next caller start fresh once the work has settled', async () => {
    let calls = 0
    const run = () => coalesce('k', async () => { calls += 1; return calls })

    await run()
    await run()
    expect(calls).toBe(2)
  })

  it('does not leave a rejected promise cached for the next caller', async () => {
    let calls = 0
    const run = () =>
      coalesce('k-fail', async () => {
        calls += 1
        throw new Error('engine down')
      })

    await expect(run()).rejects.toThrow('engine down')
    await expect(run()).rejects.toThrow('engine down')
    expect(calls).toBe(2)
  })
})

describe('cache identity', () => {
  it('is stable across normalisation forms of the same text', () => {
    // Vietnamese stacks diacritics, so the same visible string has two byte
    // forms; a hash that disagreed would miss every lookup.
    expect(sourceHash('Việt'.normalize('NFC'))).toBe(sourceHash('Việt'.normalize('NFD').normalize('NFC')))
  })

  it('changes when the source text changes', () => {
    expect(sourceHash('hello')).not.toBe(sourceHash('hello!'))
  })

  it('stores no recoverable message text', () => {
    const hash = sourceHash('a private message about the merger')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain('merger')
  })

  /** A row made by another model is not an answer to the current question. */
  it('separates one model vintage from another', () => {
    expect(pipelineRevision('ct2', 'v1')).not.toBe(pipelineRevision('ct2', 'v2'))
    expect(pipelineRevision('ct2', 'v1')).not.toBe(pipelineRevision('fake', 'v1'))
    expect(pipelineRevision('ct2', null)).toBe(pipelineRevision('ct2', null))
  })
})
