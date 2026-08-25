/** @jest-environment jsdom */

const triggerEventMock = jest.fn()

jest.mock('../InjectionSpot', () => ({
  useInjectionSpotEvents: () => ({
    triggerEvent: (...args: unknown[]) => triggerEventMock(...args),
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

import { act, renderHook, waitFor } from '@testing-library/react'
import { useGuardedMutation } from '../useGuardedMutation'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('useGuardedMutation — isPending', () => {
  beforeEach(() => {
    triggerEventMock.mockReset()
    triggerEventMock.mockImplementation(async () => ({ ok: true, requestHeaders: undefined }))
  })

  it('is false before anything runs', () => {
    const { result } = renderHook(() => useGuardedMutation({ contextId: 'form' }))
    expect(result.current.isPending).toBe(false)
  })

  it('reports pending while the operation is in flight and clears on success', async () => {
    const gate = deferred<string>()
    const { result } = renderHook(() => useGuardedMutation({ contextId: 'form' }))

    let settled: Promise<string>
    await act(async () => {
      settled = result.current.runMutation({ operation: () => gate.promise, context: {} })
    })
    await waitFor(() => { expect(result.current.isPending).toBe(true) })

    await act(async () => {
      gate.resolve('done')
      await settled
    })
    expect(result.current.isPending).toBe(false)
  })

  it('clears on failure so a failed write does not wedge the button disabled', async () => {
    const gate = deferred<string>()
    const { result } = renderHook(() => useGuardedMutation({ contextId: 'form' }))

    let settled: Promise<string>
    await act(async () => {
      settled = result.current.runMutation({ operation: () => gate.promise, context: {} })
    })
    await waitFor(() => { expect(result.current.isPending).toBe(true) })

    await act(async () => {
      gate.reject(new Error('boom'))
      await settled.catch(() => undefined)
    })
    expect(result.current.isPending).toBe(false)
  })

  it('clears when a widget blocks the write in onBeforeSave', async () => {
    triggerEventMock.mockImplementation(async () => ({ ok: false, message: 'blocked' }))
    const { result } = renderHook(() => useGuardedMutation({ contextId: 'form' }))

    await act(async () => {
      await result.current
        .runMutation({ operation: async () => 'never', context: {} })
        .catch(() => undefined)
    })
    expect(result.current.isPending).toBe(false)
  })

  it('stays pending until the last of several concurrent mutations settles', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const { result } = renderHook(() => useGuardedMutation({ contextId: 'form' }))

    let a: Promise<string>
    let b: Promise<string>
    await act(async () => {
      a = result.current.runMutation({ operation: () => first.promise, context: {} })
      b = result.current.runMutation({ operation: () => second.promise, context: {} })
    })
    await waitFor(() => { expect(result.current.isPending).toBe(true) })

    await act(async () => { first.resolve('one'); await a })
    // A plain boolean would have cleared here while `b` is still running.
    expect(result.current.isPending).toBe(true)

    await act(async () => { second.resolve('two'); await b })
    expect(result.current.isPending).toBe(false)
  })

  it('does not set state after unmount', async () => {
    const gate = deferred<string>()
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { result, unmount } = renderHook(() => useGuardedMutation({ contextId: 'form' }))

    let settled: Promise<string>
    await act(async () => {
      settled = result.current.runMutation({ operation: () => gate.promise, context: {} })
    })
    unmount()
    await act(async () => { gate.resolve('done'); await settled })

    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('unmounted'),
      expect.anything(),
      expect.anything(),
    )
    errorSpy.mockRestore()
  })
})
