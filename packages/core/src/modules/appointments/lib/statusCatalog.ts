import { APPOINTMENT_SYSTEM_STATUS_CODES } from '../data/constants'

const STATUS_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/

export function isAppointmentSystemStatusCode(code: string): boolean {
  return (APPOINTMENT_SYSTEM_STATUS_CODES as readonly string[]).includes(code)
}

/** Derive a stable snake_case code from a human label (PCA/Privé parity). */
export function appointmentStatusCodeFromLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
  return slug || 'status'
}

export function normalizeAppointmentStatusCode(raw: string | null | undefined, label: string): string {
  const trimmed = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  const code = trimmed || appointmentStatusCodeFromLabel(label)
  return code
}

export function isValidAppointmentStatusCode(code: string): boolean {
  return STATUS_CODE_PATTERN.test(code)
}

export type AppointmentStatusDto = {
  id: string
  code: string
  label: string
  description: string | null
  isSystem: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export function mapAppointmentStatusRow(row: {
  id: string
  code: string
  label: string
  description?: string | null
  isSystem: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}): AppointmentStatusDto {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    description: row.description ?? null,
    isSystem: row.isSystem,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
