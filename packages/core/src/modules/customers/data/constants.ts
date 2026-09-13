/** TPS / booking origin — stored on CRM customer profile. */
export const CUSTOMER_ORIGIN_OPTIONS = [
  { value: 'local', label: 'Local' },
  { value: 'tourist', label: 'Tourist' },
  { value: 'expatriate', label: 'Expatriate' },
] as const

export type CustomerOrigin = (typeof CUSTOMER_ORIGIN_OPTIONS)[number]['value']

export const CUSTOMER_ORIGIN_CODES = CUSTOMER_ORIGIN_OPTIONS.map((option) => option.value) as [
  CustomerOrigin,
  ...CustomerOrigin[],
]
