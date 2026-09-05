import {
  renderEmployeeRecordMarkdown,
  employeeRecordFileName,
  type EmployeeRecordSnapshot,
  type EmployeeRecordLabels,
} from '../lib/employeeRecord'

const LABELS: EmployeeRecordLabels = {
  title: 'Employee record',
  sections: { identity: 'Identity', employment: 'Employment', contact: 'Contact', notes: 'Notes' },
  fields: {
    email: 'Email',
    team: 'Team',
    roles: 'Roles',
    status: 'Status',
    employeeNumber: 'Employee number',
    jobTitle: 'Job title',
    employmentType: 'Employment type',
    startDate: 'Start date',
    endDate: 'End date',
    workPhone: 'Work phone',
    personalPhone: 'Personal phone',
    personalEmail: 'Personal email',
    dateOfBirth: 'Date of birth',
    full_time: 'Full time',
  },
  values: { active: 'Active', inactive: 'Inactive', none: 'Nothing recorded' },
}

const EMPTY: EmployeeRecordSnapshot = {
  displayName: 'Amir Haddad',
  email: null,
  teamName: null,
  roleNames: [],
  isActive: true,
  employeeNumber: null,
  jobTitle: null,
  employmentType: null,
  startDate: null,
  endDate: null,
  workPhone: null,
  personalPhone: null,
  personalEmail: null,
  dateOfBirth: null,
  notes: null,
}

describe('employee record markdown', () => {
  it('renders the recorded fields and omits the empty ones', () => {
    const md = renderEmployeeRecordMarkdown(
      { ...EMPTY, jobTitle: 'Engineer', employmentType: 'full_time', startDate: '2026-01-05' },
      LABELS,
    )
    expect(md).toContain('# Amir Haddad')
    expect(md).toContain('| Job title | Engineer |')
    // The enum is rendered through its label, not as the stored token.
    expect(md).toContain('| Employment type | Full time |')
    // Nothing was recorded for these, so they are absent rather than blank.
    expect(md).not.toContain('End date')
    expect(md).not.toContain('Date of birth')
  })

  it('says so when a whole section is empty, instead of printing an empty table', () => {
    const md = renderEmployeeRecordMarkdown(EMPTY, LABELS)
    expect(md).toContain('## Contact')
    expect(md).toContain('_Nothing recorded_')
  })

  it('escapes a pipe so a value cannot break out of its table cell', () => {
    const md = renderEmployeeRecordMarkdown({ ...EMPTY, jobTitle: 'Sales | Support' }, LABELS)
    expect(md).toContain('| Job title | Sales \\| Support |')
  })

  it('flattens a newline in a value, which would otherwise end the table', () => {
    const md = renderEmployeeRecordMarkdown({ ...EMPTY, jobTitle: 'Lead\nEngineer' }, LABELS)
    expect(md).toContain('| Job title | Lead Engineer |')
  })

  it('keeps notes as prose rather than forcing them into a cell', () => {
    const md = renderEmployeeRecordMarkdown({ ...EMPTY, notes: 'Line one\nLine two' }, LABELS)
    expect(md).toContain('## Notes')
    expect(md).toContain('Line one\nLine two')
  })

  it('builds a filesystem-safe name from the display name', () => {
    expect(employeeRecordFileName({ ...EMPTY, displayName: 'Amir Haddad' })).toBe('amir-haddad-record.md')
    expect(employeeRecordFileName({ ...EMPTY, displayName: 'Zoë  O\'Brien/Smith' })).toBe('zoe-obriensmith-record.md')
  })

  it('falls back to a generic name when nothing survives sanitising', () => {
    expect(employeeRecordFileName({ ...EMPTY, displayName: '***' })).toBe('employee-record.md')
  })
})
