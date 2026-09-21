import type { EntityManager } from '@mikro-orm/postgresql'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Appointment, AppointmentLine, AppointmentLineOption } from '../data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import AppointmentNoti from '../emails/AppointmentNoti'
import AppointmentConfirmationEmail from '../emails/AppointmentConfirmationEmail'
import type { AppointmentEmailData, EmailOptionDetail, EmailServiceSelection, Price } from '../emails/appointment-email'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import {
  APPOINTMENT_EMAIL_SETTINGS_KEY,
  APPOINTMENT_EMAIL_SETTINGS_MODULE_ID,
  appointmentEmailSettingsSchema,
  DEFAULT_APPOINTMENT_EMAIL_SETTINGS,
} from '../lib/email-settings'

const logger = createLogger('appointments').child({ component: 'created-email' })

export const metadata = {
  event: 'appointments.appointment.created',
  persistent: true,
  id: 'appointments:appointment-created-email',
}

type AppointmentCreatedPayload = {
  id: string
  tenantId: string
  organizationId: string
  source?: string
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

function parseEmailList(value: string): string[] | undefined {
  if (!value.trim()) return undefined
  const emails = value
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean)
  return emails.length > 0 ? emails : undefined
}

function optionPrice(option: AppointmentLineOption): Price | undefined {
  if (option.priceFlat != null) return Number(option.priceFlat)
  if (option.priceMin != null && option.priceMax != null) {
    return { min: Number(option.priceMin), max: Number(option.priceMax) }
  }
  if (option.priceMin != null) return Number(option.priceMin)
  if (option.priceMax != null) return Number(option.priceMax)
  return undefined
}

function toEmailOptionDetails(line: AppointmentLine): EmailOptionDetail[] {
  return line.optionGroups.getItems()
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .flatMap((group) => group.options.getItems()
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((option) => ({ groupLabel: group.groupName, optionName: option.optionName, price: optionPrice(option) })))
}

function toEmailSelection(line: AppointmentLine): EmailServiceSelection {
  const basePrice = Number(line.unitPriceGross ?? line.unitPriceNet ?? 0)
  return {
    itemName: line.productTitle,
    basePrice: Number.isFinite(basePrice) ? basePrice : 0,
    selectedOptionsDetails: toEmailOptionDetails(line),
  }
}

function toEmailData(appointment: Appointment, organizationName: string): AppointmentEmailData {
  const lines = appointment.lines.getItems()
    .filter((line) => !line.deletedAt)
    .sort((left, right) => left.sortOrder - right.sortOrder)

  return {
    customerName: appointment.customerName,
    customerEmail: appointment.customerEmail ?? '',
    customerPhone: appointment.customerPhone ?? '',
    location: organizationName,
    requestedStartAt: appointment.requestedStartAt,
    externalNotes: appointment.externalNotes ?? null,
    typeOfBooking: appointment.bookingType ?? '',
    serviceSelections: lines.map(toEmailSelection),
    salutation: appointment.customerSalutation || 'Mr',
    membership: 'none',
    countryCode: appointment.customerPhoneCountryCode ?? '',
  }
}

export default async function handle(payload: AppointmentCreatedPayload, ctx: ResolverContext): Promise<void> {
  if (payload.source !== 'public_booking') return

  const em = ctx.resolve<EntityManager>('em')?.fork()
  if (!em) {
    logger.error('Could not resolve database connection for appointment email', { appointmentId: payload.id })
    return
  }

  const appointment = await em.findOne(
    Appointment,
    { id: payload.id, tenantId: payload.tenantId, organizationId: payload.organizationId, deletedAt: null },
    { populate: ['lines', 'lines.optionGroups', 'lines.optionGroups.options'] },
  )
  if (!appointment) {
    logger.warn('Created appointment was not found for email delivery', { appointmentId: payload.id })
    return
  }

  const organization = await em.findOne(Organization, {
    id: payload.organizationId,
    tenant: payload.tenantId,
    deletedAt: null,
  })
  const emailData = toEmailData(appointment, organization?.name?.trim() || payload.organizationId)

  const configService = ctx.resolve<ModuleConfigService>('moduleConfigService')
  const settingsRecord = await configService.getRecord(
    APPOINTMENT_EMAIL_SETTINGS_MODULE_ID,
    APPOINTMENT_EMAIL_SETTINGS_KEY,
    { tenantId: payload.tenantId },
  )
  const rawSettings = settingsRecord?.source === 'tenant' ? settingsRecord.value : null
  const parsedSettings = appointmentEmailSettingsSchema.safeParse(rawSettings)
  const settings = parsedSettings.success ? parsedSettings.data : DEFAULT_APPOINTMENT_EMAIL_SETTINGS

  const sends: Array<Promise<unknown>> = []
  const internalRecipients = parseEmailList(settings.to)
  if (internalRecipients?.length) {
    sends.push(sendEmail({
      to: internalRecipients,
      cc: parseEmailList(settings.cc),
      bcc: parseEmailList(settings.bcc),
      from: settings.from || undefined,
      replyTo: settings.replyTo || undefined,
      subject: `[TPS][BR] from ${emailData.salutation}. ${emailData.customerName} - ${emailData.location}`,
      react: AppointmentNoti(emailData),
    }))
  } else {
    logger.warn('Internal appointment email skipped because the tenant has no recipients configured', {
      appointmentId: appointment.id,
      tenantId: payload.tenantId,
    })
  }

  if (emailData.customerEmail.trim()) {
    sends.push(sendEmail({
      to: emailData.customerEmail,
      from: settings.from || undefined,
      replyTo: settings.replyTo || undefined,
      subject: 'Your booking has been recorded – The Privé Spa',
      react: AppointmentConfirmationEmail(emailData),
    }))
  }

  if (sends.length === 0) {
    logger.warn('Appointment emails skipped because no recipients are configured', { appointmentId: appointment.id })
    return
  }

  const results = await Promise.allSettled(sends)
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      logger.error('Appointment email delivery failed', { appointmentId: appointment.id, recipientIndex: index, err: result.reason })
    }
  }
}
