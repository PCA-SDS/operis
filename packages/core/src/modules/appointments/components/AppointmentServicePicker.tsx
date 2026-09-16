"use client"

import * as React from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { BookableService } from '@open-mercato/core/modules/catalog/lib/bookableServices'

import { formatCurrency } from '@open-mercato/ui/utils/format'

export type AppointmentBookableService = Pick<BookableService,
  'id' | 'title' | 'subtitle' | 'description' | 'sku' | 'categoryPath' | 'categoryId' | 'categoryName' |
  'durationMinutes' | 'unitPriceGross' | 'currencyCode' | 'optionGroups'>

type CategoryGroup = {
  id: string
  label: string
  note: string | null
  services: AppointmentBookableService[]
}
type ServiceTab = { id: string; label: string; categories: CategoryGroup[] }

/** Root categories are tabs; each immediate child is an accordion. Deeper products stay under that child. */
function buildServiceTabs(services: AppointmentBookableService[], uncategorized: string, general: string): ServiceTab[] {
  const tabs = new Map<string, ServiceTab>()
  for (const service of services) {
    const [root, child] = service.categoryPath ?? []
    const tabId = root?.id ?? 'uncategorized'
    let tab = tabs.get(tabId)
    if (!tab) {
      tab = { id: tabId, label: root?.name ?? uncategorized, categories: [] }
      tabs.set(tabId, tab)
    }
    const categoryId = child?.id ?? `${tabId}:general`
    let category = tab.categories.find((entry) => entry.id === categoryId)
    if (!category) {
      category = { id: categoryId, label: child?.name ?? general, note: child?.description ?? root?.description ?? null, services: [] }
      tab.categories.push(category)
    }
    category.services.push(service)
  }
  return [...tabs.values()].sort((a, b) => a.label.localeCompare(b.label)).map((tab) => ({
    ...tab,
    categories: tab.categories.sort((a, b) => a.label.localeCompare(b.label)),
  }))
}

export type AppointmentServiceSelection = {
  productId: string
  selectedOptions?: Record<string, string | string[]>
}

function OptionGroupsEditor({
  groups,
  value,
  onChange,
  disabled,
  currencyCode
}: {
  groups: any[] // BookableServiceOptionGroup[]
  value: Record<string, string | string[]>
  onChange: (val: Record<string, string | string[]>) => void
  disabled?: boolean
  currencyCode?: string | null
}) {
  return (
    <div className="mt-3 space-y-4 pl-3 border-l-2 border-primary/20">
      {groups.map(group => {
        const selectedVal = value[group.id]
        const isMultiple = group.selectMode === 'multiple'
        // For rendering next groups, we need to find which options are currently selected
        const selectedOptionIds = isMultiple 
          ? (Array.isArray(selectedVal) ? selectedVal : [])
          : (typeof selectedVal === 'string' ? [selectedVal] : [])
        
        const selectedOptions = group.options.filter((o: any) => selectedOptionIds.includes(o.id))
        
        return (
          <div key={group.id} className="space-y-2">
            <label className="text-xs font-semibold text-foreground">
              {group.name} {group.requirement === 'required' && <span className="text-destructive">*</span>}
            </label>
            <div className="flex flex-col gap-2">
              {group.options.map((opt: any) => (
                <label key={opt.id} className="flex items-start gap-2 text-sm cursor-pointer hover:bg-muted/50 p-1 -ml-1 rounded">
                  <input
                    type={isMultiple ? 'checkbox' : 'radio'}
                    name={`group-${group.id}`}
                    value={opt.id}
                    checked={selectedOptionIds.includes(opt.id)}
                    disabled={disabled}
                    onChange={(e) => {
                      const next = { ...value }
                      if (isMultiple) {
                         const current = Array.isArray(next[group.id]) ? next[group.id] as string[] : []
                         if (e.target.checked) next[group.id] = [...current, opt.id]
                         else next[group.id] = current.filter(x => x !== opt.id)
                      } else {
                         next[group.id] = opt.id
                      }
                      onChange(next)
                    }}
                    className="mt-1"
                  />
                  <span className="flex-1">
                    <span className="block">{opt.name}</span>
                    {opt.description && <span className="block text-xs text-muted-foreground">{opt.description}</span>}
                  </span>
                  {opt.priceFlat != null && <span className="text-xs font-medium text-muted-foreground">+{formatCurrency(opt.priceFlat, currencyCode)}</span>}
                </label>
              ))}
            </div>
            {selectedOptions.map((opt: any) => {
              if (!opt.nextGroups || opt.nextGroups.length === 0) return null
              return (
                <OptionGroupsEditor
                  key={`next-${opt.id}`}
                  groups={opt.nextGroups}
                  value={value}
                  onChange={onChange}
                  disabled={disabled}
                  currencyCode={currencyCode}
                />
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

export function AppointmentServicePicker({
  services, loading = false, emptyLabel, value, onChange, className = '', disabled = false,
}: {
  services: AppointmentBookableService[]
  loading?: boolean
  emptyLabel: string
  value: AppointmentServiceSelection[]
  onChange: (next: AppointmentServiceSelection[]) => void
  className?: string
  disabled?: boolean
}) {
  const t = useT()
  const instanceId = React.useId()
  const [activeTabId, setActiveTabId] = React.useState<string | null>(null)
  const [openCategories, setOpenCategories] = React.useState<Set<string>>(new Set())
  const [searchTerm, setSearchTerm] = React.useState('')
  const [searchVisible, setSearchVisible] = React.useState(false)
  const selected = new Set(value.map((v) => v.productId))
  const tabs = buildServiceTabs(services,
    t('appointments.services.uncategorized', 'Uncategorized'),
    t('appointments.services.general', 'Services'))
  const currentTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]
  const query = searchTerm.trim().toLocaleLowerCase()
  const results = query ? tabs.flatMap((tab) => tab.categories.flatMap((category) => {
    const categoryMatch = category.label.toLocaleLowerCase().includes(query)
    return category.services.filter((service) => categoryMatch || service.title.toLocaleLowerCase().includes(query) || service.sku?.toLocaleLowerCase().includes(query))
      .map((service) => ({ tab, category, service }))
  })) : []
  const selectedServices = services.filter((service) => selected.has(service.id))

  function toggleService(id: string) {
    if (selected.has(id)) {
      onChange(value.filter((v) => v.productId !== id))
    } else {
      onChange([...value, { productId: id }])
    }
  }
  function toggleCategory(id: string) {
    setOpenCategories((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (loading || !currentTab) return <p role="status" className="text-sm text-muted-foreground">{emptyLabel}</p>

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex flex-wrap gap-2" aria-label={t('appointments.services.categories', 'Service categories')}>
        {tabs.map((tab) => {
          const count = tab.categories.flatMap((category) => category.services).filter((service) => selected.has(service.id)).length
          return <Button key={tab.id} type="button" size="sm" variant={currentTab.id === tab.id ? 'default' : 'outline'}
            aria-pressed={currentTab.id === tab.id} disabled={disabled} onClick={() => setActiveTabId(tab.id)}>
            {tab.label}{count > 0 && <span className="ml-1.5 rounded bg-primary-foreground/20 px-1.5 py-0.5 text-xs">{count}</span>}
          </Button>
        })}
      </div>

      <div className="relative" onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSearchVisible(false)
      }} onKeyDown={(event) => { if (event.key === 'Escape') setSearchVisible(false) }}>
        <SearchInput value={searchTerm} disabled={disabled}
          aria-label={t('appointments.services.search', 'Search by name or SKU...')}
          placeholder={t('appointments.services.search', 'Search by name or SKU...')}
          onChange={(next) => { setSearchTerm(next); setSearchVisible(true) }}
          onFocus={() => setSearchVisible(true)} onClear={() => { setSearchTerm(''); setSearchVisible(false) }} />
        {searchVisible && query && <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[400px] overflow-y-auto rounded-lg border bg-card shadow-lg">
          <div className="border-b bg-muted/50 p-2 text-xs text-muted-foreground" role="status">
            {results.length ? t('appointments.services.results', 'Found {count} result(s)', { count: results.length }) : t('appointments.services.noResults', 'No services found')}
          </div>
          {results.map(({ tab, category, service }) => <Button key={service.id} type="button" variant="ghost" disabled={disabled}
            className="h-auto w-full justify-start gap-3 rounded-none px-4 py-2.5 text-left whitespace-normal"
            onClick={() => {
              setActiveTabId(tab.id)
              setOpenCategories((previous) => new Set([...previous, category.id]))
              setSearchVisible(false)
              setSearchTerm('')
              requestAnimationFrame(() => document.getElementById(`${instanceId}-service-${service.id}`)?.focus())
            }}>
            <span className="rounded bg-primary/10 px-2 py-1 text-xs text-primary">{category.label}</span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{service.title} {service.sku && <code className="text-xs text-muted-foreground">{service.sku}</code>}</span>
              <span className="block text-xs text-muted-foreground">{tab.label}</span></span>
          </Button>)}
        </div>}
      </div>

      <div className="space-y-2">
        {currentTab.categories.map((category) => {
          const isOpen = openCategories.has(category.id)
          return <div key={category.id} className="overflow-hidden rounded-lg border">
            <Button type="button" variant="ghost" disabled={disabled} aria-expanded={isOpen}
              aria-controls={`${instanceId}-category-${category.id}`} onClick={() => toggleCategory(category.id)}
              className="h-auto w-full justify-between rounded-none p-3 text-left whitespace-normal">
              <span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-sm font-semibold">
                {category.label}{category.services.some((service) => selected.has(service.id)) && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
              </span>{category.note && <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{category.note}</span>}</span>
              <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </Button>
            <div id={`${instanceId}-category-${category.id}`} hidden={!isOpen} className="border-t">
              {category.services.map((service) => (
                <div key={service.id} className="border-b last:border-b-0">
                  <Button id={`${instanceId}-service-${service.id}`}
                    type="button" variant="ghost" disabled={disabled} aria-pressed={selected.has(service.id)} onClick={() => toggleService(service.id)}
                    className={`flex h-auto w-full items-start justify-between gap-3 rounded-none p-3 pl-6 text-left whitespace-normal ${selected.has(service.id) ? 'bg-primary/5' : ''}`}>
                    <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 text-sm font-medium">{service.title}
                      {service.sku && <span className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{service.sku}</span>}
                      {selected.has(service.id) && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
                    </span>{service.description && <span className="mt-0.5 block whitespace-pre-line text-xs font-normal text-muted-foreground">{service.description}</span>}
                      {service.durationMinutes != null && <span className="block text-xs font-normal text-muted-foreground">{t('appointments.services.duration', '{count} min', { count: service.durationMinutes })}</span>}
                      {!selected.has(service.id) && service.optionGroups?.length > 0 && <span className="mt-1 block text-xs font-medium text-primary">{t('appointments.services.hasOptions', 'Includes configurable options')}</span>}
                    </span>
                    {service.unitPriceGross != null && <span className="whitespace-nowrap text-sm font-semibold">{service.unitPriceGross} {service.currencyCode}</span>}
                  </Button>
                  
                  {selected.has(service.id) && service.optionGroups?.length > 0 && (
                    <div className="px-3 pb-3 pl-6 bg-primary/5">
                      <OptionGroupsEditor
                        groups={service.optionGroups}
                        value={value.find((v) => v.productId === service.id)?.selectedOptions ?? {}}
                        onChange={(newOptions) => {
                          const next = value.map((v) => {
                            if (v.productId === service.id) {
                              return { ...v, selectedOptions: newOptions }
                            }
                            return v
                          })
                          onChange(next)
                        }}
                        disabled={disabled}
                        currencyCode={service.currencyCode}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        })}
      </div>

      {selectedServices.length > 0 && <div className="rounded-lg bg-muted/50 p-3">
        <div className="mb-2 text-sm font-medium">{t('appointments.services.selected', 'Selected Services ({count})', { count: selectedServices.length })}</div>
        <div className="flex flex-wrap gap-1.5">{selectedServices.map((service) => <div key={service.id} className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs">
          <span className="text-muted-foreground">{service.categoryPath?.[0]?.name ?? t('appointments.services.uncategorized', 'Uncategorized')}:</span>
          <span>{service.title}</span><IconButton type="button" variant="ghost" size="xs" disabled={disabled}
            aria-label={t('appointments.services.remove', 'Remove {name}', { name: service.title })} onClick={() => toggleService(service.id)}><X /></IconButton>
        </div>)}</div>
      </div>}
    </div>
  )
}

export default AppointmentServicePicker
