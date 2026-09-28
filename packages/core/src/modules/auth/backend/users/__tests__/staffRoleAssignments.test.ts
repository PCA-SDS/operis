import { dedupeRoleOptionsByLabel } from '../staffRoleAssignments'

describe('dedupeRoleOptionsByLabel', () => {
  it('keeps one bulk option for the same role name across organizations', () => {
    const firstOrganizationOption = { value: 'role-acme-manager', label: 'Manager', organizationId: 'org-acme' }
    const secondOrganizationOption = { value: 'role-hanoi-manager', label: 'Manager', organizationId: 'org-hanoi' }
    const employeeOption = { value: 'role-hanoi-employee', label: 'Employee', organizationId: 'org-hanoi' }

    expect(dedupeRoleOptionsByLabel([
      firstOrganizationOption,
      secondOrganizationOption,
      employeeOption,
    ])).toEqual([
      firstOrganizationOption,
      employeeOption,
    ])
  })

  it('uses trimmed labels as the bulk option key without changing the option label', () => {
    const optionWithWhitespace = { value: 'role-manager', label: ' Manager ', organizationId: 'org-acme' }
    const duplicateOption = { value: 'role-manager-duplicate', label: 'Manager', organizationId: 'org-hanoi' }

    expect(dedupeRoleOptionsByLabel([optionWithWhitespace, duplicateOption])).toEqual([optionWithWhitespace])
  })
})
