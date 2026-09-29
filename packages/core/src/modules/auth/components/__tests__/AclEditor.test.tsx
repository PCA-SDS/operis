/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? 'translation',
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
}))

jest.mock('../AclDependencyDiagnosticsPanel', () => ({
  AclDependencyDiagnosticsPanel: () => null,
}))

import { AclEditor } from '../AclEditor'

describe('AclEditor organization scope actions', () => {
  beforeEach(() => {
    apiCallMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/auth/features')) {
        return {
          ok: true,
          result: {
            items: [{ id: 'customers.view', title: 'View customers', module: 'customers' }],
            modules: [{ id: 'customers', title: 'Customers' }],
          },
        }
      }
      if (url.startsWith('/api/auth/users/acl')) {
        return {
          ok: true,
          result: {
            hasCustomAcl: true,
            isSuperAdmin: false,
            features: ['customers.view'],
            organizations: ['org-1', 'org-2'],
            updatedAt: null,
          },
        }
      }
      if (url.startsWith('/api/directory/organizations')) {
        return {
          ok: true,
          result: { items: [{ id: 'org-1', name: 'Organization 1' }, { id: 'org-2', name: 'Organization 2' }] },
        }
      }
      return { ok: true, result: { items: [] } }
    })
  })

  it('clears organization scope without submitting the containing form', async () => {
    const onChange = jest.fn()
    const onSubmit = jest.fn()

    render(
      <form onSubmit={onSubmit}>
        <AclEditor
          kind="user"
          targetId="user-1"
          canEditOrganizations
          onChange={onChange}
          currentUserIsSuperAdmin
          tenantId="tenant-1"
        />
      </form>,
    )

    const allowAllButton = await screen.findByRole('button', { name: 'Allow all organizations' })
    expect(allowAllButton).toHaveAttribute('type', 'button')

    fireEvent.click(allowAllButton)

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ organizations: null }))
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
