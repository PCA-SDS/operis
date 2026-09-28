import { isAbortError, sleep, withTimeout } from '../async'

describe('async helpers', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('resolves sleep after the delay', async () => {
    jest.useFakeTimers()
    const settled = jest.fn()
    const pending = sleep(50).then(settled)
    jest.advanceTimersByTime(49)
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    await pending
    expect(settled).toHaveBeenCalled()
  })

  it('returns the operation result and clears its timer', async () => {
    const clearSpy = jest.spyOn(global, 'clearTimeout')
    await expect(withTimeout(Promise.resolve('done'), 1000, 'too slow')).resolves.toBe('done')
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })

  it('rejects with the timeout message when the operation is slower', async () => {
    jest.useFakeTimers()
    const never = new Promise<string>(() => {})
    const raced = withTimeout(never, 100, 'too slow')
    jest.advanceTimersByTime(100)
    await expect(raced).rejects.toThrow('too slow')
  })

  it('recognises abort errors from both browsers and Node', () => {
    const named = new Error('aborted')
    named.name = 'AbortError'
    expect(isAbortError(named)).toBe(true)
    expect(isAbortError(new Error('signal is aborted without reason'))).toBe(true)
    expect(isAbortError(new Error('network down'))).toBe(false)
    expect(isAbortError('AbortError')).toBe(false)
  })
})
