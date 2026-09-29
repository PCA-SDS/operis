/**
 * @jest-environment jsdom
 */
import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import ProductOptionsPage from '../page'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

const translate = (_key: string, fallback?: string) => fallback ?? _key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => translate,
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(),
  buildOptimisticLockHeader: jest.fn(),
  readApiResultOrThrow: jest.fn(),
  withScopedApiRequestHeaders: (_headers: Record<string, string>, run: () => unknown) => run(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn(() => false),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn() }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, asChild, ...rest }: { children: React.ReactNode; asChild?: boolean }) =>
    asChild ? <span {...rest}>{children}</span> : <button {...rest}>{children}</button>,
}))

jest.mock('@open-mercato/ui/primitives/spinner', () => ({
  Spinner: () => <span data-testid="spinner" />,
}))

jest.mock('@open-mercato/core/modules/catalog/components/products/OptionTreeEditor', () => ({
  OptionTreeEditor: ({ groups }: { groups: Array<{ name: string }> }) => (
    <div data-testid="option-tree-editor">{groups.map((group) => group.name).join(',')}</div>
  ),
  OptionTreeSkeleton: () => <div data-testid="option-tree-skeleton" />,
}))

jest.mock('lucide-react', () => ({
  ArrowLeft: () => null,
  GitBranch: () => null,
  Save: () => null,
  Settings2: () => null,
}))

const optionTree = (name: string) => ({
  groups: [{ id: name, name, requirement: 'required', select_mode: 'single', sort_order: 1 }],
  options: [],
  updated_at: name,
  currency_code: 'USD',
})

describe('ProductOptionsPage organization scope reload', () => {
  const apiCalls: Array<{ request: Deferred<ReturnType<typeof optionTree>> }> = []
  let scopeVersion = 0

  beforeEach(() => {
    jest.clearAllMocks()
    apiCalls.length = 0
    scopeVersion = 0
    ;(useOrganizationScopeVersion as jest.Mock).mockImplementation(() => scopeVersion)
    ;(readApiResultOrThrow as jest.Mock).mockImplementation(() => {
      const request = deferred<ReturnType<typeof optionTree>>()
      apiCalls.push({ request })
      return request.promise
    })
  })

  it('reloads after a scope change and ignores the stale response from the previous scope', async () => {
    const view = render(<ProductOptionsPage params={{ id: 'product-1' }} />)
    await waitFor(() => expect(apiCalls).toHaveLength(1))

    scopeVersion = 1
    view.rerender(<ProductOptionsPage params={{ id: 'product-1' }} />)
    await waitFor(() => expect(apiCalls).toHaveLength(2))

    await act(async () => {
      apiCalls[1].request.resolve(optionTree('new-scope'))
    })
    await waitFor(() => expect(screen.getByTestId('option-tree-editor')).toHaveTextContent('new-scope'))

    await act(async () => {
      apiCalls[0].request.resolve(optionTree('old-scope'))
    })

    expect(screen.getByTestId('option-tree-editor')).toHaveTextContent('new-scope')
    expect(screen.getByTestId('option-tree-editor')).not.toHaveTextContent('old-scope')
  })
})
