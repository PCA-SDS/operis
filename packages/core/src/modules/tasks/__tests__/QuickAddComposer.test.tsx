/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QuickAddComposer } from '../components/QuickAddComposer'

/**
 * Quick Add is a keyboard surface first: Enter submits, Escape closes, and the
 * mention menu takes both keys before the composer does. These tests pin that
 * ordering and the submit payload, because getting either wrong loses whatever
 * the person had typed.
 */

const flash = jest.fn()
const parseQuickAdd = jest.fn()
const createTask = jest.fn()
const push = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn() }),
  usePathname: () => '/backend/tasks/today',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string, params?: Record<string, unknown>) =>
    (fallback ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? '')),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flash(...args),
}))

jest.mock('../components/api', () => ({
  tasksApi: { parseQuickAdd: (...args: unknown[]) => parseQuickAdd(...args) },
}))

jest.mock('../components/hooks', () => ({
  useInboxProject: () => ({ inbox: { id: 'inbox-1', key: 'INBOX', name: 'Inbox' } }),
  useProjects: () => ({ projects: [{ id: 'project-1', key: 'ENG', name: 'Engineering', icon: null }] }),
  useAssignableUsers: () => ({
    users: [
      { id: 'user-1', name: 'Amir Haddad', email: 'amir@example.com' },
      { id: 'user-2', name: 'Bea Lindqvist', email: 'bea@example.com' },
    ],
  }),
  useLabels: () => ({ labels: [{ id: 'label-1', name: 'urgent', color: '#f00' }] }),
  useLabelMutations: () => ({ create: { mutateAsync: jest.fn() } }),
  useTaskMutations: () => ({ create: { mutateAsync: (...args: unknown[]) => createTask(...args) } }),
}))

// The rich-text editor brings TipTap, which needs a real layout engine; the
// composer only reads `{ html, text }` back out of it.
jest.mock('../components/RichText', () => ({
  RichTextEditor: ({ onChange }: { onChange: (value: { html: string; text: string }) => void }) => (
    <textarea
      aria-label="Description"
      onChange={(event) => onChange({ html: event.target.value, text: event.target.value })}
    />
  ),
}))

function emptyParse(text: string) {
  return {
    originalText: text,
    title: text,
    project: null,
    assignee: null,
    labels: [],
    dueDate: null,
    dueTime: null,
    recurrence: null,
    priority: null,
    warnings: [],
    recognizedTokens: [],
  }
}

function composer(): HTMLTextAreaElement {
  return screen.getByRole('textbox', { name: /task name/i }) as HTMLTextAreaElement
}

function type(value: string): void {
  fireEvent.change(composer(), { target: { value } })
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  parseQuickAdd.mockImplementation((body: { text: string }) => Promise.resolve(emptyParse(body.text)))
  createTask.mockResolvedValue({ id: 'task-1', projectId: 'inbox-1', recurrence: null })
})

afterEach(() => {
  act(() => {
    jest.runOnlyPendingTimers()
  })
  jest.useRealTimers()
})

describe('submitting', () => {
  it('creates the task on Enter', async () => {
    render(<QuickAddComposer />)
    type('Ship the release')
    fireEvent.keyDown(composer(), { key: 'Enter' })

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1))
    const payload = createTask.mock.calls[0]![0] as { projectId: string; body: Record<string, unknown> }
    expect(payload.projectId).toBe('inbox-1')
    expect(payload.body.title).toBe('Ship the release')
    // Quick Add creates work meant to be started, not filed away.
    expect(payload.body.status).toBe('pending')
  })

  it('re-parses on the server at submit rather than trusting the debounced preview', async () => {
    render(<QuickAddComposer />)
    type('Ship the release')
    fireEvent.keyDown(composer(), { key: 'Enter' })

    await waitFor(() => expect(createTask).toHaveBeenCalled())
    expect(parseQuickAdd).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Ship the release' }),
    )
  })

  it('ignores Enter on an empty line', () => {
    render(<QuickAddComposer />)
    fireEvent.keyDown(composer(), { key: 'Enter' })
    expect(createTask).not.toHaveBeenCalled()
  })

  it('ignores a line of only whitespace', () => {
    render(<QuickAddComposer />)
    type('    ')
    fireEvent.keyDown(composer(), { key: 'Enter' })
    expect(createTask).not.toHaveBeenCalled()
  })

  it('clears the line after a successful create so the next task can be typed', async () => {
    render(<QuickAddComposer />)
    type('Ship the release')
    fireEvent.keyDown(composer(), { key: 'Enter' })

    await waitFor(() => expect(composer().value).toBe(''))
  })

  it('keeps the line when the create fails, so nothing typed is lost', async () => {
    createTask.mockRejectedValue(new Error('Server said no.'))
    render(<QuickAddComposer />)
    type('Ship the release')
    fireEvent.keyDown(composer(), { key: 'Enter' })

    await waitFor(() => expect(flash).toHaveBeenCalledWith('Server said no.', 'error'))
    expect(composer().value).toBe('Ship the release')
  })

  it('reports a create that never reached the server', async () => {
    createTask.mockRejectedValue({})
    render(<QuickAddComposer />)
    type('Ship the release')
    fireEvent.keyDown(composer(), { key: 'Enter' })

    await waitFor(() => expect(flash).toHaveBeenCalledWith('Could not add the task.', 'error'))
  })
})

describe('closing', () => {
  it('closes on Escape', () => {
    const onClose = jest.fn()
    render(<QuickAddComposer onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('lets the mention menu take Escape first', () => {
    const onClose = jest.fn()
    render(<QuickAddComposer onClose={onClose} />)
    type('Ship @Amir')
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    // One keypress, which bubbles from the textarea to the window listener.
    // The menu consumes it; the composer must not also act on it, or a person
    // dismissing an autocomplete would lose everything they had typed.
    fireEvent.keyDown(composer(), { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(composer().value).toBe('Ship @Amir')
  })

  it('closes on the next Escape once the menu is gone', () => {
    const onClose = jest.fn()
    render(<QuickAddComposer onClose={onClose} />)
    type('Ship @Amir')
    fireEvent.keyDown(composer(), { key: 'Escape' })
    fireEvent.keyDown(composer(), { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('the mention menu', () => {
  it('offers the people matching what was typed', () => {
    render(<QuickAddComposer />)
    type('Ship @Amir')
    expect(screen.getByText('Amir Haddad')).toBeInTheDocument()
    expect(screen.queryByText('Bea Lindqvist')).not.toBeInTheDocument()
  })

  it('takes Enter to accept the highlighted person instead of submitting', () => {
    render(<QuickAddComposer />)
    type('Ship @Amir')
    fireEvent.keyDown(composer(), { key: 'Enter' })

    expect(createTask).not.toHaveBeenCalled()
    // The half-typed handle is replaced by the resolved name, quoted because it
    // has a space in it — an unquoted token would re-parse as one word.
    expect(composer().value).toBe('Ship @"Amir Haddad" ')
  })

  it('accepts the highlighted person on Tab as well', () => {
    render(<QuickAddComposer />)
    type('Ship @Amir')
    fireEvent.keyDown(composer(), { key: 'Tab' })
    expect(composer().value).toBe('Ship @"Amir Haddad" ')
  })

  it('moves the highlight with the arrow keys', () => {
    render(<QuickAddComposer />)
    type('Ship @')
    fireEvent.keyDown(composer(), { key: 'ArrowDown' })
    fireEvent.keyDown(composer(), { key: 'Enter' })

    expect(composer().value).toBe('Ship @"Bea Lindqvist" ')
  })

  it('wraps the highlight around the ends of the list', () => {
    render(<QuickAddComposer />)
    type('Ship @')
    fireEvent.keyDown(composer(), { key: 'ArrowUp' })
    fireEvent.keyDown(composer(), { key: 'Enter' })

    expect(composer().value).toBe('Ship @"Bea Lindqvist" ')
  })

  it('offers to create a label that does not exist yet', () => {
    render(<QuickAddComposer />)
    type('Ship +release')
    expect(screen.getByRole('option', { name: /release/i })).toBeInTheDocument()
  })

  it('does not offer to create a label that already exists', () => {
    render(<QuickAddComposer />)
    type('Ship +urgent')
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('urgent')
  })
})
