import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    // The HR record holds the module's most sensitive personal data. Job title
    // and employee number stay in the clear so the directory can search and
    // sort on them; date of birth and private contact details cannot.
    entityId: 'staff:staff_employee_profile',
    fields: [
      { field: 'personal_phone' },
      { field: 'personal_email' },
      { field: 'date_of_birth' },
      { field: 'notes' },
    ],
  },
  {
    entityId: 'staff:staff_leave_request',
    fields: [
      { field: 'note' },
      { field: 'decision_comment' },
      { field: 'unavailability_reason_value' },
    ],
  },
]

export default defaultEncryptionMaps
