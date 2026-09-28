export type CrudMutationGuardValidationSuccess = {
  ok: true
  shouldRunAfterSuccess: boolean
  metadata?: Record<string, unknown> | null
}

export type CrudMutationGuardValidationFailure = {
  ok: false
  status: number
  body: Record<string, unknown>
}

export type CrudMutationGuardValidationResult =
  | CrudMutationGuardValidationSuccess
  | CrudMutationGuardValidationFailure

export type CrudMutationGuardValidateInput = {
  tenantId: string
  organizationId?: string | null
  userId: string
  resourceKind: string
  resourceId: string
  operation: 'create' | 'update' | 'delete' | 'custom'
  requestMethod: string
  requestHeaders: Headers
  mutationPayload?: Record<string, unknown> | null
}

export type CrudMutationGuardAfterSuccessInput = {
  tenantId: string
  organizationId?: string | null
  userId: string
  resourceKind: string
  resourceId: string
  operation: 'create' | 'update' | 'delete' | 'custom'
  requestMethod: string
  requestHeaders: Headers
  metadata?: Record<string, unknown> | null
}
