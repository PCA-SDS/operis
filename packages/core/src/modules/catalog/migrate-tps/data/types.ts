// Types cho Service Menu - hỗ trợ cấu trúc phân cấp và validation

export type ServiceTab = 'nail' | 'lash' | 'massage' | 'spa' | 'facial' | 'waxing'
export type Requirement = 'required' | 'optional'
export type SelectMode = 'single' | 'multiple'
export type Bundle = 'fixed' | 'semi'

export type Price =
  | number
  | { kind: 'gender'; women: number; men?: number }
  | { kind: 'range'; min: number; max: number }

export type Option = {
  id: string
  name: string
  nameKey?: string
  description?: string
  descriptionKey?: string
  note?: string
  noteKey?: string
  duration?: string
  durationKey?: string
  unit?: string
  unitKey?: string
  price?: Price

  mutuallyExclusive?: string[]
  conflictsWithItems?: string[]
  nextGroups?: OptionGroup[]
}

export type OptionGroup = {
  id: string
  label: string
  labelKey?: string
  requirement: Requirement // required = [M], optional = [O]
  mode: SelectMode // single = [V], multiple = [+M]
  options: Option[]
}

export type Includes = {
  itemId: string
  locked?: boolean
  labelKey?: string
}

export type DetailedSection = {
  titleKey: string
  contentKey: string
}

export type DetailedInfo = DetailedSection[]

export type CategoryType = 'package' | 'service' | 'addon'

export type ServiceItem = {
  id: string
  sku?: string
  name: string
  nameKey?: string
  description?: string
  descriptionKey?: string
  duration?: string
  durationKey?: string

  price?: Price

  optionGroups?: OptionGroup[]

  include?: Includes

  mutuallyExclusiveItems?: string[]

  detailedInfo?: DetailedInfo
}

export type ServiceCategory = {
  id: string
  type?: CategoryType // 'package' | 'service' | 'addon' - for styling and filtering
  label: string
  labelKey?: string
  description?: string
  descriptionKey?: string
  note?: string
  noteKey?: string

  requirement: Requirement
  mode: SelectMode

  bundle?: Bundle
  items: ServiceItem[]
}

export type ServiceTabMenu = {
  tabId: ServiceTab
  label: string
  labelKey?: string
  note?: string
  noteKey?: string
  categories: ServiceCategory[]
}

export type ServiceMenuData = Record<ServiceTab, ServiceTabMenu>

export type ItemSelection = {
  itemId: string
  categoryId: string
  optionSelections?: OptionSelection[]
}

export type OptionSelection = {
  groupId: string
  optionIds: string[]
}

export type TabSelection = {
  tabId: ServiceTab
  items: ItemSelection[]
}

export function getPrice(price: Price | undefined, gender: 'women' | 'men' = 'women'): number {
  if (!price) return 0
  if (typeof price === 'number') return price
  if ('kind' in price) {
    if (price.kind === 'range') return price.min
    if (price.kind === 'gender') {
      if (gender === 'men' && price.men !== undefined) return price.men
      return price.women
    }
  }
  return 0
}

export function formatPrice(price: number): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(price)
}

export function formatPriceDisplay(price: Price | undefined, gender: 'women' | 'men' = 'women'): string {
  if (!price) return ''
  if (typeof price === 'number') return formatPrice(price)
  if ('kind' in price) {
    if (price.kind === 'range') {
      return `${formatPrice(price.min)} - ${formatPrice(price.max)}`
    }
    if (price.kind === 'gender') {
      const val = gender === 'men' && price.men !== undefined ? price.men : price.women
      return formatPrice(val)
    }
  }
  return ''
}
