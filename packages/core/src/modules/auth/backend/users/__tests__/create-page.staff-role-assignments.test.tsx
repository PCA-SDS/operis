/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const crudFormPropsCapture: { current: Record<string, unknown> | null } = { current: null }
const apiCallMock = jest.fn()

jest.mock('#generated/entities.ids.generated', () => ({ E: { auth: { user: 'auth:user' } } }), { virtual: true })

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: Record<string, unknown>) => {
    crudFormPropsCapture.current = props
    return <div>form</div>
  },
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({ createCrud: jest.fn(), updateCrud: jest.fn() }))
jest.mock('@open-mercato/core/modules/directory/components/OrganizationSelect', () => ({ OrganizationSelect: () => <div>organization</div> }))
jest.mock('@open-mercato/core/modules/directory/components/TenantSelect', () => ({ TenantSelect: () => <div>tenant</div> }))
jest.mock('@open-mercato/core/modules/auth/backend/users/roleOptions', () => ({ fetchRoleOptions: jest.fn(async () => []) }))
jest.mock('@open-mercato/core/modules/auth/backend/users/organizationOptions', () => ({ fetchOrganizationOptions: jest.fn(async () => []) }))
jest.mock('@open-mercato/core/modules/auth/backend/users/staffRoleAssignmentsField', () => ({
  StaffRoleAssignmentsField: () => <div>staff roles</div>,
}))
jest.mock('@open-mercato/ui/primitives/spinner', () => ({ Spinner: () => <span>spinner</span> }))
jest.mock('@open-mercato/ui/primitives/radio', () => ({
  RadioGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  RadioField: () => <div>radio</div>,
}))

import CreateUserPage from '../create/page'

describe('users create page — staff role assignment tenant context', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    crudFormPropsCapture.current = null
    apiCallMock.mockImplementation(async (url: string) => {
      if (url === '/api/directory/organization-switcher') {
        return { ok: true, result: { isSuperAdmin: false, tenantId: 'tenant-1' } }
      }
      return { ok: true, result: { items: [] } }
    })
  })

  it('passes the current tenant to staff role assignments for a non-superadmin actor', async () => {
    renderWithProviders(<CreateUserPage />)

    await waitFor(() => expect(crudFormPropsCapture.current).toBeTruthy())

    await waitFor(() => {
      const fields = crudFormPropsCapture.current?.fields as Array<{ id?: string; component?: (props: Record<string, unknown>) => React.ReactNode }>
      const staffRoleField = fields.find((field) => field.id === 'staffRoleAssignments')
      expect(staffRoleField?.component).toBeDefined()

      const renderedField = staffRoleField?.component?.({
        value: [],
        values: { organizationId: 'org-1', organizationIds: ['org-1'] },
        setValue: jest.fn(),
      })

      expect(React.isValidElement(renderedField)).toBe(true)
      expect((renderedField as React.ReactElement<{ tenantId?: string | null }>).props.tenantId).toBe('tenant-1')
    })
  })
})
