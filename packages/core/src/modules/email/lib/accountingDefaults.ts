export const RESERVED_EMAIL_SYSTEM_VARIABLES = [
  'companyName',
  'companyCode',
  'companyEmail',
  'contactNames',
  'recipientEmails',
  'greeting',
] as const

export const ACCOUNTING_DEFAULT_FIELDS = [
  'currentTaxQuarter',
  'currentAccountingPeriod',
  'financialYear',
  'accountingContactName',
  'accountingContactPhone',
  'paymentInstructions',
  'bankAccountReference',
  'defaultCurrency',
  'taxAuthorityName',
  'standardDisclaimer',
  'officeAddress',
] as const

const reservedSystemVariableSet = new Set<string>(RESERVED_EMAIL_SYSTEM_VARIABLES)

export function isReservedEmailSystemVariable(key: string): boolean {
  return reservedSystemVariableSet.has(key.trim())
}

export function withoutReservedEmailSystemVariables(values: Record<string, unknown> | null | undefined): Record<string, string> {
  if (!values) return {}
  return Object.entries(values).reduce<Record<string, string>>((result, [rawKey, value]) => {
    const key = rawKey.trim()
    if (key.length > 0 && typeof value === 'string' && !isReservedEmailSystemVariable(key)) result[key] = value
    return result
  }, {})
}

export function mergeEmailTemplateVariables(
  systemVariables: Record<string, string>,
  accountingDefaults: Record<string, unknown> | null | undefined,
  templateDefaults: Record<string, unknown> | null | undefined,
  composeOverrides: Record<string, unknown> | null | undefined,
): Record<string, string> {
  return {
    ...withoutReservedEmailSystemVariables(accountingDefaults),
    ...withoutReservedEmailSystemVariables(templateDefaults),
    ...withoutReservedEmailSystemVariables(composeOverrides),
    ...systemVariables,
  }
}
