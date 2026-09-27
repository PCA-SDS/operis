/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { useModuleOrder } from '../useModuleOrder'

const mockApiCall = jest.fn()
const mockFlash = jest.fn()
let mockPayload: Record<string, unknown> | null = null
let mockHeaders: Record<string, string> = {}

jest.mock('../../utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  withScopedApiRequestHeaders: async (headers: Record<string, string>, run: () => Promise<unknown>) => {
    mockHeaders = headers
    return run()
  },
}))

jest.mock('../../FlashMessages', () => ({
  flash: (...args: unknown[]) => mockFlash(...args),
}))

jest.mock('../../injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: async () => true,
  }),
}))

jest.mock('../../BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: mockPayload, isReady: true, isLoading: false, refresh: async () => undefined }),
}))

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <I18nProvider locale="en" dict={{}}>{children}</I18nProvider>
)

const MODULES = ['customers', 'catalog', 'tasks']

function preferencesResponse(settings: Record<string, unknown>, updatedAt: string | null) {
  return {
    ok: true,
    status: 200,
    result: {
      settings: { version: 1, groupOrder: [], groupLabels: {}, itemLabels: {}, hiddenItems: [], itemOrder: {}, ...settings },
      updatedAt,
    },
  }
}

function putCalls() {
  return mockApiCall.mock.calls.filter((call) => (call[1] as { method?: string } | undefined)?.method === 'PUT')
}

function putBody(index = 0) {
  return JSON.parse(String((putCalls()[index][1] as { body: string }).body))
}

describe('useModuleOrder', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
    mockFlash.mockReset()
    mockHeaders = {}
    mockPayload = {
      grantedFeatures: ['auth.sidebar.manage'],
      groups: [
        {
          id: 'customers',
          name: 'Customers',
          items: [
            { href: '/backend/customers/people', title: 'People' },
            { href: '/backend/customers/secret', title: 'Secret', hidden: true },
          ],
        },
      ],
    }
  })

  it('does not offer reordering without auth.sidebar.manage', () => {
    mockPayload = { grantedFeatures: ['customers.people.view'], groups: [] }
    const { result } = renderHook(() => useModuleOrder(MODULES), { wrapper })
    expect(result.current.canReorder).toBe(false)
    act(() => result.current.reorder(['tasks', 'customers', 'catalog']))
    expect(mockApiCall).not.toHaveBeenCalled()
    expect(result.current.orderedKeys).toEqual(MODULES)
  })

  it('shows the new order at once and saves only the module positions', async () => {
    mockApiCall.mockImplementation(async (_url: string, init?: { method?: string }) =>
      init?.method === 'PUT'
        ? { ok: true, status: 200, result: { updatedAt: '2026-09-26T10:00:00.000Z' } }
        : preferencesResponse(
            { groupOrder: ['settings.sections.system', 'catalog'], groupLabels: { customers: 'Clients' }, hiddenItems: ['/backend/x'] },
            '2026-09-25T10:00:00.000Z',
          ),
    )
    const refresh = jest.fn()
    window.addEventListener('om:refresh-sidebar', refresh)
    const { result } = renderHook(() => useModuleOrder(MODULES), { wrapper })

    act(() => result.current.reorder(['tasks', 'customers', 'catalog']))
    expect(result.current.orderedKeys).toEqual(['tasks', 'customers', 'catalog'])

    await waitFor(() => expect(putCalls()).toHaveLength(1))
    expect(putBody()).toMatchObject({
      groupOrder: ['tasks', 'customers', 'catalog', 'settings.sections.system'],
      groupLabels: { customers: 'Clients' },
      hiddenItems: ['/backend/x'],
    })
    expect(mockHeaders).toEqual({ 'x-om-ext-optimistic-lock-expected-updated-at': '2026-09-25T10:00:00.000Z' })
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    window.removeEventListener('om:refresh-sidebar', refresh)
  })

  it('keeps a module the grid does not show in the saved order, so the local order settles on the server one', async () => {
    mockApiCall.mockImplementation(async (_url: string, init?: { method?: string }) =>
      init?.method === 'PUT' ? { ok: true, status: 200, result: { updatedAt: 'v2' } } : preferencesResponse({}, 'v1'),
    )
    const { result, rerender } = renderHook(({ keys }) => useModuleOrder(keys), {
      wrapper,
      initialProps: { keys: MODULES },
    })
    act(() => result.current.reorder(['tasks', 'customers']))
    expect(result.current.orderedKeys).toEqual(['tasks', 'customers', 'catalog'])
    await waitFor(() => expect(putCalls()).toHaveLength(1))
    expect(putBody().groupOrder).toEqual(['tasks', 'customers', 'catalog'])
    rerender({ keys: ['tasks', 'customers', 'catalog'] })
    rerender({ keys: ['catalog', 'tasks', 'customers'] })
    expect(result.current.orderedKeys).toEqual(['catalog', 'tasks', 'customers'])
  })

  it('offers Reset once the module list arrives, even when the preference loaded before it', async () => {
    let resolveLoad: (value: unknown) => void = () => undefined
    mockApiCall.mockImplementation(() => new Promise((resolve) => { resolveLoad = resolve }))
    const { result, rerender } = renderHook(({ keys }) => useModuleOrder(keys), {
      wrapper,
      initialProps: { keys: [] as string[] },
    })
    act(() => result.current.ensureLoaded())
    await act(async () => {
      resolveLoad(preferencesResponse({ groupOrder: ['tasks', 'customers'] }, 'v1'))
    })
    expect(result.current.hasCustomOrder).toBe(false)
    rerender({ keys: MODULES })
    expect(result.current.hasCustomOrder).toBe(true)
  })

  it('carries role-hidden pages into a first personal preference', async () => {
    mockApiCall.mockImplementation(async (_url: string, init?: { method?: string }) =>
      init?.method === 'PUT' ? { ok: true, status: 200, result: { updatedAt: 'x' } } : preferencesResponse({}, null),
    )
    const { result } = renderHook(() => useModuleOrder(MODULES), { wrapper })
    act(() => result.current.reorder(['catalog', 'customers', 'tasks']))
    await waitFor(() => expect(putCalls()).toHaveLength(1))
    expect(putBody().hiddenItems).toEqual(['/backend/customers/secret'])
  })

  it('reloads and retries once on an edit conflict from another tab', async () => {
    let puts = 0
    mockApiCall.mockImplementation(async (_url: string, init?: { method?: string }) => {
      if (init?.method !== 'PUT') return preferencesResponse({ groupOrder: [] }, puts === 0 ? 'old' : 'fresh')
      puts += 1
      return puts === 1
        ? { ok: false, status: 409, result: { code: 'optimistic_lock_conflict' } }
        : { ok: true, status: 200, result: { updatedAt: 'newest' } }
    })
    const { result } = renderHook(() => useModuleOrder(MODULES), { wrapper })
    act(() => result.current.reorder(['catalog', 'customers', 'tasks']))
    await waitFor(() => expect(putCalls()).toHaveLength(2))
    expect(mockHeaders).toEqual({ 'x-om-ext-optimistic-lock-expected-updated-at': 'fresh' })
    expect(mockFlash).not.toHaveBeenCalled()
  })

  it('reverts and reports when the save fails', async () => {
    mockApiCall.mockImplementation(async (_url: string, init?: { method?: string }) =>
      init?.method === 'PUT' ? { ok: false, status: 500, result: null } : preferencesResponse({}, 'v1'),
    )
    const { result } = renderHook(() => useModuleOrder(MODULES), { wrapper })
    act(() => result.current.reorder(['tasks', 'catalog', 'customers']))
    expect(result.current.orderedKeys).toEqual(['tasks', 'catalog', 'customers'])
    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith("Couldn't save the module order", 'error'))
    expect(result.current.orderedKeys).toEqual(MODULES)
  })

  it('reset removes only the module positions from the saved order', async () => {
    mockApiCall.mockImplementation(async (_url: string, init?: { method?: string }) =>
      init?.method === 'PUT'
        ? { ok: true, status: 200, result: { updatedAt: 'v2' } }
        : preferencesResponse({ groupOrder: ['tasks', 'backend.nav.security', 'customers'] }, 'v1'),
    )
    const { result } = renderHook(() => useModuleOrder(MODULES), { wrapper })
    act(() => result.current.ensureLoaded())
    await waitFor(() => expect(result.current.hasCustomOrder).toBe(true))
    act(() => result.current.resetOrder())
    await waitFor(() => expect(putCalls()).toHaveLength(1))
    expect(putBody().groupOrder).toEqual(['backend.nav.security'])
    await waitFor(() => expect(result.current.hasCustomOrder).toBe(false))
  })
})
