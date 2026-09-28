export type DraftAddressState = {
  name: string
  purpose: string
  companyName: string
  addressLine1: string
  addressLine2: string
  buildingNumber: string
  flatNumber: string
  city: string
  region: string
  postalCode: string
  country: string
  latitude: string
  longitude: string
  isPrimary: boolean
}

export type DraftFieldKey = keyof DraftAddressState

export type AddressValidationDetail = {
  path?: Array<string | number>
  code?: string
  message?: string
  minimum?: number
  maximum?: number
  type?: string
}

export const defaultAddressDraft: DraftAddressState = {
  name: '',
  purpose: '',
  companyName: '',
  addressLine1: '',
  addressLine2: '',
  buildingNumber: '',
  flatNumber: '',
  city: '',
  region: '',
  postalCode: '',
  country: '',
  latitude: '',
  longitude: '',
  isPrimary: false,
}

/** Maps the first segment of a server validation path to the draft field it belongs to. */
export const addressServerFieldMap: Record<string, DraftFieldKey> = {
  name: 'name',
  purpose: 'purpose',
  companyName: 'companyName',
  addressLine1: 'addressLine1',
  addressLine2: 'addressLine2',
  buildingNumber: 'buildingNumber',
  flatNumber: 'flatNumber',
  city: 'city',
  region: 'region',
  postalCode: 'postalCode',
  country: 'country',
  latitude: 'latitude',
  longitude: 'longitude',
  isPrimary: 'isPrimary',
}

export function extractValidationDetails(error: unknown): AddressValidationDetail[] {
  if (!error || typeof error !== 'object') return []
  const candidate = (error as { details?: unknown }).details
  if (!Array.isArray(candidate)) return []
  return candidate
    .map((entry) => (entry && typeof entry === 'object' ? (entry as AddressValidationDetail) : null))
    .filter((entry): entry is AddressValidationDetail => entry !== null)
}
