import type { EntityManager } from '@mikro-orm/postgresql'
import { deliverCustomerEmail, RESEND_INTEGRATION_ID, resolveCustomerEmailCredential } from '@open-mercato/shared/lib/email/customer-send'
import {
  isPermanentIntegrationCredentialError,
  type ResolvedIntegrationCredential,
} from '@open-mercato/shared/modules/integrations/credential-resolution'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Appointment, AppointmentLine, AppointmentLineOption } from '../data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import type { AppointmentEmailData, EmailOptionDetail, EmailServiceSelection, Price } from '../emails/appointment-email'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import {
  APPOINTMENT_EMAIL_SETTINGS_KEY,
  APPOINTMENT_EMAIL_SETTINGS_MODULE_ID,
  normalizeAppointmentEmailSettings,
} from '../lib/email-settings'
import { buildAppointmentEmailContent } from '../lib/email-content'


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

type AppointmentEmailLog = {
  level: 'info' | 'warn' | 'error'
  message: string
  code: string
  payload?: Record<string, unknown>
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

  const scope = { tenantId: payload.tenantId, organizationId: payload.organizationId }
  const integrationLogService = ctx.resolve<IntegrationLogService>('integrationLogService')
  const writeIntegrationLog = async (entry: AppointmentEmailLog): Promise<void> => {
    try {
      await integrationLogService.write({ integrationId: RESEND_INTEGRATION_ID, ...entry }, scope)
    } catch (error) {
      logger.error('Could not write appointment email integration log', {
        appointmentId: appointment.id,
        err: error,
      })
    }
  }

  let credential: ResolvedIntegrationCredential | null
  try {
    credential = await resolveCustomerEmailCredential(ctx, {
      scope,
      operation: 'appointments.appointment.created_email',
      correlationId: appointment.id,
    })
  } catch (error) {
    if (!isPermanentIntegrationCredentialError(error)) throw error
    const disabled = error.code === 'integration_disabled'
    const message = disabled
      ? 'Appointment email skipped because the Resend integration is disabled'
      : 'Appointment email skipped because the organization has no usable Resend credentials'
    logger.info(message, {
      appointmentId: appointment.id,
      tenantId: payload.tenantId,
      organizationId: payload.organizationId,
      code: error.code,
    })
    await writeIntegrationLog({
      level: 'info',
      message,
      code: disabled ? 'resend.disabled' : `resend.${error.code}`,
      payload: { appointmentId: appointment.id },
    })
    return
  }

  const configService = ctx.resolve<ModuleConfigService>('moduleConfigService')
  const settingsRecord = await configService.getRecord(
    APPOINTMENT_EMAIL_SETTINGS_MODULE_ID,
    APPOINTMENT_EMAIL_SETTINGS_KEY,
    { tenantId: payload.tenantId },
  )
  const rawSettings = settingsRecord?.source === 'tenant' ? settingsRecord.value : null
  const settings = normalizeAppointmentEmailSettings(rawSettings)
  const sender = settings.from || undefined
  const content = buildAppointmentEmailContent(emailData, settings)

  const sends: Array<{ recipientType: 'internal' | 'customer'; task: Promise<unknown> }> = []
  const internalRecipients = parseEmailList(settings.to)
  if (internalRecipients?.length) {
    sends.push({
      recipientType: 'internal',
      task: deliverCustomerEmail(credential, {
        to: internalRecipients,
        cc: parseEmailList(settings.cc),
        bcc: parseEmailList(settings.bcc),
        from: sender,
        replyTo: settings.replyTo || undefined,
        subject: content.internal.subject,
        react: content.internal.react,
      }),
    })
  } else {
    logger.warn('Internal appointment email skipped because the tenant has no recipients configured', {
      appointmentId: appointment.id,
      tenantId: payload.tenantId,
    })
    await writeIntegrationLog({
      level: 'warn',
      message: 'Internal appointment email skipped because no recipients are configured',
      code: 'resend.internal_recipient_missing',
      payload: { appointmentId: appointment.id },
    })
  }

  if (emailData.customerEmail.trim()) {
    sends.push({
      recipientType: 'customer',
      task: deliverCustomerEmail(credential, {
        to: emailData.customerEmail,
        from: sender,
        replyTo: settings.replyTo || undefined,
        subject: content.customer.subject,
        react: content.customer.react,
      }),
    })
  }

  if (sends.length === 0) {
    logger.warn('Appointment emails skipped because no recipients are configured', { appointmentId: appointment.id })
    await writeIntegrationLog({
      level: 'warn',
      message: 'Appointment emails skipped because no recipients are configured',
      code: 'resend.no_recipients',
      payload: { appointmentId: appointment.id },
    })
    return
  }

  const results = await Promise.allSettled(sends.map((send) => send.task))
  for (const [index, result] of results.entries()) {
    const send = sends[index]
    if (!send) continue
    if (result.status === 'rejected') {
      logger.error('Appointment email delivery failed', { appointmentId: appointment.id, recipientIndex: index, err: result.reason })
      await writeIntegrationLog({
        level: 'error',
        message: `Appointment ${send.recipientType} email delivery failed`,
        code: 'resend.email_failed',
        payload: {
          appointmentId: appointment.id,
          recipientType: send.recipientType,
          error: result.reason instanceof Error ? result.reason.message : 'Unknown email delivery error',
        },
      })
      continue
    }
    await writeIntegrationLog({
      level: 'info',
      message: `Appointment ${send.recipientType} email delivered`,
      code: 'resend.email_sent',
      payload: { appointmentId: appointment.id, recipientType: send.recipientType },
    })
  }
}
