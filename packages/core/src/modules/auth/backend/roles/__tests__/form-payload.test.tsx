/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { waitFor } from '@testing-library/react'
import { render } from '@testing-library/react'

type FormSubmit = (values: Record<string, unknown>) => Promise<void>
type CustomFieldRenderProps = {
  value: unknown
  setValue: (value: unknown) => void
}
type CrudField = {
  id: string
  component?: (props: CustomFieldRenderProps) => React.ReactNode
}
type CrudFormProps = {
  onSubmit?: FormSubmit
  initialValues?: Record<string, unknown>
  fields?: CrudField[]
}

const crudFormPropsCapture: { current: CrudFormProps | null } = { current: null }
const parentRoleSelectPropsCapture: { current: { value?: string | null } | null } = { current: null }
const apiCallMock = jest.fn()
const createCrudMock = jest.fn()
const updateCrudMock = jest.fn().mockResolvedValue({ ok: true })
const mockTranslate = (_key: string, fallback?: string) => fallback ?? 'translation'

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/roles/role-child/edit',
}))

jest.mock('#generated/entities.ids.generated', () => ({
  E: { auth: { role: 'auth:role' } },
}), { virtual: true })

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: Record<string, unknown>) => {
    crudFormPropsCapture.current = props as CrudFormProps
    return <div data-testid="crud-form" />
  },
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => unknown) => run(),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: (...args: unknown[]) => createCrudMock(...args),
  updateCrud: (...args: unknown[]) => updateCrudMock(...args),
  deleteCrud: jest.fn().mockResolvedValue({ ok: true }),
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldValues', () => ({
  collectCustomFieldValues: jest.fn().mockReturnValue({}),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields-client', () => ({
  extractCustomFieldEntries: jest.fn().mockReturnValue({}),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: jest.fn().mockReturnValue({}),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('@open-mercato/core/modules/auth/components/ParentRoleSelect', () => ({
  ParentRoleSelect: (props: { value?: string | null }) => {
    parentRoleSelectPropsCapture.current = props
    return <div />
  },
}))

jest.mock('@open-mercato/core/modules/auth/components/AclEditor', () => ({
  AclEditor: () => <div />,
}))

jest.mock('@open-mercato/core/modules/dashboards/components/WidgetVisibilityEditor', () => ({
  WidgetVisibilityEditor: React.forwardRef(function WidgetVisibilityEditor(_props: unknown, _ref: unknown) {
    return <div />
  }),
}))

jest.mock('@open-mercato/core/modules/directory/components/TenantSelect', () => ({
  TenantSelect: () => <div />,
}))

jest.mock('@open-mercato/ui/primitives/alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import CreateRolePage from '../create/page'
import EditRolePage from '../[id]/edit/page'

describe('role form parent-role persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    crudFormPropsCapture.current = null
    parentRoleSelectPropsCapture.current = null
    apiCallMock.mockResolvedValue({ ok: true, result: { isSuperAdmin: false } })
  })

  it('includes the selected parent role when creating a role', async () => {
    render(<CreateRolePage />)

    await waitFor(() => expect(crudFormPropsCapture.current?.onSubmit).toBeTruthy())
    await crudFormPropsCapture.current!.onSubmit({
      name: 'Org Child',
      parentRoleId: 'role-parent-a',
    })

    expect(createCrudMock).toHaveBeenCalledWith('auth/roles', {
      name: 'Org Child',
      parentRoleId: 'role-parent-a',
    })
  })

  it('includes a changed parent or explicit null when updating a role', async () => {
    apiCallMock.mockResolvedValueOnce({
      ok: true,
      result: {
        items: [{
          id: 'role-child',
          name: 'Org Child',
          parentRoleId: 'role-parent-a',
          tenantId: null,
          usersCount: 0,
          updatedAt: null,
        }],
        isSuperAdmin: false,
      },
    })

    render(<EditRolePage params={{ id: 'role-child' }} />)

    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    await waitFor(() => expect(crudFormPropsCapture.current?.initialValues?.parentRoleId).toBe('role-parent-a'))
    await crudFormPropsCapture.current!.onSubmit({
      id: 'role-child',
      name: 'Org Child',
      parentRoleId: 'role-parent-b',
    })

    expect(updateCrudMock).toHaveBeenCalledWith('auth/roles', {
      id: 'role-child',
      name: 'Org Child',
      parentRoleId: 'role-parent-b',
    })

    updateCrudMock.mockClear()
    await crudFormPropsCapture.current!.onSubmit({
      id: 'role-child',
      name: 'Org Child',
      parentRoleId: null,
    })

    expect(updateCrudMock).toHaveBeenCalledWith('auth/roles', {
      id: 'role-child',
      name: 'Org Child',
      parentRoleId: null,
    })
  })

  it('hydrates the parent selector when the form value is initially undefined', async () => {
    apiCallMock.mockResolvedValueOnce({
      ok: true,
      result: {
        items: [{
          id: 'role-child',
          name: 'Org Child',
          parentRoleId: 'role-parent-a',
          tenantId: null,
          usersCount: 0,
          updatedAt: null,
        }],
        isSuperAdmin: false,
      },
    })

    render(<EditRolePage params={{ id: 'role-child' }} />)

    await waitFor(() => expect(crudFormPropsCapture.current?.initialValues?.parentRoleId).toBe('role-parent-a'))
    const parentRoleField = crudFormPropsCapture.current?.fields?.find((field) => field.id === 'parentRoleId')
    expect(parentRoleField?.component).toBeDefined()

    render(parentRoleField!.component!({ value: undefined, setValue: jest.fn() }))

    expect(parentRoleSelectPropsCapture.current?.value).toBe('role-parent-a')
  })
})
