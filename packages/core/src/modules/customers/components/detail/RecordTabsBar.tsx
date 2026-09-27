"use client"

import * as React from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dropdown } from '@open-mercato/ui/primitives/dropdown'
import { Tabs, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import type { SectionAction } from '@open-mercato/ui/backend/detail'
import { useZoneToggleSlot } from '@open-mercato/ui/backend/crud/CollapsibleZoneLayout'

export type RecordTab = {
  id: string
  label: string
  count?: React.ReactNode
}

export type RecordTabsBarProps = {
  tabs: RecordTab[]
  activeTab: string
  onTabChange: (tab: string) => void
  ariaLabel: string
  sectionAction?: SectionAction | null
}

/** The underline strip's `gap-4` between tabs. */
const TAB_GAP = 16

type TabsPlan = { visible: string[]; overflow: string[] }

/**
 * Which tabs fit in `available` pixels, in their own order, with the rest
 * behind a "More" menu `moreWidth` wide. The active tab always stays in view:
 * when it would overflow, it takes the last place before "More".
 */
export function planRecordTabs(
  ids: string[],
  widths: Record<string, number>,
  available: number,
  moreWidth: number,
  activeId: string,
): TabsPlan {
  const widthOf = (id: string) => widths[id] ?? 0
  const total = ids.reduce((sum, id, index) => sum + widthOf(id) + (index > 0 ? TAB_GAP : 0), 0)
  if (available <= 0 || total <= available) return { visible: ids, overflow: [] }
  const budget = available - moreWidth - TAB_GAP
  const active = ids.includes(activeId) ? activeId : null
  const kept = new Set<string>(active ? [active] : [])
  let used = active ? widthOf(active) : 0
  for (const id of ids) {
    if (id === active) continue
    const next = used + (kept.size > 0 ? TAB_GAP : 0) + widthOf(id)
    if (next > budget) break
    kept.add(id)
    used = next
  }
  return {
    visible: ids.filter((id) => kept.has(id)),
    overflow: ids.filter((id) => !kept.has(id)),
  }
}

type Measurement = { signature: string; widths: Record<string, number>; moreWidth: number }

/**
 * The tab strip of a customer record (person, company, deal): text tabs with
 * a quiet count, one weight in every state so selecting a tab moves nothing,
 * and the tabs that do not fit behind a "More" menu instead of scrolling out
 * of sight. The tab's own action (Add address, Add person) sits at the end.
 *
 * Widths are measured once per set of labels, before paint, by laying every
 * tab out in a pass the reader never sees; resizing only re-plans from them.
 */
export function RecordTabsBar({ tabs, activeTab, onTabChange, ariaLabel, sectionAction = null }: RecordTabsBarProps) {
  const t = useT()
  const zoneToggle = useZoneToggleSlot()
  const stripRef = React.useRef<HTMLDivElement>(null)
  const moreRef = React.useRef<HTMLDivElement>(null)
  const [available, setAvailable] = React.useState(0)
  const [measurement, setMeasurement] = React.useState<Measurement | null>(null)
  const signature = tabs.map((tab) => `${tab.id}\u0000${tab.label}\u0000${tab.count ?? ''}`).join('\u0001')
  const measuring = measurement?.signature !== signature

  React.useLayoutEffect(() => {
    if (!measuring) return
    // The measuring pass lays every tab out in order, so the triggers line
    // up with `tabs` one for one.
    const triggers = stripRef.current?.querySelectorAll<HTMLElement>('[data-slot="tabs-trigger"]') ?? []
    const widths: Record<string, number> = {}
    tabs.forEach((tab, index) => {
      widths[tab.id] = triggers[index]?.getBoundingClientRect().width ?? 0
    })
    setMeasurement({ signature, widths, moreWidth: moreRef.current?.getBoundingClientRect().width ?? 0 })
  }, [measuring, signature, tabs])

  React.useLayoutEffect(() => {
    const node = stripRef.current
    if (!node) return
    setAvailable(node.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setAvailable(entry.contentRect.width)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const plan = React.useMemo<TabsPlan>(() => {
    const ids = tabs.map((tab) => tab.id)
    if (measuring || !measurement) return { visible: ids, overflow: [] }
    return planRecordTabs(ids, measurement.widths, available, measurement.moreWidth, activeTab)
  }, [activeTab, available, measurement, measuring, tabs])

  const tabById = React.useMemo(() => new Map(tabs.map((tab) => [tab.id, tab])), [tabs])
  const visibleTabs = plan.visible.map((id) => tabById.get(id)).filter((tab): tab is RecordTab => Boolean(tab))
  const overflowTabs = plan.overflow.map((id) => tabById.get(id)).filter((tab): tab is RecordTab => Boolean(tab))
  const showMore = measuring || overflowTabs.length > 0

  return (
    <div className="flex items-center gap-3">
      {/* Inside a record's split view, the button that shows and hides the
          details panel leads this row, and the content under it spans the
          full width. */}
      {zoneToggle ? <div data-zone-toggle="" className="shrink-0">{zoneToggle}</div> : null}
      <div className="flex min-w-0 flex-1 items-end gap-3 border-b">
        {/* Clipped across only, so each tab's underline still sits on the rule. */}
        <div ref={stripRef} className="flex min-w-0 flex-1 items-end overflow-x-clip">
          <Tabs value={activeTab} onValueChange={onTabChange} variant="underline" className="min-w-0">
            <TabsList aria-label={ariaLabel} className="-mb-px border-b-0">
              {visibleTabs.map((tab) => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="shrink-0 font-medium hover:bg-transparent hover:text-foreground"
                >
                  <span>{tab.label}</span>
                  {tab.count !== undefined && tab.count !== null ? (
                    <span className="ml-1.5 tabular-nums text-muted-foreground">{tab.count}</span>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {showMore ? (
            <div ref={moreRef} className={cn('ml-4 shrink-0 self-center', measuring && 'invisible')} aria-hidden={measuring ? true : undefined}>
              <Dropdown<string>
                variant="ghost"
                value={null}
                onChange={(next) => {
                  if (next) onTabChange(next)
                }}
                options={overflowTabs.map((tab) => ({
                  value: tab.id,
                  label: tab.label,
                  trailing: tab.count !== undefined && tab.count !== null
                    ? <span className="tabular-nums text-muted-foreground">{tab.count}</span>
                    : undefined,
                }))}
                placeholder={t('customers.detail.tabs.more', 'More')}
                ariaLabel={t('customers.detail.tabs.moreAria', 'More sections')}
                triggerLeading={false}
                align="end"
                triggerClassName="px-3 text-muted-foreground hover:bg-transparent hover:text-foreground"
              />
            </div>
          ) : null}
        </div>
        {sectionAction ? (
          <Button
            type="button"
            variant="soft"
            onClick={sectionAction.onClick}
            disabled={sectionAction.disabled}
            className="mb-0.5 shrink-0"
          >
            <Plus className="size-4" />
            {sectionAction.label}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export default RecordTabsBar
