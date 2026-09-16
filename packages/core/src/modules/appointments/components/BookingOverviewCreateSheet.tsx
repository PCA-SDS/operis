'use client'

import * as React from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, Loader2, Search, Sparkles, UserPlus, UserRound } from 'lucide-react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@open-mercato/ui/primitives/sheet'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { AppointmentServicePicker, hasCompleteAppointmentServiceOptions, type AppointmentBookableService, type AppointmentServiceSelection } from './AppointmentServicePicker'
import { DictionarySelectField } from '@open-mercato/core/modules/customers/components/formConfig'
import { APPOINTMENT_BOOKING_TYPE_OPTIONS, APPOINTMENT_ORIGIN_OPTIONS } from '@open-mercato/core/modules/appointments/data/constants'

type CreateSheetState = { date: string; time: string; resourceId: string; resourceName: string }
type Customer = { name?: string | null; email?: string | null; phone?: string | null; phoneCountryCode?: string | null; phoneCountry?: string | null; salutation?: string | null; origin?: 'local' | 'tourist' | 'expatriate' | null; source?: string | null }
type CustomerSearchResult = { id: string; display_name?: string | null; displayName?: string | null; first_name?: string | null; last_name?: string | null; primary_email?: string | null; primaryEmail?: string | null; primary_phone?: string | null; primaryPhone?: string | null; phone_country_code?: string | null; phoneCountryCode?: string | null; phone_country?: string | null; phoneCountry?: string | null; salutation?: string | null; origin?: 'local' | 'tourist' | 'expatriate' | null; source?: string | null }
type AppointmentLine = { id: string; durationMinutes: number | null }
type SchedulingResult = { code?: string; error?: string }

function splitName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  return { firstName: parts[0] ?? value.trim(), lastName: parts.slice(1).join(' ') || parts[0] || value.trim() }
}

function addMinutes(value: Date, minutes: number) { return new Date(value.getTime() + minutes * 60_000) }

function foldSearchText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function BookingOverviewCreateSheet({
  open,
  onOpenChange,
  initialState,
  onSuccess,
  onConflict,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialState: CreateSheetState | null
  onSuccess: () => void
  onConflict: (appointmentId: string) => void
}) {
  const t = useT()
  const { tenantId, organizationId } = useOrganizationScopeDetail()
  const [phone, setPhone] = React.useState('')
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [salutation, setSalutation] = React.useState('None')
  const [origin, setOrigin] = React.useState<'local' | 'tourist' | 'expatriate' | ''>('')
  const [source, setSource] = React.useState('')
  const [bookingType, setBookingType] = React.useState('walk_in')
  const [customerSearch, setCustomerSearch] = React.useState('')
  const [customerSearchResults, setCustomerSearchResults] = React.useState<CustomerSearchResult[]>([])
  const [isCustomerSearchOpen, setIsCustomerSearchOpen] = React.useState(false)
  const [isSearchingCustomers, setIsSearchingCustomers] = React.useState(false)
  const [internalNotes, setInternalNotes] = React.useState('')
  const [externalNotes, setExternalNotes] = React.useState('')
  const [selectedServices, setSelectedServices] = React.useState<AppointmentServiceSelection[]>([])
  const [services, setServices] = React.useState<AppointmentBookableService[]>([])
  const [isLoadingServices, setIsLoadingServices] = React.useState(false)
  const [isLookingUp, setIsLookingUp] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [previousServices, setPreviousServices] = React.useState<AppointmentServiceSelection[]>([])
  const [step, setStep] = React.useState<'customer' | 'choice' | 'services'>('customer')

  React.useEffect(() => {
    if (!open || !tenantId || !organizationId) return
    const controller = new AbortController()
    setIsLoadingServices(true)
    const params = new URLSearchParams({ tenantId, organizationId })
    void apiCall<{ items?: AppointmentBookableService[] }>(`/api/catalog/bookable-services?${params.toString()}`, { signal: controller.signal }, { fallback: null })
      .then((call) => { if (call.ok) setServices(call.result?.items ?? []) })
      .finally(() => { if (!controller.signal.aborted) setIsLoadingServices(false) })
    return () => controller.abort()
  }, [open, organizationId, tenantId])

  React.useEffect(() => {
    if (!open) return
    setPhone(''); setName(''); setEmail(''); setSalutation('None'); setOrigin(''); setSource(''); setBookingType('walk_in'); setCustomerSearch(''); setCustomerSearchResults([]); setIsCustomerSearchOpen(false); setInternalNotes(''); setExternalNotes(''); setSelectedServices([]); setPreviousServices([]); setStep('customer')
  }, [open])

  React.useEffect(() => {
    const query = customerSearch.trim()
    if (!open || !tenantId || !organizationId || query.length < 2 || !isCustomerSearchOpen) {
      setCustomerSearchResults([])
      setIsSearchingCustomers(false)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setIsSearchingCustomers(true)
      const params = new URLSearchParams({ tenantId, organizationId, search: query, page: '1', pageSize: '10' })
      const searchCustomers = async (search: string) => {
        const searchParams = new URLSearchParams({ search })
        return apiCall<{ items?: CustomerSearchResult[] }>(`/api/appointments/customer-search?${searchParams.toString()}`, { signal: controller.signal }, { fallback: null })
      }
      void searchCustomers(query).then(async (call) => {
        if (controller.signal.aborted) return
        const initialResults = call.ok ? call.result?.items ?? [] : []
        if (initialResults.length > 0) {
          setCustomerSearchResults(initialResults)
          return
        }
        const fallbackQueries = Array.from(new Set([
          foldSearchText(query),
          ...query.split(/\s+/).filter((token) => token.length >= 2),
          ...query.split(/\s+/).filter((token) => token.length >= 2).map(foldSearchText),
        ].filter((value) => value.length >= 2)))
        const tokenCalls = await Promise.all(fallbackQueries.map((token) => searchCustomers(token)))
        if (controller.signal.aborted) return
        const merged = tokenCalls.flatMap((tokenCall) => tokenCall.ok ? tokenCall.result?.items ?? [] : [])
        setCustomerSearchResults(Array.from(new Map(merged.map((customer) => [customer.id, customer])).values()))
      })
        .finally(() => { if (!controller.signal.aborted) setIsSearchingCustomers(false) })
    }, 350)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [customerSearch, isCustomerSearchOpen, open, organizationId, tenantId])

  const loadCustomerHistory = async (customer: Customer) => {
    if (!tenantId || !customer.phone || !customer.email) {
      setPreviousServices([])
      return
    }
    const history = await apiCall<{ lastBooking?: { serviceLines?: AppointmentServiceSelection[] } | null }>('/api/appointments/public/customer', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId, phone: customer.phone, email: customer.email, phoneCountryCode: customer.phoneCountryCode ?? '+84', phoneCountry: customer.phoneCountry ?? 'vn' }),
    }, { fallback: null })
    setPreviousServices(history.result?.lastBooking?.serviceLines ?? [])
  }

  const applyCustomer = async (result: CustomerSearchResult) => {
    const customer: Customer = {
      name: result.display_name ?? result.displayName ?? [result.first_name, result.last_name].filter(Boolean).join(' '),
      email: result.primary_email ?? result.primaryEmail,
      phone: result.primary_phone ?? result.primaryPhone,
      phoneCountryCode: result.phone_country_code ?? result.phoneCountryCode,
      phoneCountry: result.phone_country ?? result.phoneCountry,
      salutation: result.salutation,
      origin: result.origin,
      source: result.source,
    }
    setName(customer.name ?? '')
    setEmail(customer.email ?? '')
    setPhone(customer.phone ?? '')
    setSalutation(customer.salutation ?? 'None')
    setOrigin(customer.origin ?? '')
    setSource(customer.source ?? '')
    setCustomerSearch('')
    setCustomerSearchResults([])
    setIsCustomerSearchOpen(false)
    setIsLookingUp(true)
    try {
      await loadCustomerHistory(customer)
      flash(t('appointments.overview.create.customerFound', 'Returning customer found.'), 'success')
    } finally {
      setIsLookingUp(false)
    }
  }

  const lookupCustomer = async () => {
    if (!tenantId || !phone.trim()) return
    setIsLookingUp(true)
    try {
      const call = await apiCall<{ exists?: boolean; customer?: Customer }>('/api/customers/people/check', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId, phone: phone.trim(), phoneCountryCode: '+84', phoneCountry: 'vn' }),
      }, { fallback: null })
      if (!call.ok || !call.result?.exists || !call.result.customer) {
        flash(t('appointments.overview.create.customerNotFound', 'Customer not found. Continue as a new customer.'), 'info')
        return
      }
      const customer = call.result.customer
      setName(customer.name ?? ''); setEmail(customer.email ?? ''); setPhone(customer.phone ?? phone); setCustomerSearch(customer.name ?? customer.phone ?? ''); setSalutation(customer.salutation ?? 'None')
      if (customer.origin) setOrigin(customer.origin)
      if (customer.source) setSource(customer.source)
      await loadCustomerHistory({ ...customer, phone: customer.phone ?? phone.trim(), email: customer.email ?? email.trim() })
      flash(t('appointments.overview.create.customerFound', 'Returning customer found.'), 'success')
    } finally { setIsLookingUp(false) }
  }

  const redirectToPlannerAfterConflict = (appointmentId: string, result: SchedulingResult | null) => {
    const message = result?.code === 'ASSIGNMENT_CONFLICT'
      ? t('appointments.seatPlanner.resourceBooked', 'That resource is already booked for this time.')
      : result?.code === 'RESOURCE_BLOCKED' || result?.code === 'OUTSIDE_AVAILABILITY'
        ? t('appointments.seatPlanner.resourceUnavailable', 'This resource is unavailable for the selected time.')
        : t('appointments.overview.serviceSchedulingConflict', 'Booking created, but it could not be scheduled because of a conflict. Opening Planner.')
    flash(message, 'error')
    onOpenChange(false)
    onConflict(appointmentId)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!initialState || !organizationId || !name.trim() || !phone.trim() || !origin || !source.trim() || selectedServices.length === 0 || isSubmitting) return
    const servicesById = new Map(services.map((service) => [service.id, service]))
    if (selectedServices.some((selection) => { const service = servicesById.get(selection.productId); return !service || !hasCompleteAppointmentServiceOptions(service, selection) })) {
      flash(t('appointments.overview.create.optionsRequired', 'Please complete all required service options.'), 'error')
      return
    }
    setIsSubmitting(true)
    const { firstName, lastName } = splitName(name)
    const requestedStartAt = new Date(`${initialState.date}T${initialState.time}:00`)
    try {
      const created = await apiCall<{ id?: string }>('/api/appointments', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId, statusCode: 'booked', requestedStartAt: requestedStartAt.toISOString(), notes: internalNotes.trim() || null, externalNotes: externalNotes.trim() || null, bookingType, customer: { firstName, lastName, phone: phone.trim(), email: email.trim() || null, salutation, source: source.trim(), origin, phoneCountryCode: '+84', phoneCountry: 'vn' }, lines: selectedServices }),
      }, { fallback: null })
      const appointmentId = created.result?.id
      if (!created.ok || !appointmentId) throw new Error('[internal] create appointment failed')
      const detail = await apiCall<{ lines?: AppointmentLine[] }>(`/api/appointments/${appointmentId}`, {}, { fallback: null })
      const lines = detail.result?.lines ?? []
      let nextStart = requestedStartAt
      for (const line of lines) {
        const endsAt = addMinutes(nextStart, 60)
        const assignment = await apiCall<SchedulingResult>(`/api/appointments/${appointmentId}/lines/${line.id}/draft`, {
          method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resourceId: initialState.resourceId, startsAt: nextStart.toISOString(), endsAt: endsAt.toISOString() }),
        }, { fallback: null })
        if (!assignment.ok) { redirectToPlannerAfterConflict(appointmentId, assignment.result); return }
        nextStart = endsAt
      }
      const confirmed = await apiCall<SchedulingResult>(`/api/appointments/${appointmentId}/confirm-drafts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, { fallback: null })
      if (!confirmed.ok) { redirectToPlannerAfterConflict(appointmentId, confirmed.result); return }
      flash(t('appointments.overview.create.success', 'Booking created.'), 'success')
      onOpenChange(false); onSuccess()
    } catch { flash(t('appointments.overview.create.failed', 'Unable to create booking.'), 'error')
    } finally { setIsSubmitting(false) }
  }

  const nextStep = () => {
    if (!phone.trim() || !name.trim()) {
      flash(t('appointments.overview.create.customerRequired', 'Phone and customer name are required.'), 'error')
      return
    }
    setStep(previousServices.length > 0 ? 'choice' : 'services')
  }

  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="right" className="w-full overflow-hidden sm:max-w-md">
    <SheetHeader><SheetTitle className="flex items-center gap-2"><UserPlus className="size-5" />{t('appointments.overview.create.title', 'Create Booking')}</SheetTitle><SheetDescription>{initialState ? `${initialState.date} · ${initialState.time} · ${initialState.resourceName}` : ''}</SheetDescription></SheetHeader>
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
      <div className="mb-4 flex items-center gap-2 text-xs font-medium text-muted-foreground"><span className={step === 'customer' ? 'text-primary' : ''}>1. {t('appointments.overview.create.customerStep', 'Customer')}</span><span>→</span><span className={step !== 'customer' ? 'text-primary' : ''}>2. {t('appointments.overview.create.servicesStep', 'Services')}</span></div>
      {step === 'customer' ? <div className="space-y-4">
        <div className="space-y-2"><Label>{t('appointments.overview.create.findReturning', 'Find returning customer')}</Label><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={customerSearch} onFocus={() => setIsCustomerSearchOpen(true)} onChange={(event) => { setCustomerSearch(event.target.value.slice(0, 64)); setIsCustomerSearchOpen(true) }} onKeyDown={(event) => { if (event.key === 'Escape') setIsCustomerSearchOpen(false) }} placeholder={t('appointments.overview.create.searchCustomer', 'Type customer name or phone to search...')} className="pl-9 pr-9" />{isSearchingCustomers ? <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" /> : null}{isCustomerSearchOpen && customerSearch.trim() ? <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-50 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg"><div className="max-h-72 overflow-y-auto p-1">{customerSearch.trim().length < 2 ? <div className="px-3 py-6 text-center text-sm text-muted-foreground">{t('appointments.overview.create.searchMinimum', 'Type at least 2 characters to search.')}</div> : isSearchingCustomers && customerSearchResults.length === 0 ? <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t('appointments.overview.create.searchingCustomers', 'Searching customers...')}</div> : customerSearchResults.length === 0 ? <div className="px-3 py-6 text-center text-sm text-muted-foreground">{t('appointments.overview.create.noCustomersFound', 'No customers found.')}</div> : customerSearchResults.map((customer) => <button key={customer.id} type="button" onClick={() => void applyCustomer(customer)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-accent"><span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><UserRound className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{customer.display_name ?? customer.displayName ?? [customer.first_name, customer.last_name].filter(Boolean).join(' ') ?? t('appointments.overview.create.unnamedCustomer', 'Unnamed customer')}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{customer.phone_country_code ?? customer.phoneCountryCode ? `${customer.phone_country_code ?? customer.phoneCountryCode} ` : ''}{customer.primary_phone ?? customer.primaryPhone ?? customer.primary_email ?? customer.primaryEmail ?? ''}</span></span></button>)}</div></div> : null}</div><p className="text-xs text-muted-foreground">{t('appointments.overview.create.searchHint', 'Search by customer name or phone. Suggestions load automatically after you stop typing.')}</p></div>
        <div className="grid grid-cols-[7.5rem_1fr] gap-3"><div className="space-y-1.5"><Label>{t('appointments.create.field.phoneCode', 'Code')}</Label><div className="flex h-10 items-center rounded-md border bg-muted/30 px-3 text-sm">🇻🇳 <span className="ml-2">VN +84</span></div></div><div className="space-y-1.5"><Label>{t('appointments.create.field.phone', 'Phone')} <span className="text-status-error-text">*</span></Label><div className="flex gap-2"><Input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={t('appointments.overview.create.phone', 'Phone number')} required /><Button type="button" variant="outline" size="icon" onClick={() => void lookupCustomer()} disabled={isLookingUp}>{isLookingUp ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}</Button></div></div></div>
        <div className="grid grid-cols-[7.5rem_1fr] gap-3"><div className="space-y-1.5"><Label>{t('appointments.create.field.salutation', 'Salutation')}</Label><Select value={salutation} onValueChange={setSalutation}><SelectTrigger><SelectValue placeholder={t('common.select', 'Select')} /></SelectTrigger><SelectContent>{['None', 'Mr', 'Mrs', 'Ms', 'Mx'].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1.5"><Label>{t('appointments.create.field.name', 'Name')} <span className="text-status-error-text">*</span></Label><Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('appointments.overview.create.name', 'Customer name')} required /></div></div>
        <div className="space-y-1.5"><Label>{t('appointments.create.field.email', 'Email')} <span className="font-normal text-muted-foreground">({t('common.optional', 'optional')})</span></Label><div className="relative"><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="customer@email.com" className="pr-10" /><Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /></div></div>
        <div className="grid grid-cols-3 gap-3"><div className="space-y-1.5"><Label>{t('appointments.create.field.origin', 'Origin')} <span className="text-status-error-text">*</span></Label><Select value={origin || undefined} onValueChange={(value) => setOrigin(value as typeof origin)}><SelectTrigger><SelectValue placeholder={t('common.select', 'Select')} /></SelectTrigger><SelectContent>{APPOINTMENT_ORIGIN_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1.5"><Label>{t('appointments.create.field.referral', 'Referral')} <span className="text-status-error-text">*</span></Label><DictionarySelectField kind="sources" value={source || undefined} onChange={(value) => setSource(value ?? '')} labels={{ placeholder: t('appointments.create.field.referral.placeholder', 'Select a source'), addLabel: t('customers.people.form.dictionary.addSource', 'Add source'), addPrompt: t('customers.people.form.dictionary.promptSource', 'Enter a new source'), dialogTitle: t('customers.people.form.dictionary.dialogTitleSource', 'Add source'), valueLabel: t('customers.people.form.dictionary.valueLabel', 'Value'), valuePlaceholder: t('customers.people.form.dictionary.valuePlaceholder', 'Value'), labelLabel: t('customers.config.dictionaries.dialog.labelLabel', 'Label'), labelPlaceholder: t('customers.people.form.dictionary.labelPlaceholder', 'Display name shown in UI'), emptyError: t('customers.people.form.dictionary.errorRequired'), cancelLabel: t('customers.people.form.dictionary.cancel'), saveLabel: t('customers.people.form.dictionary.save'), errorLoad: t('customers.people.form.dictionary.errorLoad'), errorSave: t('customers.people.form.dictionary.error'), loadingLabel: t('customers.people.form.dictionary.loading'), manageTitle: t('customers.people.form.dictionary.manage') }} showActiveAppearance={false} /></div><div className="space-y-1.5"><Label>{t('appointments.create.field.bookingType', 'Type of booking')} <span className="text-status-error-text">*</span></Label><Select value={bookingType} onValueChange={setBookingType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{APPOINTMENT_BOOKING_TYPE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div></div>
        <div className="space-y-1.5"><Label>{t('appointments.create.field.notes', 'Internal Notes')}</Label><Input value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} placeholder={t('appointments.overview.create.internalNotes', 'Internal...')} /></div><div className="space-y-1.5"><Label>{t('appointments.create.field.externalNotes', 'External Notes')}</Label><Input value={externalNotes} onChange={(event) => setExternalNotes(event.target.value)} placeholder={t('appointments.overview.create.externalNotes', 'External...')} /></div>
      </div> : step === 'choice' ? <div className="space-y-4">
        <div><h3 className="font-semibold">{t('appointments.overview.create.serviceChoiceTitle', 'Service Selection')}</h3><p className="text-sm text-muted-foreground">{t('appointments.overview.create.serviceChoiceHint', 'Choose new services or repeat the previous visit.')}</p></div>
        <Button type="button" variant="outline" className="h-auto w-full justify-start gap-3 whitespace-normal p-4 text-left" onClick={() => { setSelectedServices([]); setStep('services') }}><Sparkles className="size-5 shrink-0 text-primary" /><span><span className="block font-semibold">{t('appointments.overview.create.chooseNewService', 'Choose new service')}</span><span className="block text-xs text-muted-foreground">{t('appointments.overview.create.browseServices', 'Browse the full service menu')}</span></span></Button>
        <Button type="button" variant="outline" className="h-auto w-full justify-start gap-3 whitespace-normal p-4 text-left" onClick={() => { setSelectedServices(previousServices); setStep('services') }}><CalendarDays className="size-5 shrink-0 text-primary" /><span><span className="block font-semibold">{t('appointments.overview.create.repeatPrevious', 'Repeat previous services')}</span><span className="block text-xs text-muted-foreground">{t('appointments.overview.create.previousServiceCount', '{count} service(s) from the last visit)', { count: previousServices.length })}</span></span></Button>
      </div> : <div className="space-y-3"><Label>{t('appointments.create.field.services', 'Services')}</Label><AppointmentServicePicker services={services} loading={isLoadingServices} emptyLabel={t('appointments.create.services.loading', 'Loading services...')} value={selectedServices} onChange={setSelectedServices} disabled={isSubmitting} /></div>}
      <div className="mt-auto flex justify-end gap-3 border-t pt-4"><Button type="button" variant="outline" className="flex-1" onClick={() => { if (step === 'customer') onOpenChange(false); else if (step === 'services' && previousServices.length > 0) setStep('choice'); else setStep('customer') }} disabled={isSubmitting}>{step === 'customer' ? t('common.cancel', 'Cancel') : <><ArrowLeft className="size-4" />{t('common.back', 'Back')}</>}</Button>{step === 'customer' ? <Button type="button" className="flex-1" onClick={nextStep}>{t('common.next', 'Next')}<ArrowRight className="size-4" /></Button> : step === 'choice' ? null : <Button type="submit" className="flex-1" disabled={isSubmitting || selectedServices.length === 0}>{isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}{t('appointments.overview.create.submit', 'Create Booking')}</Button>}</div>
    </form>
  </SheetContent></Sheet>
}
