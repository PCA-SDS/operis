/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CommentsThread } from '../components/CommentsThread'

/**
 * The comment composer is a chat box: Enter posts, Shift+Enter is a newline.
 *
 * The editor underneath only reports its value on blur, and Enter does not blur
 * it — so the composer has to read the live content at submit. These tests pin
 * that, because the failure mode is silently posting the previous keystroke.
 */

const flash = jest.fn()
const createComment = jest.fn()
const updateComment = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string, params?: Record<string, unknown>) =>
    (fallback ?? key).replace(/\{(\w+)\}/g, (_m, name: string) => String(params?.[name] ?? '')),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flash(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/useCurrentUserId', () => ({
  useCurrentUserId: () => 'user-1',
}))

const thread = {
  comments: [] as unknown[],
  total: 0,
  isLoading: false,
  error: null as unknown,
  retry: jest.fn(),
}

jest.mock('../components/hooks', () => ({
  useTaskComments: () => thread,
  useTaskError: (error: unknown, fallback: string) => (error ? fallback : null),
  useCommentMutations: () => ({
    create: { mutateAsync: (...args: unknown[]) => createComment(...args), isPending: false },
    update: { mutateAsync: (...args: unknown[]) => updateComment(...args), isPending: false },
    remove: { mutateAsync: jest.fn(), isPending: false },
  }),
}))

/**
 * A stand-in for the design-system editor with the property that matters here:
 * it reports through `onChange` only on blur, so the React draft lags the DOM
 * exactly as the real one does.
 */
jest.mock('@open-mercato/ui/primitives/rich-editor', () => ({
  RichEditor: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string
    onChange: (html: string) => void
    placeholder?: string
  }) => (
    <div
      role="textbox"
      aria-label={placeholder ?? 'editor'}
      data-slot="rich-editor-content"
      contentEditable
      suppressContentEditableWarning
      onBlur={(event) => onChange((event.target as HTMLElement).innerHTML)}
    >
      {value}
    </div>
  ),
}))

function editor(): HTMLElement {
  return screen.getByRole('textbox', { name: /leave a comment/i })
}

/** Type into the contenteditable without blurring it, as a person would. */
function typeWithoutBlurring(text: string): void {
  editor().innerHTML = text
}

beforeEach(() => {
  jest.clearAllMocks()
  thread.comments = []
  thread.total = 0
  thread.isLoading = false
  thread.error = null
  createComment.mockResolvedValue({ id: 'comment-1' })
})

describe('posting a comment', () => {
  it('posts on Enter', async () => {
    render(<CommentsThread taskId="task-1" />)
    typeWithoutBlurring('Looks good to me')
    fireEvent.keyDown(editor(), { key: 'Enter' })

    await waitFor(() => expect(createComment).toHaveBeenCalledTimes(1))
    expect(createComment.mock.calls[0]![0]).toMatchObject({ plaintext: 'Looks good to me' })
  })

  it('posts what is on screen, not the last value the editor reported', () => {
    render(<CommentsThread taskId="task-1" />)
    // Blur commits an early draft, then the person keeps typing.
    editor().innerHTML = 'Half a thought'
    fireEvent.blur(editor())
    typeWithoutBlurring('A whole thought')
    fireEvent.keyDown(editor(), { key: 'Enter' })

    expect(createComment.mock.calls[0]![0]).toMatchObject({ plaintext: 'A whole thought' })
  })

  it('leaves Shift+Enter alone so a comment can have paragraphs', () => {
    render(<CommentsThread taskId="task-1" />)
    typeWithoutBlurring('First line')
    fireEvent.keyDown(editor(), { key: 'Enter', shiftKey: true })

    expect(createComment).not.toHaveBeenCalled()
  })

  it('ignores Enter on an empty box', () => {
    render(<CommentsThread taskId="task-1" />)
    fireEvent.keyDown(editor(), { key: 'Enter' })
    expect(createComment).not.toHaveBeenCalled()
  })

  it('ignores a box holding only whitespace', () => {
    render(<CommentsThread taskId="task-1" />)
    typeWithoutBlurring('   ')
    fireEvent.keyDown(editor(), { key: 'Enter' })
    expect(createComment).not.toHaveBeenCalled()
  })

  it('posts from the button as well', async () => {
    render(<CommentsThread taskId="task-1" />)
    editor().innerHTML = 'Via the button'
    fireEvent.blur(editor())

    fireEvent.click(screen.getByRole('button', { name: /^comment$/i }))
    await waitFor(() => expect(createComment).toHaveBeenCalledTimes(1))
  })

  it('says so when the post fails instead of clearing the box', async () => {
    createComment.mockRejectedValue(new Error('nope'))
    render(<CommentsThread taskId="task-1" />)
    typeWithoutBlurring('Will not send')
    fireEvent.keyDown(editor(), { key: 'Enter' })

    await waitFor(() => expect(flash).toHaveBeenCalledWith('Could not post the comment.', 'error'))
  })
})

describe('the thread', () => {
  it('invites the first note when there are none', () => {
    render(<CommentsThread taskId="task-1" />)
    expect(screen.getByText('No comments yet')).toBeInTheDocument()
  })

  it('shows a retryable error rather than an empty thread', () => {
    thread.error = new Error('boom')
    render(<CommentsThread taskId="task-1" />)
    expect(screen.queryByText('No comments yet')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('counts the comments in its heading', () => {
    thread.total = 3
    thread.comments = [
      {
        id: 'comment-1',
        body: '<p>Hello</p>',
        plaintext: 'Hello',
        authorId: 'user-1',
        authorName: 'Amir Haddad',
        createdAt: '2026-08-24T10:00:00.000Z',
        updatedAt: '2026-08-24T10:00:00.000Z',
        editedAt: null,
      },
    ]
    render(<CommentsThread taskId="task-1" />)
    expect(screen.getByText('Comments (3)')).toBeInTheDocument()
  })
})
