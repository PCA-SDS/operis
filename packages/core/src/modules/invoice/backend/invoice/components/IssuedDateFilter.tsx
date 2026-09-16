'use client'

import * as React from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useLocale } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { useInvoiceT } from '../../../lib/useInvoiceT'
import { issuedRange, localDate, type IssuedRange } from '../../../lib/localDates'

type Mode = 'between' | 'before' | 'on' | 'after'
const ranges: IssuedRange[] = ['yesterday', 'lastWeek', 'last7Days', 'lastMonth', 'last3Months', 'last12Months']
const modes: Mode[] = ['between', 'before', 'on', 'after']

export function IssuedDateFilter({ fromDate, toDate, onChange }: {
  fromDate: string
  toDate: string
  onChange: (fromDate: string, toDate: string) => void
}) {
  const t = useInvoiceT()
  const locale = useLocale()
  const trigger = React.useRef<HTMLButtonElement>(null)
  const [open, setOpen] = React.useState(false)
  const [boundary, setBoundary] = React.useState<HTMLElement | null>(null)
  const [width, setWidth] = React.useState(672)
  const [mode, setMode] = React.useState<Mode>('between')
  const [pendingStart, setPendingStart] = React.useState('')
  const [month, setMonth] = React.useState(new Date(2000, 0, 1))

  React.useEffect(() => {
    const element = trigger.current?.closest<HTMLElement>('[data-app-shell-column]') ?? document.documentElement
    setBoundary(element)
    const measure = () => setWidth(Math.max(0, Math.min(672, element.getBoundingClientRect().width - 32)))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const changeOpen = (next: boolean) => {
    if (next) {
      const date = fromDate || toDate ? new Date(`${fromDate || toDate}T00:00:00`) : new Date()
      setMonth(new Date(date.getFullYear(), date.getMonth(), 1))
      setMode(fromDate && toDate ? (fromDate === toDate ? 'on' : 'between') : fromDate ? 'after' : toDate ? 'before' : 'between')
      setPendingStart('')
    }
    setOpen(next)
  }
  const apply = (start: string, end: string) => {
    onChange(start, end)
    setOpen(false)
    setPendingStart('')
  }
  const selectDate = (date: Date) => {
    const value = localDate(date)
    if (mode === 'before') return apply('', value)
    if (mode === 'after') return apply(value, '')
    if (mode === 'on') return apply(value, value)
    if (!pendingStart) return setPendingStart(value)
    apply(pendingStart < value ? pendingStart : value, pendingStart < value ? value : pendingStart)
  }
  const start = new Date(month)
  start.setDate(1 - ((start.getDay() + 6) % 7))
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
  const dateLabel = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString(locale)
  const label = fromDate || toDate ? `${fromDate ? dateLabel(fromDate) : '…'} – ${toDate ? dateLabel(toDate) : '…'}` : t('invoice.list.direction.all')

  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger asChild>
      <Button ref={trigger} type="button" variant="outline" className="max-w-full" aria-label={`${t('invoice.list.issued')}: ${label}`}>
        <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{t('invoice.list.issued')}: {label}</span>
        <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </Button>
    </PopoverTrigger>
    <PopoverContent collisionBoundary={boundary} collisionPadding={16} sideOffset={8} align="start" className="min-w-0 overflow-y-auto p-4" style={{ width, maxHeight: 'var(--radix-popover-content-available-height)' }} aria-label={t('invoice.list.issued')}>
      <div className={`grid gap-4 ${width >= 560 ? 'grid-cols-3' : 'grid-cols-1'}`}>
        <div className={width >= 560 ? 'border-r border-border pr-4' : 'border-b border-border pb-3'}>
          <p className="mb-3 text-xs font-semibold uppercase text-muted-foreground">{t('invoice.list.issued.quickRanges')}</p>
          <div className="flex flex-wrap gap-1">
            {ranges.map((range) => <Button key={range} type="button" variant="ghost" className="w-full justify-start whitespace-normal text-left" onClick={() => apply(...issuedRange(range))}>{t(`invoice.list.issued.${range}`)}</Button>)}
            <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => apply('', '')}>{t('invoice.list.issued.clear')}</Button>
          </div>
        </div>
        <div className={`min-w-0 ${width >= 560 ? 'col-span-2' : ''}`}>
          <div className="mb-4 grid grid-cols-4 gap-1 rounded-lg border border-border p-1">
            {modes.map((value) => <Button key={value} type="button" size="sm" variant={mode === value ? 'secondary' : 'ghost'} className="min-w-0 px-1" aria-pressed={mode === value} onClick={() => { setMode(value); setPendingStart('') }}>{t(`invoice.list.issued.${value}`)}</Button>)}
          </div>
          <p className="mb-3 text-sm text-muted-foreground">{t(mode === 'between' ? pendingStart ? 'invoice.list.issued.pickEnd' : 'invoice.list.issued.pickStart' : 'invoice.list.issued.pickDate')}</p>
          <div className="mb-3 flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" aria-label={t('invoice.list.issued.previousMonth')} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft className="size-4" /></Button>
            <span className="text-center font-semibold">{month.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</span>
            <Button type="button" variant="ghost" size="sm" aria-label={t('invoice.list.issued.nextMonth')} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight className="size-4" /></Button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs">
            {days.slice(0, 7).map((date) => <span key={localDate(date)} className="py-2 font-semibold text-muted-foreground">{date.toLocaleDateString(locale, { weekday: 'short' })}</span>)}
            {days.map((date) => {
              const value = localDate(date)
              const selected = pendingStart ? value === pendingStart : value === fromDate || value === toDate
              return <Button key={value} type="button" size="sm" variant={selected ? 'secondary' : 'ghost'} className={`min-w-0 rounded-full px-0 ${date.getMonth() !== month.getMonth() ? 'text-muted-foreground' : ''}`} aria-label={dateLabel(value)} aria-pressed={selected} onClick={() => selectDate(date)}>{date.getDate()}</Button>
            })}
          </div>
        </div>
      </div>
    </PopoverContent>
  </Popover>
}
