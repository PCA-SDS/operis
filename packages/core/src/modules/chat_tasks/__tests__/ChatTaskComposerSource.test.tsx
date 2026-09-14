/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChatTaskComposer } from '../components/ChatTaskComposer'

const create = { mutateAsync: jest.fn(), isPending: false }
const parseQuickAdd = jest.fn()
let composerContext: Record<string, unknown> | null = null

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT:
    () =>
    (key: string, fallback?: string, params?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? '')),
  useLocale: () => 'en',
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/core/modules/tasks/components/api', () => ({
  tasksApi: { parseQuickAdd: (...args: unknown[]) => parseQuickAdd(...args) },
}))
jest.mock('@open-mercato/core/modules/tasks/components/quickAddWarnings', () => ({
  useQuickAddWarning: () => (warning: { code: string }) => warning.code,
}))
jest.mock('../components/hooks', () => ({
  useChatTaskComposerContext: () => ({ context: composerContext, isLoading: false, error: null }),
  useChatTaskMutations: () => ({ create }),
}))

const CONVERSATION = '33333333-3333-4333-8333-333333333333'
const AMIR = '66666666-6666-4666-8666-666666666666'
const SECRET = 'Margin is only 4% — do not tell the client'

const DIRECT_CONTEXT = {
  conversationId: CONVERSATION,
  kind: 'direct',
  defaultAssignee: { id: AMIR, name: 'Amir Haddad' },
  defaultAssigneeBlockedReason: null,
  requiresExplicitAssignee: false,
  suggestedAssignees: [{ id: AMIR, name: 'Amir Haddad' }],
  inboxProjectId: '77777777-7777-4777-8777-777777777777',
  canCreate: true,
  canAssign: true,
}

const SOURCE = { messageId: '11111111-1111-4111-8111-111111111111', authorName: 'Amir Haddad', body: SECRET }

function renderComposer(props: Partial<React.ComponentProps<typeof ChatTaskComposer>> = {}) {
  return render(
    <ChatTaskComposer
      conversationId={CONVERSATION}
      onClose={jest.fn()}
      onCreated={jest.fn()}
      {...props}
    />,
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  composerContext = DIRECT_CONTEXT
  parseQuickAdd.mockResolvedValue({
    originalText: '',
    title: '',
    project: null,
    assignee: null,
    labels: [],
    dueDate: null,
    dueTime: null,
    recurrence: null,
    priority: 'none',
    recognizedTokens: [],
    warnings: [],
  })
  create.mutateAsync.mockResolvedValue({
    taskId: 'task-1',
    linkId: 'link-1',
    cardPublished: true,
    cardMessageId: 'message-1',
    replayed: false,
    task: {},
  })
})

/**
 * The privacy contract of raising a task from a message, asserted where it is decided.
 *
 * TC-CHATTASKS-003 proves end to end that nothing from the message reaches the stored
 * task. These assert the half a person actually sees: that the fields start empty, that
 * copying is an explicit act, and that what will be shared is shown for review first.
 */
describe('raising a task from a message', () => {
  it('says the task is not private before anything is typed', () => {
    // On screen from the first frame. Somebody about to write confidential detail has to
    // be told the record is readable by everyone with task access.
    renderComposer({ source: SOURCE })
    expect(screen.getByText(/not private to this conversation/i)).toBeTruthy()
  })

  it('copies nothing from the message by default', () => {
    const { container } = renderComposer({ source: SOURCE })

    expect((screen.getByLabelText('Task') as HTMLTextAreaElement).value).toBe('')
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('')
    // Not the text, and not the author's name either — a task titled "Amir said…" would
    // leak who was talking as surely as the words would.
    expect(container.textContent).not.toContain(SECRET)
    expect(screen.getByText(/linked, not copied/i)).toBeTruthy()
  })

  it('reveals exactly what would be shared, before submission, only when asked', () => {
    renderComposer({ source: SOURCE })
    expect(screen.queryByText(SECRET)).toBeNull()

    fireEvent.click(screen.getByText(/copy the message text into the description/i))
    expect(screen.getByText(SECRET)).toBeTruthy()
    // And the consequence is stated beside the control, not somewhere else.
    expect(screen.getByText(/readable by anyone with task access/i)).toBeTruthy()
  })

  it('sends the message id but not the message text when nothing was copied', async () => {
    renderComposer({ source: SOURCE })
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Check the margin' } })
    parseQuickAdd.mockResolvedValue({
      originalText: 'Check the margin',
      title: 'Check the margin',
      project: null,
      assignee: null,
      labels: [],
      dueDate: null,
      dueTime: null,
      recurrence: null,
      priority: 'none',
      recognizedTokens: [],
      warnings: [],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() => expect(create.mutateAsync).toHaveBeenCalled())
    const [{ body }] = create.mutateAsync.mock.calls[0] as [{ body: Record<string, unknown> }]
    expect(body.title).toBe('Check the margin')
    // The reference travels; the words do not.
    expect(body.sourceMessageId).toBe(SOURCE.messageId)
    expect(body.description).toBeNull()
    expect(body.descriptionPlaintext).toBeNull()
  })

  it('sends the text only after the explicit opt-in', async () => {
    renderComposer({ source: SOURCE })
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Check the margin' } })
    fireEvent.click(screen.getByText(/copy the message text into the description/i))
    parseQuickAdd.mockResolvedValue({
      originalText: 'Check the margin',
      title: 'Check the margin',
      project: null,
      assignee: null,
      labels: [],
      dueDate: null,
      dueTime: null,
      recurrence: null,
      priority: 'none',
      recognizedTokens: [],
      warnings: [],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() => expect(create.mutateAsync).toHaveBeenCalled())
    const [{ body }] = create.mutateAsync.mock.calls[0] as [{ body: Record<string, unknown> }]
    expect(String(body.descriptionPlaintext)).toContain('Margin is only 4%')
  })

  it('shows no source block at all when the task was not raised from a message', () => {
    renderComposer()
    expect(screen.queryByText(/raised from a message/i)).toBeNull()
    expect(screen.queryByText(/copy the message text/i)).toBeNull()
  })
})

describe('the assignee a conversation implies', () => {
  it('shows the direct counterpart as the default', () => {
    renderComposer()
    expect(screen.getByText('Amir Haddad')).toBeTruthy()
  })

  it('blocks submission in a space until somebody is chosen', () => {
    composerContext = {
      ...DIRECT_CONTEXT,
      kind: 'space',
      defaultAssignee: null,
      requiresExplicitAssignee: true,
    }
    renderComposer()
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Nobody owns this' } })
    // Not a silent no-op: the field says what is missing, and the button is out of reach
    // until it is supplied.
    expect(screen.getByText('Choose someone')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Create task' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('explains a counterpart who cannot be assigned, rather than failing silently', () => {
    composerContext = {
      ...DIRECT_CONTEXT,
      defaultAssignee: null,
      defaultAssigneeBlockedReason: 'inactive',
      requiresExplicitAssignee: true,
    }
    renderComposer()
    expect(screen.getByText(/no longer active here/i)).toBeTruthy()
  })

  it('says so when the caller may not create tasks at all', () => {
    composerContext = { ...DIRECT_CONTEXT, canCreate: false }
    renderComposer()
    expect(screen.getByText(/do not have permission to create tasks/i)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Create task' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
