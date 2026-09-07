import type { StaffEmploymentType } from '../data/entities'

export type EmployeeRecordSnapshot = {
  displayName: string
  email: string | null
  teamName: string | null
  roleNames: string[]
  isActive: boolean
  employeeNumber: string | null
  jobTitle: string | null
  employmentType: StaffEmploymentType | null
  startDate: string | null
  endDate: string | null
  workPhone: string | null
  personalPhone: string | null
  personalEmail: string | null
  dateOfBirth: string | null
  notes: string | null
}

export type EmployeeRecordLabels = {
  title: string
  sections: { identity: string; employment: string; contact: string; notes: string }
  fields: Record<string, string>
  values: { active: string; inactive: string; none: string }
}

/** `|` and newlines would break out of a table cell; nothing else needs escaping. */
function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function table(rows: Array<[string, string | null]>, labels: EmployeeRecordLabels): string[] {
  const present = rows.filter(([, value]) => value != null && value !== '')
  if (present.length === 0) return [`_${labels.values.none}_`, '']
  return [
    '| | |',
    '| --- | --- |',
    ...present.map(([label, value]) => `| ${cell(label)} | ${cell(String(value))} |`),
    '',
  ]
}

/**
 * Renders a member's HR record as Markdown.
 *
 * Markdown rather than PDF: it is the one format the platform can produce with
 * no new dependency, it diffs cleanly when the record is regenerated, and the
 * attachments module stores it like any other file.
 *
 * Empty fields are omitted rather than printed blank — a record that lists ten
 * dashes reads as though the data is missing, when usually it simply does not
 * apply to that person.
 */
export function renderEmployeeRecordMarkdown(
  snapshot: EmployeeRecordSnapshot,
  labels: EmployeeRecordLabels,
): string {
  const lines: string[] = [`# ${snapshot.displayName}`, '']

  lines.push(`## ${labels.sections.identity}`, '')
  lines.push(...table([
    [labels.fields.email, snapshot.email],
    [labels.fields.team, snapshot.teamName],
    [labels.fields.roles, snapshot.roleNames.length ? snapshot.roleNames.join(', ') : null],
    [labels.fields.status, snapshot.isActive ? labels.values.active : labels.values.inactive],
  ], labels))

  lines.push(`## ${labels.sections.employment}`, '')
  lines.push(...table([
    [labels.fields.employeeNumber, snapshot.employeeNumber],
    [labels.fields.jobTitle, snapshot.jobTitle],
    [labels.fields.employmentType, snapshot.employmentType ? labels.fields[snapshot.employmentType] ?? snapshot.employmentType : null],
    [labels.fields.startDate, snapshot.startDate],
    [labels.fields.endDate, snapshot.endDate],
  ], labels))

  lines.push(`## ${labels.sections.contact}`, '')
  lines.push(...table([
    [labels.fields.workPhone, snapshot.workPhone],
    [labels.fields.personalPhone, snapshot.personalPhone],
    [labels.fields.personalEmail, snapshot.personalEmail],
    [labels.fields.dateOfBirth, snapshot.dateOfBirth],
  ], labels))

  if (snapshot.notes) {
    lines.push(`## ${labels.sections.notes}`, '', snapshot.notes, '')
  }

  return lines.join('\n')
}

/** Stable, filesystem-safe, and identifies the person at a glance. */
export function employeeRecordFileName(snapshot: EmployeeRecordSnapshot): string {
  const base = snapshot.displayName
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
  return `${base.length > 0 ? base : 'employee'}-record.md`
}
