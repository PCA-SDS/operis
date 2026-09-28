export type TaxRateOption = {
  id: string
  name: string
  code: string | null
  rate: number | null
  isDefault: boolean
}

export const mergeTaxRateOptions = (
  options: TaxRateOption[],
  selected: TaxRateOption | null,
): TaxRateOption[] => {
  if (!selected) return options
  if (options.some((option) => option.id === selected.id)) return options
  return [selected, ...options]
}
