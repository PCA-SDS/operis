/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { useConfirmDialog } from '../useConfirmDialog'
import type { ConfirmDialogOptions } from '../useConfirmDialog'

function installDialogPolyfill() {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute('open', '') },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) { this.removeAttribute('open') },
  })
}

type ConfirmFn = (options?: ConfirmDialogOptions) => Promise<boolean>
type HookHandle = { current: { confirm: ConfirmFn } | null }

function HookProbe({ handle }: { handle: HookHandle }) {
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  React.useEffect(() => {
    handle.current = { confirm }
    return () => { handle.current = null }
  }, [confirm, handle])
  return <>{ConfirmDialogElement}</>
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function flushMicrotasks() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

function confirmButton() {
  return screen.getByRole('button', { name: /confirm|delete|ok|yes/i })
}

// The jsdom polyfill only toggles the `open` attribute, so the dialog markup
// stays mounted after close — assert on `open`, not on text presence.
function dialogIsOpen() {
  return document.querySelector('dialog')?.hasAttribute('open') ?? false
}

describe('useConfirmDialog — onConfirm keeps the dialog in its loading state', () => {
  beforeEach(() => { installDialogPolyfill() })

  it('holds the dialog open and disables both buttons while the work runs', async () => {
    const handle: HookHandle = { current: null }
    renderWithProviders(<HookProbe handle={handle} />, { dict: {} })
    const gate = deferred<void>()

    let settled: Promise<boolean>
    await act(async () => {
      settled = handle.current!.confirm({ title: 'Delete?', onConfirm: () => gate.promise })
    })
    await flushMicrotasks()

    await act(async () => { confirmButton().click() })
    await flushMicrotasks()

    // Still open, and both actions locked out — a second confirm is impossible.
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(0)
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true)

    await act(async () => { gate.resolve(); await settled })
    await waitFor(() => { expect(dialogIsOpen()).toBe(false) })
    await expect(settled!).resolves.toBe(true)
  })

  it('rejects confirm() when the work throws, and still closes the dialog', async () => {
    const handle: HookHandle = { current: null }
    renderWithProviders(<HookProbe handle={handle} />, { dict: {} })
    const boom = new Error('delete failed')

    let settled: Promise<boolean>
    await act(async () => {
      settled = handle.current!.confirm({
        title: 'Delete?',
        onConfirm: async () => { throw boom },
      })
      settled.catch(() => undefined)
    })
    await flushMicrotasks()

    await act(async () => { confirmButton().click() })
    await flushMicrotasks()

    await expect(settled!).rejects.toBe(boom)
    await waitFor(() => { expect(dialogIsOpen()).toBe(false) })
  })

  it('leaves the legacy path (no onConfirm) resolving immediately', async () => {
    const handle: HookHandle = { current: null }
    renderWithProviders(<HookProbe handle={handle} />, { dict: {} })

    let settled: Promise<boolean>
    await act(async () => { settled = handle.current!.confirm({ title: 'Delete?' }) })
    await flushMicrotasks()

    await act(async () => { confirmButton().click() })
    await flushMicrotasks()

    await expect(settled!).resolves.toBe(true)
    await waitFor(() => { expect(dialogIsOpen()).toBe(false) })
  })

  it('still resolves false on cancel when onConfirm was supplied', async () => {
    const handle: HookHandle = { current: null }
    const work = jest.fn()
    renderWithProviders(<HookProbe handle={handle} />, { dict: {} })

    let settled: Promise<boolean>
    await act(async () => {
      settled = handle.current!.confirm({ title: 'Delete?', onConfirm: work })
    })
    await flushMicrotasks()

    await act(async () => {
      screen.getByRole('button', { name: /cancel|no/i }).click()
    })
    await flushMicrotasks()

    await expect(settled!).resolves.toBe(false)
    expect(work).not.toHaveBeenCalled()
  })
})
