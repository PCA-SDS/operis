/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'

const apiCall = jest.fn()
const appEventHandlers: Array<(payload: unknown) => void> = []

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCall(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({
  useAppEvent: (_pattern: string, handler: (payload: unknown) => void) => {
    // Registered once per render; the latest handler is the live one.
    appEventHandlers[0] = handler
  },
}))

import { useCalendarTasks } from '../useCalendarTasks'
import type { CalendarTaskItem } from '../types'

const RANGE = { from: new Date(2026, 8, 1), to: new Date(2026, 8, 8) }

function taskPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    title: 'Prepare proposal',
    status: 'pending',
    projectId: 'project-1',
    projectName: 'Engineering',
    dueDate: '2026-09-05',
    dueTime: '10:00',
    calendarDate: '2026-09-05',
    calendarTime: '10:00',
    assignees: [],
    updatedAt: '2026-09-01T09:00:00.000Z',
    ...overrides,
  }
}

type Captured = ReturnType<typeof useCalendarTasks>

function Harness({ enabled = true }: { enabled?: boolean }) {
  const result = useCalendarTasks(RANGE, enabled)
  captured = result
  return null
}

let captured: Captured

function ok(items: unknown[], truncated = false) {
  return Promise.resolve({ ok: true, status: 200, result: { items, truncated } })
}

beforeEach(() => {
  apiCall.mockReset()
  appEventHandlers.length = 0
})

afterEach(() => {
  cleanup()
})

describe('useCalendarTasks', () => {
  it('asks the Task Manager for exactly the visible window', async () => {
    apiCall.mockReturnValue(ok([]))
    render(<Harness />)

    await waitFor(() => expect(apiCall).toHaveBeenCalled())
    const url = String(apiCall.mock.calls[0][0])
    expect(url).toContain('/api/tasks/my-tasks/calendar')
    expect(url).toContain('from=2026-09-01')
    // The calendar's range end is exclusive, the task API's is inclusive, so the
    // last requested day must be the last visible one — not the day after it.
    expect(url).toContain('to=2026-09-07')
    expect(url).toContain('mode=scheduled')
    expect(url).toContain('tz=')
  })

  it('never calls the task API when the module is off', async () => {
    render(<Harness enabled={false} />)
    await waitFor(() => expect(captured.items).toHaveLength(0))
    expect(apiCall).not.toHaveBeenCalled()
  })

  it('projects the served tasks onto the grid, keeping their ids', async () => {
    apiCall.mockReturnValue(ok([taskPayload()]))
    render(<Harness />)

    await waitFor(() => expect(captured.items).toHaveLength(1))
    const item = captured.items[0] as CalendarTaskItem
    expect(item.id).toBe('task-1')
    expect(item.source).toBe('task')
    expect(item.start.getHours()).toBe(10)
  })

  it('skips a row that does not match the wire contract instead of rendering it wrong', async () => {
    apiCall.mockReturnValue(ok([taskPayload(), { id: 'broken' }]))
    render(<Harness />)

    await waitFor(() => expect(captured.items).toHaveLength(1))
    expect(captured.items[0].id).toBe('task-1')
  })

  it('treats a permission refusal as an empty task layer, not a calendar error', async () => {
    apiCall.mockReturnValue(Promise.resolve({ ok: false, status: 403, result: null }))
    render(<Harness />)

    await waitFor(() => expect(apiCall).toHaveBeenCalled())
    await waitFor(() => expect(captured.isLoading).toBe(false))
    expect(captured.items).toHaveLength(0)
    // The rest of the calendar must still render; a 403 here is an answer.
    expect(captured.error).toBeNull()
  })

  it('reports a real failure so the calendar can surface it', async () => {
    apiCall.mockReturnValue(Promise.resolve({ ok: false, status: 500, result: null }))
    render(<Harness />)

    await waitFor(() => expect(captured.error).not.toBeNull())
  })

  it('shows a drag immediately, before the server confirms it', async () => {
    apiCall.mockReturnValue(ok([taskPayload()]))
    render(<Harness />)
    await waitFor(() => expect(captured.items).toHaveLength(1))

    act(() => captured.applyOverride('task-1', { calendarDate: '2026-09-07', calendarTime: '16:00' }))

    await waitFor(() => {
      const moved = captured.items[0]
      expect(moved.start.getDate()).toBe(7)
      expect(moved.start.getHours()).toBe(16)
    })
  })

  it('restores the served position when a drag is rolled back', async () => {
    apiCall.mockReturnValue(ok([taskPayload()]))
    render(<Harness />)
    await waitFor(() => expect(captured.items).toHaveLength(1))

    act(() => captured.applyOverride('task-1', { calendarDate: '2026-09-07', calendarTime: '16:00' }))
    await waitFor(() => expect(captured.items[0].start.getDate()).toBe(7))

    act(() => captured.clearOverride('task-1'))
    await waitFor(() => expect(captured.items[0].start.getDate()).toBe(5))
  })

  it('retires an override once the server has answered, so it cannot mask the truth', async () => {
    apiCall.mockReturnValue(ok([taskPayload()]))
    render(<Harness />)
    await waitFor(() => expect(captured.items).toHaveLength(1))

    act(() => captured.applyOverride('task-1', { calendarDate: '2026-09-07', calendarTime: '16:00' }))
    await waitFor(() => expect(captured.items[0].start.getDate()).toBe(7))

    // The server says the task moved somewhere else entirely — that wins.
    apiCall.mockReturnValue(ok([taskPayload({ calendarDate: '2026-09-03', calendarTime: '08:00' })]))
    act(() => captured.refetch())

    await waitFor(() => expect(captured.items[0].start.getDate()).toBe(3))
    expect(captured.items[0].start.getHours()).toBe(8)
  })

  it('refreshes when a task is written anywhere else in the product', async () => {
    apiCall.mockReturnValue(ok([taskPayload()]))
    render(<Harness />)
    await waitFor(() => expect(apiCall).toHaveBeenCalledTimes(1))

    apiCall.mockReturnValue(ok([taskPayload({ calendarDate: '2026-09-06', calendarTime: '11:00' })]))
    act(() => appEventHandlers[0]?.({ event: 'tasks.task.updated' }))

    await waitFor(() => expect(captured.items[0].start.getDate()).toBe(6))
  })
})
