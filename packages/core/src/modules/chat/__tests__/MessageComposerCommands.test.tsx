/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MessageComposer, type ComposerCommand } from '../components/MessageComposer'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT:
    () =>
    (key: string, fallback?: string, params?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? '')),
  useLocale: () => 'en',
}))

function commands(onSelect: jest.Mock): ComposerCommand[] {
  return [
    { id: 'chat_tasks.command.task', name: 'task', label: 'Create task', onSelect },
    { id: 'chat_tasks.command.tasks', name: 'tasks', label: 'Tasks here', onSelect },
    { id: 'chat_tasks.command.mytasks', name: 'mytasks', label: 'My tasks', onSelect },
  ]
}

function setup(overrides: Partial<React.ComponentProps<typeof MessageComposer>> = {}) {
  const onSend = jest.fn()
  const onSelect = jest.fn()
  const result = render(
    <MessageComposer
      onSend={onSend}
      placeholder="Message Amir"
      commands={commands(onSelect)}
      {...overrides}
    />,
  )
  const field = screen.getByLabelText('Message') as HTMLTextAreaElement
  return { ...result, field, onSend, onSelect }
}

/** Typing goes through `change` plus a `keyUp`, which is what syncs the caret. */
function type(field: HTMLTextAreaElement, value: string) {
  fireEvent.change(field, { target: { value } })
  field.selectionStart = value.length
  field.selectionEnd = value.length
  fireEvent.keyUp(field, { key: 'a' })
}

describe('the command menu', () => {
  it('opens on a leading slash and lists every command', () => {
    const { field } = setup()
    type(field, '/')
    const menu = screen.getByRole('listbox', { name: 'Commands' })
    expect(menu).toBeTruthy()
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('narrows to the commands whose name starts with what was typed', () => {
    const { field } = setup()
    type(field, '/task')
    const options = screen.getAllByRole('option').map((option) => option.textContent)
    // `task` and `tasks`, not `mytasks` — a prefix match, so the menu narrows as the
    // writer commits to a name rather than matching anywhere in it.
    expect(options?.length).toBe(2)
    expect(options?.join(' ')).toContain('Create task')
    expect(options?.join(' ')).toContain('Tasks here')
  })

  it('closes once a space is typed, because the line is being written from then on', () => {
    const { field } = setup()
    type(field, '/task ')
    expect(screen.queryByRole('listbox', { name: 'Commands' })).toBeNull()
  })

  it('never opens for a slash that is not the first character', () => {
    const { field } = setup()
    type(field, 'see /docs')
    expect(screen.queryByRole('listbox', { name: 'Commands' })).toBeNull()
  })

  it('does not open at all when no module contributed a command', () => {
    const { field } = setup({ commands: [] })
    type(field, '/')
    expect(screen.queryByRole('listbox', { name: 'Commands' })).toBeNull()
  })

  it('announces the highlighted option from the textarea, which keeps focus', () => {
    const { field } = setup()
    type(field, '/')
    expect(field.getAttribute('aria-activedescendant')).toBe('chat-command-suggestions-option-0')
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(field.getAttribute('aria-activedescendant')).toBe('chat-command-suggestions-option-1')
    // Wraps, so the list is navigable without knowing its length.
    fireEvent.keyDown(field, { key: 'ArrowUp' })
    fireEvent.keyDown(field, { key: 'ArrowUp' })
    expect(field.getAttribute('aria-activedescendant')).toBe('chat-command-suggestions-option-2')
  })

  it('Escape closes the menu and leaves the draft alone', () => {
    const { field } = setup()
    type(field, '/task')
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.queryByRole('listbox', { name: 'Commands' })).toBeNull()
    expect(field.value).toBe('/task')
  })

  it('Enter runs the highlighted command instead of sending the line', () => {
    const { field, onSend, onSelect } = setup()
    type(field, '/task')
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('a click on a row runs it, which is what makes the menu usable by touch', () => {
    const { field, onSelect } = setup()
    type(field, '/')
    fireEvent.click(screen.getByRole('option', { name: /Create task/ }))
    expect(onSelect).toHaveBeenCalled()
  })

  /**
   * The module ships `ko`, `vi` and `zh`. While an IME is composing, Enter confirms a
   * candidate word — treating it as a selection ships a guaranteed bug for those
   * readers.
   */
  it('ignores Enter while an IME is composing', () => {
    const { field, onSelect, onSend } = setup()
    type(field, '/task')
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true })
    expect(onSelect).not.toHaveBeenCalled()
    expect(onSend).not.toHaveBeenCalled()
  })
})

describe('running a command from a typed line', () => {
  it('runs the command and passes everything after it through untouched', () => {
    const { field, onSend, onSelect } = setup()
    // A space closes the menu, so this is the "typed the whole thing" path rather than
    // the "picked from the list" one.
    type(field, '/task Prepare the proposal by tomorrow 3pm')
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('Prepare the proposal by tomorrow 3pm')
    // The command text is never delivered as a chat message.
    expect(onSend).not.toHaveBeenCalled()
  })

  it('keeps the draft until the caller says the command consumed it', () => {
    // A drawer can be cancelled and a create can fail; neither may cost somebody the
    // sentence they typed.
    const { field, rerender } = setup()
    const onSelect = jest.fn()
    type(field, '/task Ship it')
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(field.value).toBe('/task Ship it')

    rerender(
      <MessageComposer
        onSend={jest.fn()}
        placeholder="Message Amir"
        commands={commands(onSelect)}
        commandConsumedToken={1}
      />,
    )
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('')
  })
})

describe('ordinary messages that happen to start with a slash', () => {
  it.each([
    '/etc/passwd is unreadable',
    '/docs/setup needs an update',
    'https://example.com/task is the link',
  ])('sends %p as a message', (line) => {
    const { field, onSend, onSelect } = setup()
    type(field, line)
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith(line)
    expect(onSelect).not.toHaveBeenCalled()
  })

  /**
   * A bare `/word` that names no command reads as an attempted command. It must not be
   * sent, must not run anything, and must not lose what was typed — so the composer
   * says so and keeps the line.
   */
  it('refuses a bare unknown command without sending or discarding it', () => {
    const { field, onSend, onSelect } = setup()
    type(field, '/nope')
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
    expect(field.value).toBe('/nope')
    expect(screen.getByRole('alert').textContent).toContain('no /nope command')
  })

  it('clears that notice as soon as the writer types again', () => {
    const { field } = setup()
    type(field, '/nope')
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(screen.getByRole('alert').textContent).toContain('no /nope command')
    type(field, '/nope ')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('still sends a sentence that merely begins with a path', () => {
    // `/nope` is refused because it is a bare token; `/nope/deeper is broken` is prose.
    const { field, onSend } = setup()
    type(field, '/nope/deeper is broken')
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('/nope/deeper is broken')
  })
})
