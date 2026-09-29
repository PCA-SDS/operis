/** @jest-environment node */

import handle from '../appointment-created-email'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { IntegrationCredentialError } from '@open-mercato/shared/modules/integrations/credential-resolution'
import {
  createTestCredentialResolver,
  type TestCredentialResolver,
} from '@open-mercato/shared/lib/testing/integrationCredentials'

jest.mock('@open-mercato/shared/lib/email/send', () => ({ sendEmail: jest.fn() }))

type AppointmentFixture = {
  id: string
  customerName: string
  customerSalutation?: string
  customerEmail: string | null
  customerPhone?: string
  customerPhoneCountryCode?: string
  requestedStartAt: Date
  externalNotes?: string
  lines: { getItems: () => unknown[] }
}

function buildAppointment(overrides: Partial<AppointmentFixture> = {}): AppointmentFixture {
  return {
    id: 'appointment-1',
    customerName: 'Ada Lovelace',
    customerEmail: 'ada@example.com',
    requestedStartAt: new Date('2026-09-16T03:00:00.000Z'),
    lines: { getItems: () => [] },
    ...overrides,
  }
}

function buildContext(input: {
  appointment: AppointmentFixture
  settings: Record<string, string> | null
  resolver: TestCredentialResolver
}) {
  const em = {
    fork: jest.fn().mockReturnThis(),
    findOne: jest.fn()
      .mockResolvedValueOnce(input.appointment)
      .mockResolvedValueOnce({ name: 'Ben Thanh' }),
  }
  const integrationLogService = { write: jest.fn().mockResolvedValue(undefined) }
  const moduleConfigService = {
    getRecord: jest.fn().mockResolvedValue(input.settings ? { source: 'tenant', value: input.settings } : null),
  }
  const services: Record<string, unknown> = {
    em,
    integrationLogService,
    moduleConfigService,
    integrationCredentialResolver: input.resolver,
  }
  const ctx = {
    resolve: <T,>(name: string) => services[name] as T,
    hasRegistration: (name: string) => name in services,
  }
  return { ctx, em, integrationLogService, moduleConfigService }
}

const publicBooking = (tenantId = 'tenant-1', organizationId = 'org-1') => ({
  id: 'appointment-1',
  tenantId,
  organizationId,
  source: 'public_booking' as const,
})

const organizationResend = { resend: { secret: 'org-resend-key', settings: { fromEmail: 'default@example.com' } } }

describe('appointment created email subscriber', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('sends an internal booking notice and customer request email with the organization credential', async () => {
    const settings = {
      from: 'bookings@example.com',
      to: 'spa@example.com,second-spa@example.com',
      cc: 'manager@example.com,second-manager@example.com',
      bcc: 'audit@example.com',
      replyTo: 'reply@example.com',
    }
    const resolver = createTestCredentialResolver(organizationResend)
    const { ctx, em, integrationLogService, moduleConfigService } = buildContext({
      appointment: buildAppointment({
        customerSalutation: 'Ms',
        customerPhone: '5551212',
        customerPhoneCountryCode: '+84',
        externalNotes: 'Quiet room requested',
      }),
      settings,
      resolver,
    })

    await handle(publicBooking(), ctx)

    expect(em.findOne).toHaveBeenCalledTimes(2)
    expect(moduleConfigService.getRecord).toHaveBeenCalledWith('appointments', 'public_booking_email', { tenantId: 'tenant-1' })
    expect(resolver.requests).toEqual([
      expect.objectContaining({
        integrationId: 'resend',
        scope: { tenantId: 'tenant-1', organizationId: 'org-1' },
        operation: 'appointments.appointment.created_email',
        correlationId: 'appointment-1',
      }),
    ])
    expect(sendEmail).toHaveBeenCalledTimes(2)
    expect(sendEmail).toHaveBeenNthCalledWith(1, expect.objectContaining({
      apiKey: 'org-resend-key',
      to: ['spa@example.com', 'second-spa@example.com'],
      cc: ['manager@example.com', 'second-manager@example.com'],
      bcc: ['audit@example.com'],
      from: 'bookings@example.com',
      replyTo: 'reply@example.com',
    }))
    expect(sendEmail).toHaveBeenNthCalledWith(2, expect.objectContaining({
      apiKey: 'org-resend-key',
      to: 'ada@example.com',
      from: 'bookings@example.com',
      replyTo: 'reply@example.com',
      subject: 'Your booking has been recorded – The Privé Spa',
    }))
    expect(integrationLogService.write).toHaveBeenCalledWith(expect.objectContaining({
      integrationId: 'resend',
      code: 'resend.email_sent',
    }), { tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it('does not send appointment email for staff-created bookings', async () => {
    const ctx = { resolve: jest.fn() }

    await handle({ id: 'appointment-1', tenantId: 'tenant-1', organizationId: 'org-1' }, ctx)

    expect(ctx.resolve).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('records a provider failure without exposing recipient data', async () => {
    const { ctx, integrationLogService } = buildContext({
      appointment: buildAppointment({ customerEmail: null }),
      settings: { from: '', to: 'spa@example.com', cc: '', bcc: '', replyTo: '' },
      resolver: createTestCredentialResolver(organizationResend),
    })
    jest.mocked(sendEmail).mockRejectedValueOnce(new Error('Resend unavailable'))

    await handle(publicBooking(), ctx)

    expect(integrationLogService.write).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      code: 'resend.email_failed',
      payload: { appointmentId: 'appointment-1', recipientType: 'internal', error: 'Resend unavailable' },
    }), { tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it('uses the organization default sender when the booking settings have none', async () => {
    const { ctx } = buildContext({
      appointment: buildAppointment({ customerEmail: null }),
      settings: { from: '', to: 'spa@example.com', cc: '', bcc: '', replyTo: '' },
      resolver: createTestCredentialResolver(organizationResend),
    })

    await handle(publicBooking(), ctx)

    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: ['spa@example.com'],
      from: 'default@example.com',
      apiKey: 'org-resend-key',
    }))
  })

  it('does not send internal email when this tenant has no internal recipient', async () => {
    const { ctx } = buildContext({
      appointment: buildAppointment({ customerEmail: null }),
      settings: null,
      resolver: createTestCredentialResolver(organizationResend),
    })

    await handle(publicBooking('tenant-2', 'org-2'), ctx)

    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('skips all email when the organization has no Resend credential instead of using the platform key', async () => {
    const previousGlobalResendKey = process.env.RESEND_API_KEY
    process.env.RESEND_API_KEY = 'global-resend-key'
    const { ctx, integrationLogService } = buildContext({
      appointment: buildAppointment(),
      settings: { from: 'bookings@example.com', to: 'spa@example.com', cc: '', bcc: '', replyTo: '' },
      resolver: createTestCredentialResolver({}),
    })
    try {
      await handle(publicBooking('tenant-3', 'org-3'), ctx)
    } finally {
      if (previousGlobalResendKey === undefined) delete process.env.RESEND_API_KEY
      else process.env.RESEND_API_KEY = previousGlobalResendKey
    }

    expect(sendEmail).not.toHaveBeenCalled()
    expect(integrationLogService.write).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info',
      code: 'resend.integration_not_configured',
    }), { tenantId: 'tenant-3', organizationId: 'org-3' })
  })

  it('keeps the disabled-integration log code when the organization switched Resend off', async () => {
    const { ctx, integrationLogService } = buildContext({
      appointment: buildAppointment(),
      settings: { from: '', to: 'spa@example.com', cc: '', bcc: '', replyTo: '' },
      resolver: createTestCredentialResolver({}, {
        failWith: new IntegrationCredentialError('integration_disabled', { integrationId: 'resend', service: 'email' }),
      }),
    })

    await handle(publicBooking(), ctx)

    expect(sendEmail).not.toHaveBeenCalled()
    expect(integrationLogService.write).toHaveBeenCalledWith(expect.objectContaining({ code: 'resend.disabled' }), {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })

  it('rethrows system credential failures so the persistent subscriber retries', async () => {
    const { ctx } = buildContext({
      appointment: buildAppointment(),
      settings: { from: '', to: 'spa@example.com', cc: '', bcc: '', replyTo: '' },
      resolver: createTestCredentialResolver({}, {
        failWith: new IntegrationCredentialError('credential_unreadable', { integrationId: 'resend' }),
      }),
    })

    await expect(handle(publicBooking(), ctx)).rejects.toMatchObject({ code: 'credential_unreadable' })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
