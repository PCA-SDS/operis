/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TaskPanel } from '../components/TaskPanel'

/**
 * The New Task modal in create mode: the shared dialog shell, and the Quick Add
 * line that fills the fields under it. The rule worth pinning is which of the
 * two wins — a parse must never undo a control the user has already set.
 */

const parseQuickAdd = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string, params?: Record<string, unknown>) =>
    (fallback ?? key).replace(/\{(\w+)\}/g, (_m, name: string) => String(params?.[name] ?? '')),
  useLocale: () => 'en',
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({ InjectionSpot: () => null }))

jest.mock('../components/api', () => ({
  tasksApi: { parseQuickAdd: (...args: unknown[]) => parseQuickAdd(...args) },
}))

jest.mock('../components/hooks', () => ({
  useTask: () => ({ task: null, isLoading: false }),
  useTaskError: () => ({ errorMessage: null, retry: jest.fn() }),
  useTaskMutations: () => ({
    create: { mutateAsync: jest.fn(), isPending: false },
    update: { mutateAsync: jest.fn() },
    remove: { mutateAsync: jest.fn() },
  }),
  useMilestones: () => ({ milestones: [] }),
  useAssignableUsers: () => ({ users: [{ id: 'user-1', name: 'Amir Haddad', email: 'amir@example.com' }] }),
  useLabels: () => ({ labels: [] }),
  useLabelMutations: () => ({ create: { mutateAsync: jest.fn() } }),
  useProjects: () => ({ projects: [{ id: 'project-1', key: 'ENG', name: 'Engineering', icon: null }] }),
  useInboxProject: () => ({ inbox: { id: 'inbox-1', key: 'INBOX', name: 'Inbox' } }),
  useAssignmentOptions: () => ({ roles: [], isLoading: false }),
}))

function renderPanel() {
  return render(<TaskPanel taskId={null} projectId="project-1" onClose={jest.fn()} />)
}

const PARSED = {
  originalText: '',
  title: 'Fix login',
  project: null,
  projectQuery: null,
  assignee: null,
  assigneeQuery: null,
  labels: [],
  labelQueries: [],
  dueDate: '2026-09-03',
  dueTime: '15:00',
  recurrence: null,
  priority: 'urgent' as const,
  recognizedTokens: [],
  warnings: [],
}

beforeEach(() => {
  jest.clearAllMocks()
  parseQuickAdd.mockResolvedValue(PARSED)
})

describe('TaskPanel — create mode shell', () => {
  it('uses the shared dialog shell rather than a hand-rolled header and footer', () => {
    renderPanel()
    // The old create header drew its own title row with a ghost Cancel beside
    // it, and its own button band. The shell supplies both, which is what keeps
    // this modal in step with the event editor.
    expect(document.querySelector('[data-slot="dialog-header"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="dialog-body"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="dialog-footer"]')).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'New task' })).toBeInTheDocument()
  })

  it('is wider than the event editor, which is the DS xl step', () => {
    renderPanel()
    const content = document.querySelector('[data-slot="dialog-content"]') as HTMLElement
    expect(content.className).toContain('sm:max-w-5xl')
    expect(content.className).not.toContain('max-w-4xl')
  })
})

describe('TaskPanel — quick add', () => {
  it('fills the fields below from the typed line', async () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('Quick add'), {
      target: { value: 'Fix login p1 tomorrow 3pm' },
    })
    await waitFor(() => expect(parseQuickAdd).toHaveBeenCalled())
    // The title keeps the cleaned text, so the tokens never land in the name.
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Task title')).toHaveValue('Fix login'),
    )
  })

  it('leaves a field the user set by hand alone', async () => {
    renderPanel()
    const title = screen.getByPlaceholderText('Task title')
    fireEvent.change(title, { target: { value: 'My own title' } })

    fireEvent.change(screen.getByLabelText('Quick add'), {
      target: { value: 'Fix login p1 tomorrow 3pm' },
    })
    await waitFor(() => expect(parseQuickAdd).toHaveBeenCalled())
    // Let the fill actually land before asserting it left this field alone —
    // otherwise the assertion passes simply by running too early.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60))
    })

    // Parsing must not undo a decision already made — the composer's UNSET rule.
    expect(title).toHaveValue('My own title')
  })
})
