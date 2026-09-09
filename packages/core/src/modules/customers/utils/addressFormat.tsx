import type { CustomerAddressFormat } from '../data/entities'

export {
  AddressView,
  formatAddressJson,
  formatAddressLines,
  formatAddressString,
} from '@open-mercato/ui/backend/detail/addressFormat'
export type { AddressJsonShape, AddressValue } from '@open-mercato/ui/backend/detail/addressFormat'

/**
 * The design-system formatter is generic over `'line_first' | 'street_first'`;
 * inside customers the strategy is whatever the `CustomerEntity.addressFormat`
 * column stores, so the alias keeps that binding at the module boundary.
 */
export type AddressFormatStrategy = CustomerAddressFormat
