/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StaffRoleAssignmentsField } from '../staffRoleAssignmentsField'

const apiCallMock = jest.fn()
const fetchOrganizationOptionsMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('../organizationOptions', () => ({
  fetchOrganizationOptions: (...args: unknown[]) => fetchOrganizationOptionsMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

jest.mock('@open-mercato/ui/primitives/alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/primitives/accordion', () => ({
  Accordion: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AccordionContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AccordionItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AccordionTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/primitives/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick?: () => void }) => (
    <button type="button" disabled={disabled} onClick={onClick}>{children}</button>
  ),
}))

jest.mock('@open-mercato/ui/primitives/spinner', () => ({
  Spinner: () => <span>loading</span>,
}))

jest.mock('@open-mercato/ui/backend/inputs/TagsInput', () => ({
  TagsInput: ({
    value,
    onChange,
    suggestions,
    placeholder,
  }: {
    value: string[]
    onChange: (nextValue: string[]) => void
    suggestions?: Array<{ value: string }>
    placeholder?: string
  }) => {
    const isBulkInput = placeholder?.includes('copy')
    return (
      <button
        type="button"
        data-testid={isBulkInput ? 'bulk-role-input' : 'organization-role-input'}
        onClick={() => onChange(value.length ? [] : [suggestions?.[0]?.value ?? ''])}
      >
        {placeholder}
      </button>
    )
  },
}))

describe('StaffRoleAssignmentsField', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    apiCallMock.mockResolvedValue({
      ok: true,
      result: {
        items: [
          {
            organizationId: 'org-1',
            roleIds: [],
            roles: [{ id: 'role-1', name: ' Manager ' }],
          },
          {
            organizationId: 'org-2',
            roleIds: [],
            roles: [{ id: 'role-2', name: 'Manager' }],
          },
        ],
      },
    })
    fetchOrganizationOptionsMock.mockResolvedValue([
      { value: 'org-1', label: 'Organization 1' },
      { value: 'org-2', label: 'Organization 2' },
    ])
  })

  it('maps the selected role name to each organization-local role id', async () => {
    const setValue = jest.fn()

    render(
      <StaffRoleAssignmentsField
        value={[]}
        values={{ organizationId: 'org-1', organizationIds: ['org-1', 'org-2'] }}
        setValue={setValue}
        tenantId="tenant-1"
      />,
    )

    await waitFor(() => expect(screen.getByTestId('bulk-role-input')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('bulk-role-input'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => {
      expect(setValue).toHaveBeenLastCalledWith([
        { organizationId: 'org-1', roleIds: ['role-1'] },
        { organizationId: 'org-2', roleIds: ['role-2'] },
      ])
    })
  })
})
