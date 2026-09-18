import { formatInTimeZone } from 'date-fns-tz'

const APP_TIME_ZONE = 'Asia/Ho_Chi_Minh'

export type Price = number | { min: number; max: number }

export type EmailOptionDetail = {
  groupLabel?: string
  optionName: string
  price?: Price
}

export type EmailServiceSelection = {
  itemName: string
  basePrice: Price
  selectedOptionsDetails: EmailOptionDetail[]
}

export type ServiceSelections = EmailServiceSelection[]

export type CartItem = {
  name: string
  options: Array<{ groupLabel?: string; label: string; price: Price }>
  totalPrice: Price
}

export type AppointmentEmailData = {
  customerName: string
  customerEmail: string
  customerPhone: string
  location: string
  requestedStartAt: string | Date
  externalNotes?: string | null
  typeOfBooking: string
  serviceSelections?: ServiceSelections
  salutation?: string
  membership?: string | null
  countryCode: string
}

function normalizePrice(price: Price | undefined): { min: number; max: number } {
  if (price === undefined) return { min: 0, max: 0 }
  if (typeof price === 'number') return { min: price, max: price }
  return price
}

function addPrices(left: Price, right: Price): Price {
  const leftRange = normalizePrice(left)
  const rightRange = normalizePrice(right)
  const min = leftRange.min + rightRange.min
  const max = leftRange.max + rightRange.max
  return min === max ? min : { min, max }
}

export function buildCartItems(selections: ServiceSelections, _translate?: undefined, onlyComplete = true): CartItem[] {
  void onlyComplete
  return selections.map((selection) => {
    const options = selection.selectedOptionsDetails.map((detail) => ({
      groupLabel: detail.groupLabel,
      label: detail.optionName,
      price: detail.price ?? 0,
    }))
    const totalPrice = options.reduce<Price>((total, option) => addPrices(total, option.price), selection.basePrice)
    return { name: selection.itemName, options, totalPrice }
  }).filter((item) => normalizePrice(item.totalPrice).max > 0)
}

export function calculateCartTotal(items: CartItem[]): Price {
  return items.reduce<Price>((total, item) => addPrices(total, item.totalPrice), 0)
}

export function formatBookingDate(value: string | Date): string {
  return formatInTimeZone(value, APP_TIME_ZONE, 'dd-MM-yyyy')
}

export function formatBookingTime(value: string | Date): string {
  return formatInTimeZone(value, APP_TIME_ZONE, 'HH:mm')
}
