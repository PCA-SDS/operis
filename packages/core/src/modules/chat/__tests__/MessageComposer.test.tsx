/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MessageComposer } from '../components/MessageComposer'
import { MAX_MESSAGE_LENGTH } from '../data/validators'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: unknown, params?: Record<string, unknown>) => {
    const text = typeof fallback === 'string' ? fallback : String(_key)
    if (!params) return text
    return Object.entries(params).reduce(
      (acc, [name, value]) => acc.replace(`{${name}}`, String(value)),
      text,
    )
  },
}))

function setup(overrides: Partial<React.ComponentProps<typeof MessageComposer>> = {}) {
  const onSend = overrides.onSend ?? jest.fn()
  render(<MessageComposer onSend={onSend} placeholder="Message Bob" {...overrides} />)
  return { onSend, textarea: screen.getByRole('textbox') }
}

describe('MessageComposer', () => {
  it('sends on Enter', () => {
    const { onSend, textarea } = setup()
    fireEvent.change(textarea, { target: { value: 'standup in five' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('standup in five')
  })

  it('does not send on Shift+Enter, so a multi-line message is possible', () => {
    const { onSend, textarea } = setup()
    fireEvent.change(textarea, { target: { value: 'line one' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('refuses to send a blank message', () => {
    const { onSend, textarea } = setup()
    fireEvent.change(textarea, { target: { value: '   ' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled()
  })

  it('trims the body before sending', () => {
    const { onSend, textarea } = setup()
    fireEvent.change(textarea, { target: { value: '  hello  ' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('hello')
  })

  it('clears the box as soon as the message is handed off', () => {
    const { textarea } = setup()
    fireEvent.change(textarea, { target: { value: 'sent' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect((textarea as HTMLTextAreaElement).value).toBe('')
  })

  /**
   * The draft is handed off, not held.
   *
   * The transcript renders it as a pending bubble and owns retry from there.
   * Keeping a copy here as well gave one message two retry paths, and only the
   * bubble's reused the idempotency key — so retrying from the composer could
   * deliver the same message twice.
   */
  it('hands the message off exactly once and clears', () => {
    const { onSend, textarea } = setup()
    fireEvent.change(textarea, { target: { value: 'important' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith('important')
    expect((textarea as HTMLTextAreaElement).value).toBe('')
  })

  /**
   * Enter confirms an IME candidate rather than sending. Without this, Korean,
   * Japanese and Chinese users send half-typed words — and the module ships a
   * `ko` locale.
   */
  it('does not send while an IME is composing', () => {
    const { onSend, textarea } = setup()
    fireEvent.change(textarea, { target: { value: '안녕' } })
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true })
    expect(onSend).not.toHaveBeenCalled()

    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('안녕')
  })

  it('flags an over-length message as an error rather than silent helper text', () => {
    const { textarea } = setup()
    fireEvent.change(textarea, { target: { value: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) } })
    expect(screen.getByRole('alert')).toHaveTextContent(/limited to/i)
  })

  it('blocks a body over the length limit and says why', () => {
    const { onSend, textarea } = setup()
    fireEvent.change(textarea, { target: { value: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByText(/limited to/i)).toBeInTheDocument()
    expect(textarea).toHaveAttribute('aria-invalid', 'true')
  })

  it('disables the box when there is nobody to message', () => {
    const { textarea } = setup({ disabled: true })
    expect(textarea).toBeDisabled()
  })

  /**
   * Rapid-fire sending is allowed on purpose. Each send gets its own pending
   * bubble and its own idempotency key, so blocking the composer until the
   * previous round trip finished would have made the optimistic bubble
   * pointless.
   */
  it('allows a second message before the first has landed', () => {
    const { onSend, textarea } = setup()
    fireEvent.change(textarea, { target: { value: 'first' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    fireEvent.change(textarea, { target: { value: 'second' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSend).toHaveBeenNthCalledWith(1, 'first')
    expect(onSend).toHaveBeenNthCalledWith(2, 'second')
  })
})
