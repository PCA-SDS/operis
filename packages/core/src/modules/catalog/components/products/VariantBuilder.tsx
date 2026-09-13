"use client"

import * as React from 'react'
import { flushSync } from 'react-dom'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Label } from '@open-mercato/ui/primitives/label'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Switch } from '@open-mercato/ui/primitives/switch'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@open-mercato/ui/primitives/segmented-control'
import { ProductMediaManager } from './ProductMediaManager'
import { MetadataEditor } from './MetadataEditor'
import type { PriceKindSummary, TaxRateSummary } from './productForm'
import { formatTaxRateLabel } from './productForm'
import type { OptionDefinition, VariantFormValues, VariantPriceDraft } from './variantForm'
import { CATALOG_GTIN_TYPES } from '../../data/types'
import { E } from '#generated/entities.ids.generated'
import { CATALOG_DURATION_UNIT_OPTIONS, DEFAULT_CATALOG_DURATION_UNIT } from '../../lib/durationUnits'

type VariantBuilderProps = {
  values: VariantFormValues
  setValue: (id: string, value: unknown) => void
  errors: Record<string, string>
  optionDefinitions: OptionDefinition[]
  priceKinds: PriceKindSummary[]
  taxRates: TaxRateSummary[]
}

type VariantSectionBaseProps = {
  values: VariantFormValues
  setValue: (id: string, value: unknown) => void
  errors: Record<string, string>
}

type VariantOptionValuesSectionProps = {
  values: VariantFormValues
  setValue: (id: string, value: unknown) => void
  optionDefinitions: OptionDefinition[]
  showHeading?: boolean
}

type VariantDimensionsSectionProps = {
  values: VariantFormValues
  setValue: (id: string, value: unknown) => void
  showHeading?: boolean
}

type VariantDurationSectionProps = {
  values: VariantFormValues
  setValue: (id: string, value: unknown) => void
  showHeading?: boolean
}

type VariantMetadataSectionProps = {
  values: VariantFormValues
  setValue: (id: string, value: unknown) => void
  showIntro?: boolean
  embedded?: boolean
}

type VariantPricesSectionProps = {
  values: VariantFormValues
  setValue: (id: string, value: unknown) => void
  priceKinds: PriceKindSummary[]
  taxRates: TaxRateSummary[]
  showHeader?: boolean
  embedded?: boolean
}

type VariantMediaSectionProps = {
  values: VariantFormValues
  setValue: (id: string, value: unknown) => void
  showLabel?: boolean
}

export function VariantBuilder({
  values,
  setValue,
  errors,
  optionDefinitions,
  priceKinds,
  taxRates,
}: VariantBuilderProps) {
  return (
    <div className="space-y-6">
      <VariantBasicsSection values={values} setValue={setValue} errors={errors} />
      <VariantOptionValuesSection values={values} setValue={setValue} optionDefinitions={optionDefinitions} />
      <VariantDurationSection values={values} setValue={setValue} />
      <VariantDimensionsSection values={values} setValue={setValue} />
      <VariantMetadataSection values={values} setValue={setValue} />
      <VariantPricesSection values={values} setValue={setValue} priceKinds={priceKinds} taxRates={taxRates} />
      <VariantMediaSection values={values} setValue={setValue} />
    </div>
  )
}

export function VariantBasicsSection({ values, setValue, errors }: VariantSectionBaseProps) {
  const t = useT()
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label className="flex items-center gap-1">
          {t('catalog.variants.form.nameLabel', 'Name')}
          <span className="text-status-error-text">*</span>
        </Label>
        <Input
          value={values.name}
          onChange={(event) => setValue('name', event.target.value)}
          placeholder={t('catalog.variants.form.namePlaceholder', 'e.g., Blue / Small')}
        />
        {errors.name ? <p className="text-xs text-status-error-text">{errors.name}</p> : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>{t('catalog.variants.form.skuLabel', 'SKU')}</Label>
          <Input
            value={values.sku}
            onChange={(event) => setValue('sku', event.target.value)}
            placeholder={t('catalog.variants.form.skuPlaceholder', 'Unique identifier')}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('catalog.variants.form.barcodeLabel', 'Barcode')}</Label>
          <Input
            value={values.barcode}
            onChange={(event) => setValue('barcode', event.target.value)}
            placeholder={t('catalog.variants.form.barcodePlaceholder', 'EAN, UPC, etc.')}
          />
          {errors.barcode ? <p className="text-xs text-status-error-text">{errors.barcode}</p> : null}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="catalog-variant-gtin-type">
            {t('catalog.variants.form.gtinTypeLabel', 'Identifier type (GTIN)')}
          </Label>
          <Select
            value={values.gtinType ?? 'none'}
            onValueChange={(value) => setValue('gtinType', value === 'none' ? null : value)}
          >
            <SelectTrigger id="catalog-variant-gtin-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('catalog.variants.form.gtinTypeNone', 'Untyped')}</SelectItem>
              {CATALOG_GTIN_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(`catalog.variants.form.gtinTypes.${type}`, type.toUpperCase())}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t(
              'catalog.variants.form.gtinTypeHint',
              'Typed barcodes are validated and kept unique per organization.',
            )}
          </p>
          {errors.gtinType ? <p className="text-xs text-status-error-text">{errors.gtinType}</p> : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="catalog-variant-hs-code">
            {t('catalog.variants.form.hsCodeLabel', 'HS code (customs tariff)')}
          </Label>
          <Input
            id="catalog-variant-hs-code"
            value={values.hsCode}
            onChange={(event) => setValue('hsCode', event.target.value)}
          />
          {errors.hsCode ? <p className="text-xs text-status-error-text">{errors.hsCode}</p> : null}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex items-center justify-between gap-2 rounded border px-3 py-2">
          <div>
            <p className="text-sm font-medium">{t('catalog.variants.form.isDefaultLabel', 'Default variant')}</p>
            <p className="text-xs text-muted-foreground">{t('catalog.variants.form.isDefaultHint', 'Used in storefronts')}</p>
          </div>
          <Switch checked={values.isDefault} onCheckedChange={(next) => setValue('isDefault', next)} />
        </label>
        <label className="flex items-center justify-between gap-2 rounded border px-3 py-2">
          <div>
            <p className="text-sm font-medium">{t('catalog.variants.form.isActiveLabel', 'Active')}</p>
            <p className="text-xs text-muted-foreground">{t('catalog.variants.form.isActiveHint', 'Inactive variants stay hidden')}</p>
          </div>
          <Switch checked={values.isActive !== false} onCheckedChange={(next) => setValue('isActive', next)} />
        </label>
      </div>
    </div>
  )
}

export function VariantOptionValuesSection({
  values,
  setValue,
  optionDefinitions,
  showHeading = true,
}: VariantOptionValuesSectionProps) {
  const t = useT()

  const handleOptionChange = React.useCallback(
    (code: string, next: string) => {
      setValue('optionValues', { ...(values.optionValues ?? {}), [code]: next })
    },
    [setValue, values.optionValues],
  )

  if (!optionDefinitions.length) return null

  return (
    <div className="space-y-3">
      {showHeading ? <h3 className="text-sm font-semibold">{t('catalog.variants.form.options', 'Option values')}</h3> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {optionDefinitions.map((option) => (
          <div key={option.code} className="space-y-2">
            <Label className="text-xs uppercase text-muted-foreground">{option.label}</Label>
            <Select
              value={values.optionValues?.[option.code] || undefined}
              onValueChange={(value) => handleOptionChange(option.code, value ?? '')}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('catalog.variants.form.optionPlaceholder', 'Select value')} />
              </SelectTrigger>
              <SelectContent>
                {option.values.map((value) => (
                  <SelectItem key={value.id} value={value.label}>
                    {value.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </div>
  )
}

export function VariantDurationSection({ values, setValue, showHeading = true }: VariantDurationSectionProps) {
  const t = useT()

  const hasRangeDuration = !!(values.durationMin || values.durationMax)
  const [durationMode, setDurationMode] = React.useState<'fixed' | 'range'>(
    hasRangeDuration ? 'range' : 'fixed',
  )

  return (
    <div className="space-y-3">
      {showHeading ? (
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">
            {t('catalog.variants.form.duration', 'Duration')}
          </h3>
          <SegmentedControl
            value={durationMode}
            onValueChange={(v) => setDurationMode(v as 'fixed' | 'range')}
            aria-label={t('catalog.variants.duration.modeLabel', 'Duration mode')}
            size="sm"
          >
            <SegmentedControlItem value="fixed">
              {t('catalog.variants.form.durationFixed', 'Fixed')}
            </SegmentedControlItem>
            <SegmentedControlItem value="range">
              {t('catalog.variants.form.durationRange', 'Range')}
            </SegmentedControlItem>
          </SegmentedControl>
        </div>
      ) : (
        <SegmentedControl
          value={durationMode}
          onValueChange={(v) => setDurationMode(v as 'fixed' | 'range')}
          aria-label={t('catalog.variants.duration.modeLabel', 'Duration mode')}
          size="sm"
          fullWidth
        >
          <SegmentedControlItem value="fixed">
            {t('catalog.variants.form.durationFixed', 'Fixed')}
          </SegmentedControlItem>
          <SegmentedControlItem value="range">
            {t('catalog.variants.form.durationRange', 'Range')}
          </SegmentedControlItem>
        </SegmentedControl>
      )}

      {durationMode === 'fixed' && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <Input
            type="number"
            min="0"
            className="w-full font-mono"
            placeholder={t('catalog.variants.duration.valuePlaceholder', 'e.g. 60')}
            value={values.durationValue ?? ''}
            onChange={(e) => setValue('durationValue', e.target.value)}
          />
          <Select
            value={values.durationUnit ?? DEFAULT_CATALOG_DURATION_UNIT}
            onValueChange={(val) => setValue('durationUnit', val)}
          >
            <SelectTrigger className="w-28 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATALOG_DURATION_UNIT_OPTIONS.map((unit) => (
                <SelectItem key={unit.value} value={unit.value}>
                  {t(unit.labelKey, unit.labelFallback)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {durationMode === 'range' && (
        <div className="space-y-2">
          <Select
            value={values.durationUnit ?? DEFAULT_CATALOG_DURATION_UNIT}
            onValueChange={(val) => setValue('durationUnit', val)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATALOG_DURATION_UNIT_OPTIONS.map((unit) => (
                <SelectItem key={unit.value} value={unit.value}>
                  {t(unit.labelKey, unit.labelFallback)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
            <Input
              type="number"
              min="0"
              placeholder={t('catalog.products.create.serviceOffering.priceMin', 'Min')}
              className="w-full font-mono"
              value={values.durationMin ?? ''}
              onChange={(e) => setValue('durationMin', e.target.value)}
            />
            <span className="text-muted-foreground shrink-0">–</span>
            <Input
              type="number"
              min="0"
              placeholder={t('catalog.products.create.serviceOffering.priceMax', 'Max')}
              className="w-full font-mono"
              value={values.durationMax ?? ''}
              onChange={(e) => setValue('durationMax', e.target.value)}
            />
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {durationMode === 'range'
          ? t('catalog.products.create.serviceOffering.durationRangeHint', 'Customer sees the estimated time range.')
          : t('catalog.variants.form.durationHint', 'Fill out min and max if the duration varies.')}
      </p>
    </div>
  )
}


export function VariantDimensionsSection({ values, setValue, showHeading = true }: VariantDimensionsSectionProps) {
  const t = useT()
  const metadata = normalizeMetadata(values.metadata)
  const dimensionValues = normalizeDimensions(metadata)
  const weightValues = normalizeWeight(metadata)
  const dimensionUnitPlaceholder = t('catalog.variants.form.dimensionUnitPlaceholder', 'cm')
  const weightUnitPlaceholder = t('catalog.variants.form.weightUnitPlaceholder', 'kg')

  return (
    <div className="space-y-4">
      {showHeading ? <h3 className="text-sm font-semibold">{t('catalog.variants.form.dimensions', 'Dimensions & weight')}</h3> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <DimensionInput
          label={t('catalog.variants.form.width', 'Width')}
          value={dimensionValues.width ?? ''}
          onChange={(value) => setValue('metadata', applyDimension(metadata, 'width', value))}
        />
        <DimensionInput
          label={t('catalog.variants.form.height', 'Height')}
          value={dimensionValues.height ?? ''}
          onChange={(value) => setValue('metadata', applyDimension(metadata, 'height', value))}
        />
        <DimensionInput
          label={t('catalog.variants.form.depth', 'Depth')}
          value={dimensionValues.depth ?? ''}
          onChange={(value) => setValue('metadata', applyDimension(metadata, 'depth', value))}
        />
        <DimensionInput
          label={t('catalog.variants.form.dimensionUnit', 'Size unit')}
          value={dimensionValues.unit ?? ''}
          placeholder={dimensionUnitPlaceholder}
          onChange={(value) => setValue('metadata', applyDimension(metadata, 'unit', value))}
        />
        <DimensionInput
          label={t('catalog.variants.form.weight', 'Weight')}
          value={weightValues.value ?? ''}
          onChange={(value) => setValue('metadata', applyWeight(metadata, 'value', value))}
        />
        <DimensionInput
          label={t('catalog.variants.form.weightUnit', 'Weight unit')}
          value={weightValues.unit ?? ''}
          placeholder={weightUnitPlaceholder}
          onChange={(value) => setValue('metadata', applyWeight(metadata, 'unit', value))}
        />
      </div>
    </div>
  )
}

export function VariantMetadataSection({
  values,
  setValue,
  showIntro = true,
  embedded = false,
}: VariantMetadataSectionProps) {
  const metadata = normalizeMetadata(values.metadata)
  const systemMetadata = React.useMemo(() => extractSystemMetadata(metadata), [metadata])
  const customMetadata = React.useMemo(() => stripSystemMetadata(metadata), [metadata])

  const handleMetadataChange = React.useCallback(
    (next: Record<string, unknown>) => {
      const merged: Record<string, unknown> = {}
      Object.entries(systemMetadata).forEach(([key, value]) => {
        merged[key] = value
      })
      Object.entries(next).forEach(([key, value]) => {
        merged[key] = value
      })
      setValue('metadata', merged)
    },
    [setValue, systemMetadata],
  )

  return (
    <MetadataEditor
      value={customMetadata}
      onChange={handleMetadataChange}
      title={showIntro ? undefined : ''}
      description={showIntro ? undefined : ''}
      embedded={embedded}
    />
  )
}

export function VariantPricesSection({
  values,
  setValue,
  priceKinds,
  taxRates,
  showHeader = true,
  embedded = false,
}: VariantPricesSectionProps) {
  const t = useT()
  const pricesRef = React.useRef(values.prices)

  React.useEffect(() => {
    pricesRef.current = values.prices
  }, [values.prices])

  const updatePrice = React.useCallback(
    (priceKindId: string, patch: Partial<VariantPriceDraft>) => {
      const currentPrices = pricesRef.current ?? {}
      const prev = currentPrices[priceKindId] ?? { priceKindId, amount: '', displayMode: 'excluding-tax' }
      const nextPrices = { ...currentPrices, [priceKindId]: { ...prev, ...patch, priceKindId } }
      pricesRef.current = nextPrices
      flushSync(() => setValue('prices', nextPrices))
    },
    [setValue],
  )

  // Per-kind price mode: 'fixed' | 'range' | 'starting_at'
  const initialPriceModes = React.useMemo(() => {
    const map: Record<string, 'fixed' | 'range' | 'starting_at'> = {}
    for (const kind of priceKinds) {
      const draft = values.prices?.[kind.id]
      if (draft?.priceType === 'starting_at') map[kind.id] = 'starting_at'
      else if (draft?.priceType === 'range' || draft?.priceMin || draft?.priceMax) map[kind.id] = 'range'
      else map[kind.id] = 'fixed'
    }
    return map
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // stable init only

  const [priceModes, setPriceModes] = React.useState<Record<string, 'fixed' | 'range' | 'starting_at'>>(initialPriceModes)
  const setPriceMode = React.useCallback((kindId: string, mode: 'fixed' | 'range' | 'starting_at') => {
    setPriceModes((prev) => ({ ...prev, [kindId]: mode }))
    // sync priceType into draft so it persists on save
    updatePrice(kindId, { priceType: mode === 'fixed' ? 'exact' : mode })
  }, [updatePrice])

  const selectedTaxRate = values.taxRateId
    ? taxRates.find((rate) => rate.id === values.taxRateId) ?? null
    : null
  const fallbackSelectedTaxRate =
    values.taxRateId && !selectedTaxRate
      ? { id: values.taxRateId, name: values.taxRateId, code: null, rate: null, isDefault: false }
      : null
  const displayedSelectedTaxRate = selectedTaxRate ?? fallbackSelectedTaxRate
  const displayedTaxRates = fallbackSelectedTaxRate ? [fallbackSelectedTaxRate, ...taxRates] : taxRates
  const taxRateOptionsKey = displayedTaxRates.map((rate) => `${rate.id}:${formatTaxRateLabel(rate)}`).join('\0')
  const taxRateSelectKey = `variant-tax-rate:${values.taxRateId ?? ''}:${taxRateOptionsKey}`

  const TaxRateSelect = (
    <Select
      key={taxRateSelectKey}
      value={values.taxRateId || undefined}
      onValueChange={(value) => { if (value) setValue('taxRateId', value) }}
    >
      <SelectTrigger className="w-auto">
        <SelectValue placeholder={t('catalog.variants.form.pricesTaxNone', 'No tax override')}>
          {displayedSelectedTaxRate ? formatTaxRateLabel(displayedSelectedTaxRate) : undefined}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {displayedTaxRates.map((rate) => (
          <SelectItem key={rate.id} value={rate.id}>{formatTaxRateLabel(rate)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-4'}>
      {showHeader && (
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">
              {t('catalog.variants.form.pricesLabel', 'Pricing')}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t('catalog.variants.form.pricesHint', 'Populate list prices per price kind.')}
            </p>
          </div>
          {TaxRateSelect}
        </div>
      )}
      {!showHeader && (
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">
            {t('catalog.variants.form.pricesLabel', 'Pricing')}
          </h3>
          {TaxRateSelect}
        </div>
      )}

      <div className="space-y-4">
        {priceKinds.length ? (
          priceKinds.map((kind) => {
            const draft = values.prices?.[kind.id]
            const currencyCode = kind.currencyCode?.toUpperCase() ?? ''
            const kindMode = priceModes[kind.id] ?? 'fixed'

            return (
              <div key={kind.id} className="space-y-2">
                {/* Per-kind header: currency info + toggle */}
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{kind.title}</p>
                    {kind.currencyCode && (
                      <p className="text-xs text-muted-foreground">
                        {`${currencyCode} • ${kind.displayMode === 'including-tax'
                          ? t('catalog.priceKinds.form.displayMode.include', 'Including tax')
                          : t('catalog.priceKinds.form.displayMode.exclude', 'Excluding tax')}`}
                      </p>
                    )}
                  </div>
                  <SegmentedControl
                    value={kindMode}
                    onValueChange={(v) => setPriceMode(kind.id, v as 'fixed' | 'range' | 'starting_at')}
                    aria-label={t('catalog.variants.price.modeLabel', 'Price mode for {kind}').replace('{kind}', kind.title)}
                    size="sm"
                  >
                    <SegmentedControlItem value="fixed">
                      {t('catalog.products.create.variantsBuilder.fixedPrice', 'Fixed')}
                    </SegmentedControlItem>
                    <SegmentedControlItem value="range">
                      {t('catalog.products.create.variantsBuilder.priceRange', 'Range')}
                    </SegmentedControlItem>
                  </SegmentedControl>
                </div>

                {/* Fixed: single amount input */}
                {kindMode === 'fixed' && (
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <span className="text-sm font-medium text-muted-foreground select-none">{currencyCode}</span>
                    </div>
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      className="pl-14 font-mono w-full"
                      placeholder="0.00"
                      value={draft?.amount ?? ''}
                      onInput={(event) => updatePrice(kind.id, { amount: event.currentTarget.value })}
                      onChange={(event) => updatePrice(kind.id, { amount: event.target.value })}
                    />
                  </div>
                )}

                {/* Range: min – max inputs */}
                {kindMode === 'range' && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1 min-w-0">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                          <span className="text-xs font-medium text-muted-foreground select-none">{currencyCode}</span>
                        </div>
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          placeholder={t('catalog.products.create.serviceOffering.priceMin', 'Min')}
                          className="pl-10 w-full font-mono"
                          value={draft?.priceMin ?? ''}
                          onChange={(event) => updatePrice(kind.id, { priceMin: event.target.value })}
                        />
                      </div>
                      <span className="text-muted-foreground shrink-0">–</span>
                      <div className="relative flex-1 min-w-0">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                          <span className="text-xs font-medium text-muted-foreground select-none">{currencyCode}</span>
                        </div>
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          placeholder={t('catalog.products.create.serviceOffering.priceMax', 'Max')}
                          className="pl-10 w-full font-mono"
                          value={draft?.priceMax ?? ''}
                          onChange={(event) => updatePrice(kind.id, { priceMax: event.target.value })}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('catalog.products.create.serviceOffering.priceRangeHint', 'Leave max empty for open-ended pricing.')}
                    </p>
                  </div>
                )}
              </div>
            )
          })
        ) : (
          <p className="text-xs text-muted-foreground">{t('catalog.variants.form.pricesEmpty', 'No price kinds configured yet.')}</p>
        )}
      </div>

    </div>
  )
}

export function VariantMediaSection({ values, setValue, showLabel = true }: VariantMediaSectionProps) {
  const t = useT()
  return (
    <div className="space-y-2">
      {showLabel ? <Label>{t('catalog.variants.form.media', 'Media')}</Label> : null}
      <ProductMediaManager
        entityId={E.catalog.catalog_product_variant}
        draftRecordId={values.mediaDraftId}
        items={Array.isArray(values.mediaItems) ? values.mediaItems : []}
        defaultMediaId={values.defaultMediaId}
        onItemsChange={(next) => setValue('mediaItems', next)}
        onDefaultChange={(next) => setValue('defaultMediaId', next)}
      />
    </div>
  )
}

function DimensionInput({
  label,
  value,
  onChange,
  placeholder = '0',
}: {
  label: string
  value: string | number | undefined
  onChange: (next: string) => void
  placeholder?: string
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase text-muted-foreground">{label}</Label>
      <Input value={value ?? ''} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </div>
  )
}

function normalizeMetadata(input: unknown): Record<string, any> {
  return typeof input === 'object' && input ? { ...(input as Record<string, unknown>) } : {}
}

function normalizeDimensions(metadata: Record<string, any>) {
  const raw = metadata.dimensions
  if (!raw || typeof raw !== 'object') return {}
  return {
    width: typeof raw.width === 'number' ? raw.width : undefined,
    height: typeof raw.height === 'number' ? raw.height : undefined,
    depth: typeof raw.depth === 'number' ? raw.depth : undefined,
    unit: typeof raw.unit === 'string' ? raw.unit : undefined,
  }
}

function normalizeWeight(metadata: Record<string, any>) {
  const raw = metadata.weight
  if (!raw || typeof raw !== 'object') return {}
  return {
    value: typeof raw.value === 'number' ? raw.value : undefined,
    unit: typeof raw.unit === 'string' ? raw.unit : undefined,
  }
}

function applyDimension(metadata: Record<string, any>, field: 'width' | 'height' | 'depth' | 'unit', raw: string) {
  const dims = normalizeDimensions(metadata)
  if (field === 'unit') {
    dims.unit = raw
  } else {
    const numeric = Number(raw)
    dims[field] = Number.isNaN(numeric) ? undefined : numeric
  }
  const clean = cleanupDimensions(dims)
  if (clean) return { ...metadata, dimensions: clean }
  const copy = { ...metadata }
  delete copy.dimensions
  return copy
}

function applyWeight(metadata: Record<string, any>, field: 'value' | 'unit', raw: string) {
  const weight = normalizeWeight(metadata)
  if (field === 'unit') weight.unit = raw
  else {
    const numeric = Number(raw)
    weight.value = Number.isNaN(numeric) ? undefined : numeric
  }
  const clean = cleanupWeight(weight)
  if (clean) return { ...metadata, weight: clean }
  const copy = { ...metadata }
  delete copy.weight
  return copy
}

function cleanupDimensions(dims: { width?: number; height?: number; depth?: number; unit?: string }) {
  const clean: Record<string, unknown> = {}
  if (typeof dims.width === 'number' && Number.isFinite(dims.width)) clean.width = dims.width
  if (typeof dims.height === 'number' && Number.isFinite(dims.height)) clean.height = dims.height
  if (typeof dims.depth === 'number' && Number.isFinite(dims.depth)) clean.depth = dims.depth
  if (typeof dims.unit === 'string' && dims.unit.trim().length) clean.unit = dims.unit
  return Object.keys(clean).length ? clean : null
}

function cleanupWeight(weight: { value?: number; unit?: string }) {
  const clean: Record<string, unknown> = {}
  if (typeof weight.value === 'number' && Number.isFinite(weight.value)) clean.value = weight.value
  if (typeof weight.unit === 'string' && weight.unit.trim().length) clean.unit = weight.unit
  return Object.keys(clean).length ? clean : null
}

function stripSystemMetadata(metadata: Record<string, any>) {
  const copy: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (key === 'dimensions' || key === 'weight') continue
    copy[key] = value
  }
  return copy
}

function extractSystemMetadata(metadata: Record<string, any>) {
  const system: Record<string, unknown> = {}
  if (metadata.dimensions) system.dimensions = metadata.dimensions
  if (metadata.weight) system.weight = metadata.weight
  return system
}
