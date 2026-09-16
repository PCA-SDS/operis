/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ChatTaskCardDto } from '../data/types'
import { ChatTaskCard } from '../components/ChatTaskCard'

const complete = { mutate: jest.fn(), isPending: false }
const reopen = { mutate: jest.fn(), isPending: false }

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT:
    () =>
    (key: string, fallback?: string, params?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? '')),
  useLocale: () => 'en',
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('../components/hooks', () => ({
  useChatTaskMutations: () => ({ complete, reopen }),
}))

const AVAILABLE: ChatTaskCardDto = {
  linkId: 'link-1',
  cardMessageId: 'message-1',
  available: true,
  task: {
    id: 'task-1',
    reference: 'ENG-42',
    title: 'Prepare the proposal',
    status: 'pending',
    priority: 'high',
    dueDate: '2026-09-20',
    dueTime: '15:00',
    recurrence: null,
    assignees: [{ id: 'user-1', name: 'Amir Haddad' }],
    assignmentTargetCount: 0,
    projectId: 'project-1',
    projectName: 'Engineering',
    updatedAt: '2026-09-14T10:00:00.000Z',
    canEdit: true,
    href: '/backend/tasks/all?task=task-1',
  },
}

const UNAVAILABLE: ChatTaskCardDto = {
  linkId: 'link-1',
  cardMessageId: 'message-1',
  available: false,
  task: null,
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('an available card', () => {
  it('shows the reference, title, assignee, due date and priority', () => {
    render(<ChatTaskCard card={AVAILABLE} />)
    expect(screen.getByText('ENG-42')).toBeTruthy()
    expect(screen.getByText('Prepare the proposal')).toBeTruthy()
    expect(screen.getByText(/Amir Haddad/)).toBeTruthy()
    expect(screen.getByText(/Due 2026-09-20 at 15:00/)).toBeTruthy()
    // The `useT` stub renders each key's fallback, and the fallback for a status or a
    // priority is the raw wire value on purpose — there is no second English copy of
    // the frozen vocabulary to drift. `moduleContract.test.ts` is what guarantees the
    // real key exists in all eight bundles, so a reader never sees this.
    expect(screen.getByText('high')).toBeTruthy()
  })

  it('links to the tasks module’s own route rather than a URL of its own', () => {
    render(<ChatTaskCard card={AVAILABLE} />)
    const link = screen.getByRole('link', { name: /Open task/ })
    expect(link.getAttribute('href')).toBe('/backend/tasks/all?task=task-1')
  })

  it('sends the expected version with a completion, so a retry cannot advance twice', () => {
    render(<ChatTaskCard card={AVAILABLE} />)
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }))
    expect(complete.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', updatedAt: '2026-09-14T10:00:00.000Z' }),
      expect.anything(),
    )
  })

  it('offers Reopen instead of Complete once the task is in a terminal status', () => {
    const done = { ...AVAILABLE, task: { ...AVAILABLE.task!, status: 'done' as const } }
    render(<ChatTaskCard card={done} />)
    expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeTruthy()
  })

  it('offers Reopen for a cancelled task too, since that is terminal as well', () => {
    const cancelled = { ...AVAILABLE, task: { ...AVAILABLE.task!, status: 'cancelled' as const } }
    render(<ChatTaskCard card={cancelled} />)
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeTruthy()
  })

  /**
   * A recurring task is never "done" — completing it advances the occurrence — so the
   * control must not promise something the module will not do.
   */
  it('labels a recurring completion as "Done for now" and says it repeats', () => {
    const recurring = {
      ...AVAILABLE,
      task: { ...AVAILABLE.task!, recurrence: { freq: 'weekly' as const, weekday: 1, dayOfMonth: null } },
    }
    render(<ChatTaskCard card={recurring} />)
    expect(screen.getByRole('button', { name: 'Done for now' })).toBeTruthy()
    expect(screen.getByText('Repeats')).toBeTruthy()
  })

  it('reports the status the server actually returned, not the one that was asked for', () => {
    const { flash } = jest.requireMock('@open-mercato/ui/backend/FlashMessages') as { flash: jest.Mock }
    const recurring = {
      ...AVAILABLE,
      task: { ...AVAILABLE.task!, recurrence: { freq: 'weekly' as const, weekday: 1, dayOfMonth: null } },
    }
    render(<ChatTaskCard card={recurring} />)
    fireEvent.click(screen.getByRole('button', { name: 'Done for now' }))

    // Drive the success callback with what the tasks module really returns for a
    // recurring completion: still pending, rolled to the next occurrence.
    const [, handlers] = complete.mutate.mock.calls[0] as [unknown, { onSuccess: (task: unknown) => void }]
    handlers.onSuccess({ status: 'pending' })
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('repeats'), 'success')

    flash.mockClear()
    handlers.onSuccess({ status: 'done' })
    expect(flash).toHaveBeenCalledWith('Task completed.', 'success')
  })

  it('hides the write controls from a viewer who may not edit', () => {
    // Not disabled — absent. A greyed control that answers 403 is the dead end this
    // avoids.
    const readOnly = { ...AVAILABLE, task: { ...AVAILABLE.task!, canEdit: false } }
    render(<ChatTaskCard card={readOnly} />)
    expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull()
    expect(screen.getByRole('link', { name: /Open task/ })).toBeTruthy()
  })

  it('describes a role audience by its existence, never by naming the role', () => {
    const roleOnly = {
      ...AVAILABLE,
      task: { ...AVAILABLE.task!, assignees: [], assignmentTargetCount: 2 },
    }
    render(<ChatTaskCard card={roleOnly} />)
    expect(screen.getByText('Assigned to a role')).toBeTruthy()
  })
})

describe('an unavailable card', () => {
  /**
   * The security-critical render. A chat member without task access must learn only
   * that something is linked here — nothing about what. That includes tooltips,
   * accessibility labels and every href, because each of those is a place a title or
   * a reference has leaked from before.
   */
  it('reveals nothing about the task, in text or in any attribute', () => {
    const { container } = render(<ChatTaskCard card={UNAVAILABLE} />)
    expect(screen.getByText(/do not have access/)).toBeTruthy()
    const markup = container.innerHTML
    for (const secret of ['ENG-42', 'Prepare the proposal', 'Engineering', 'Amir Haddad', 'task-1', 'pending']) {
      expect(markup).not.toContain(secret)
    }
  })

  it('offers no controls at all, so nothing can be acted on by guessing', () => {
    render(<ChatTaskCard card={UNAVAILABLE} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders the same minimal state for a null card', () => {
    // What a viewer sees when the link resolved to nothing at all — the same answer,
    // so "no access" and "no longer there" are indistinguishable from outside.
    const { container } = render(<ChatTaskCard card={null} />)
    expect(screen.getByText(/do not have access/)).toBeTruthy()
    expect(container.innerHTML).not.toContain('ENG-42')
  })
})

describe('while loading', () => {
  it('shows a placeholder rather than an empty box or a false unavailable state', () => {
    // Rendering the unavailable line during a fetch would tell every reader they lack
    // access for a moment on every page load.
    render(<ChatTaskCard card={null} isLoading />)
    expect(screen.queryByText(/do not have access/)).toBeNull()
  })
})
