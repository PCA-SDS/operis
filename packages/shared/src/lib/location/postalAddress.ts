/** The postal address columns an address record carries, `null` where unset. */
export type PostalAddressFields = {
  name: string | null
  purpose: string | null
  companyName: string | null
  addressLine1: string
  addressLine2: string | null
  buildingNumber: string | null
  flatNumber: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
  isPrimary: boolean
}

/** A stored address, whose optional columns may be absent. */
export type PostalAddressRecord = {
  name?: string | null
  purpose?: string | null
  companyName?: string | null
  addressLine1: string
  addressLine2?: string | null
  buildingNumber?: string | null
  flatNumber?: string | null
  city?: string | null
  region?: string | null
  postalCode?: string | null
  country?: string | null
  latitude?: number | null
  longitude?: number | null
  isPrimary: boolean
}

/** A partial update: an `undefined` field is left as it is, `null` clears it. */
export type PostalAddressPatch = {
  name?: string | null
  purpose?: string | null
  companyName?: string | null
  addressLine1?: string
  addressLine2?: string | null
  buildingNumber?: string | null
  flatNumber?: string | null
  city?: string | null
  region?: string | null
  postalCode?: string | null
  country?: string | null
  latitude?: number | null
  longitude?: number | null
  isPrimary?: boolean
}

export function readPostalAddressFields(record: PostalAddressRecord): PostalAddressFields {
  return {
    name: record.name ?? null,
    purpose: record.purpose ?? null,
    companyName: record.companyName ?? null,
    addressLine1: record.addressLine1,
    addressLine2: record.addressLine2 ?? null,
    buildingNumber: record.buildingNumber ?? null,
    flatNumber: record.flatNumber ?? null,
    city: record.city ?? null,
    region: record.region ?? null,
    postalCode: record.postalCode ?? null,
    country: record.country ?? null,
    latitude: record.latitude ?? null,
    longitude: record.longitude ?? null,
    isPrimary: record.isPrimary,
  }
}

/** Writes every postal address field of a snapshot back onto a record (undo/redo). */
export function assignPostalAddressFields(target: PostalAddressRecord, fields: PostalAddressFields): void {
  target.name = fields.name
  target.purpose = fields.purpose
  target.companyName = fields.companyName
  target.addressLine1 = fields.addressLine1
  target.addressLine2 = fields.addressLine2
  target.buildingNumber = fields.buildingNumber
  target.flatNumber = fields.flatNumber
  target.city = fields.city
  target.region = fields.region
  target.postalCode = fields.postalCode
  target.country = fields.country
  target.latitude = fields.latitude
  target.longitude = fields.longitude
  target.isPrimary = fields.isPrimary
}

export function applyPostalAddressPatch(target: PostalAddressRecord, patch: PostalAddressPatch): void {
  if (patch.name !== undefined) target.name = patch.name ?? null
  if (patch.purpose !== undefined) target.purpose = patch.purpose ?? null
  if (patch.companyName !== undefined) target.companyName = patch.companyName ?? null
  if (patch.addressLine1 !== undefined) target.addressLine1 = patch.addressLine1
  if (patch.addressLine2 !== undefined) target.addressLine2 = patch.addressLine2 ?? null
  if (patch.buildingNumber !== undefined) target.buildingNumber = patch.buildingNumber ?? null
  if (patch.flatNumber !== undefined) target.flatNumber = patch.flatNumber ?? null
  if (patch.city !== undefined) target.city = patch.city ?? null
  if (patch.region !== undefined) target.region = patch.region ?? null
  if (patch.postalCode !== undefined) target.postalCode = patch.postalCode ?? null
  if (patch.country !== undefined) target.country = patch.country ?? null
  if (patch.latitude !== undefined) target.latitude = patch.latitude ?? null
  if (patch.longitude !== undefined) target.longitude = patch.longitude ?? null
  if (patch.isPrimary !== undefined) target.isPrimary = patch.isPrimary
}
