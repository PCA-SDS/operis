/** @jest-environment node */

import handle from '../appointment-created-email'
import { sendEmail } from '@open-mercato/shared/lib/email/send'

jest.mock('@open-mercato/shared/lib/email/send', () => ({ sendEmail: jest.fn() }))

describe('appointment created email subscriber', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('sends an internal booking notice and customer request email after a public booking', async () => {
    const appointment = {
      id: 'appointment-1',
      customerName: 'Ada Lovelace',
      customerSalutation: 'Ms',
      customerEmail: 'ada@example.com',
      customerPhone: '5551212',
      customerPhoneCountryCode: '+84',
      requestedStartAt: new Date('2026-09-16T03:00:00.000Z'),
      externalNotes: 'Quiet room requested',
      lines: { getItems: () => [] },
    }
    const em = {
      fork: jest.fn().mockReturnThis(),
      findOne: jest.fn()
        .mockResolvedValueOnce(appointment)
        .mockResolvedValueOnce({ name: 'Ben Thanh' }),
    }

    const settings = {
      from: 'bookings@example.com',
      to: 'spa@example.com,second-spa@example.com',
      cc: 'manager@example.com,second-manager@example.com',
      bcc: 'audit@example.com',
      replyTo: 'reply@example.com',
    }
    const stateService = { isEnabled: jest.fn().mockResolvedValue(true) }
    const credentialsService = { resolve: jest.fn().mockResolvedValue({ apiKey: 'tenant-resend-key', fromEmail: 'default@example.com' }) }
    const integrationLogService = { write: jest.fn().mockResolvedValue(undefined) }
    const moduleConfigService = { getRecord: jest.fn().mockResolvedValue({ source: 'tenant', value: settings }) }
    await handle(
      { id: 'appointment-1', tenantId: 'tenant-1', organizationId: 'org-1', source: 'public_booking' },
      { resolve: (name: string) => name === 'em' ? em : name === 'integrationLogService' ? integrationLogService : name === 'integrationStateService' ? stateService : name === 'integrationCredentialsService' ? credentialsService : moduleConfigService },
    )

    expect(em.findOne).toHaveBeenCalledTimes(2)
    expect(moduleConfigService.getRecord).toHaveBeenCalledWith(
      'appointments',
      'public_booking_email',
      { tenantId: 'tenant-1' },
    )
    expect(credentialsService.resolve).toHaveBeenCalledWith(
      'resend',
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
    expect(stateService.isEnabled).toHaveBeenCalledWith(
      'resend',
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
    expect(sendEmail).toHaveBeenCalledTimes(2)
    expect(sendEmail).toHaveBeenNthCalledWith(1, expect.objectContaining({
      apiKey: 'tenant-resend-key',
      to: ['spa@example.com', 'second-spa@example.com'],
      cc: ['manager@example.com', 'second-manager@example.com'],
      bcc: ['audit@example.com'],
      from: 'bookings@example.com',
      replyTo: 'reply@example.com',
    }))
    expect(sendEmail).toHaveBeenNthCalledWith(2, expect.objectContaining({
      apiKey: 'tenant-resend-key',
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

    await handle(
      { id: 'appointment-1', tenantId: 'tenant-1', organizationId: 'org-1' },
      ctx,
    )

    expect(ctx.resolve).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('records a provider failure without exposing recipient data', async () => {
    const appointment = {
      id: 'appointment-1',
      customerName: 'Ada Lovelace',
      customerEmail: null,
      requestedStartAt: new Date('2026-09-16T03:00:00.000Z'),
      lines: { getItems: () => [] },
    }
    const em = {
      fork: jest.fn().mockReturnThis(),
      findOne: jest.fn().mockResolvedValueOnce(appointment).mockResolvedValueOnce({ name: 'Branch' }),
    }
    const stateService = { isEnabled: jest.fn().mockResolvedValue(true) }
    const credentialsService = { resolve: jest.fn().mockResolvedValue({ apiKey: 'tenant-resend-key', fromEmail: 'default@example.com' }) }
    const moduleConfigService = { getRecord: jest.fn().mockResolvedValue({ source: 'tenant', value: { from: '', to: 'spa@example.com', cc: '', bcc: '', replyTo: '' } }) }
    const integrationLogService = { write: jest.fn().mockResolvedValue(undefined) }
    jest.mocked(sendEmail).mockRejectedValueOnce(new Error('Resend unavailable'))

    await handle(
      { id: 'appointment-1', tenantId: 'tenant-1', organizationId: 'org-1', source: 'public_booking' },
      { resolve: (name: string) => name === 'em' ? em : name === 'integrationLogService' ? integrationLogService : name === 'integrationStateService' ? stateService : name === 'integrationCredentialsService' ? credentialsService : moduleConfigService },
    )

    expect(integrationLogService.write).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      code: 'resend.email_failed',
      payload: { appointmentId: 'appointment-1', recipientType: 'internal', error: 'Resend unavailable' },
    }), { tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it('skips the customer email when there is no customer email address', async () => {
    const appointment = {
      id: 'appointment-1',
      customerName: 'Ada Lovelace',
      customerEmail: null,
      requestedStartAt: new Date('2026-09-16T03:00:00.000Z'),
      lines: { getItems: () => [] },
    }
    const em = {
      fork: jest.fn().mockReturnThis(),
      findOne: jest.fn()
        .mockResolvedValueOnce(appointment)
        .mockResolvedValueOnce({ name: 'Ben Thanh' }),
    }

    const moduleConfigService = { getRecord: jest.fn().mockResolvedValue({ source: 'tenant', value: { from: '', to: 'spa@example.com', cc: '', bcc: '', replyTo: '' } }) }
    const stateService = { isEnabled: jest.fn().mockResolvedValue(true) }
    const credentialsService = { resolve: jest.fn().mockResolvedValue({ apiKey: 'tenant-resend-key', fromEmail: 'default@example.com' }) }
    const integrationLogService = { write: jest.fn().mockResolvedValue(undefined) }
    await handle(
      { id: 'appointment-1', tenantId: 'tenant-1', organizationId: 'org-1', source: 'public_booking' },
      { resolve: (name: string) => name === 'em' ? em : name === 'integrationLogService' ? integrationLogService : name === 'integrationStateService' ? stateService : name === 'integrationCredentialsService' ? credentialsService : moduleConfigService },
    )

    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: ['spa@example.com'],
      from: 'default@example.com',
    }))
  })

  it('does not send internal email when this tenant has no internal recipient', async () => {
    const appointment = {
      id: 'appointment-1',
      customerName: 'Ada Lovelace',
      customerEmail: null,
      requestedStartAt: new Date('2026-09-16T03:00:00.000Z'),
      lines: { getItems: () => [] },
    }
    const em = {
      fork: jest.fn().mockReturnThis(),
      findOne: jest.fn().mockResolvedValueOnce(appointment).mockResolvedValueOnce({ name: 'Branch' }),
    }
    const moduleConfigService = { getRecord: jest.fn().mockResolvedValue(null) }
    const stateService = { isEnabled: jest.fn().mockResolvedValue(true) }
    const credentialsService = { resolve: jest.fn().mockResolvedValue({ apiKey: 'tenant-resend-key' }) }
    const integrationLogService = { write: jest.fn().mockResolvedValue(undefined) }
    await handle(
      { id: 'appointment-1', tenantId: 'tenant-2', organizationId: 'org-2', source: 'public_booking' },
      { resolve: (name: string) => name === 'em' ? em : name === 'integrationLogService' ? integrationLogService : name === 'integrationStateService' ? stateService : name === 'integrationCredentialsService' ? credentialsService : moduleConfigService },
    )
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('falls back to the global Resend key when scoped credentials are missing', async () => {
    const appointment = {
      id: 'appointment-1',
      customerName: 'Ada Lovelace',
      customerEmail: 'ada@example.com',
      requestedStartAt: new Date('2026-09-16T03:00:00.000Z'),
      lines: { getItems: () => [] },
    }
    const em = {
      fork: jest.fn().mockReturnThis(),
      findOne: jest.fn()
        .mockResolvedValueOnce(appointment)
        .mockResolvedValueOnce({ name: 'Branch' }),
    }
    const stateService = { isEnabled: jest.fn().mockResolvedValue(true) }
    const credentialsService = { resolve: jest.fn().mockResolvedValue(null) }
    const moduleConfigService = { getRecord: jest.fn().mockResolvedValue({
      source: 'tenant',
      value: { from: 'bookings@example.com', to: 'spa@example.com', cc: '', bcc: '', replyTo: '' },
    }) }
    const integrationLogService = { write: jest.fn().mockResolvedValue(undefined) }
    const previousGlobalResendKey = process.env.RESEND_API_KEY
    process.env.RESEND_API_KEY = 'global-resend-key'
    try {
      await handle(
        { id: 'appointment-1', tenantId: 'tenant-3', organizationId: 'org-3', source: 'public_booking' },
        { resolve: (name: string) => name === 'em' ? em : name === 'integrationLogService' ? integrationLogService : name === 'integrationStateService' ? stateService : name === 'integrationCredentialsService' ? credentialsService : moduleConfigService },
      )
    } finally {
      if (previousGlobalResendKey === undefined) delete process.env.RESEND_API_KEY
      else process.env.RESEND_API_KEY = previousGlobalResendKey
    }

    expect(sendEmail).toHaveBeenCalledTimes(2)
    expect(sendEmail).toHaveBeenNthCalledWith(1, expect.objectContaining({
      apiKey: undefined,
      to: ['spa@example.com'],
      from: 'bookings@example.com',
    }))
    expect(sendEmail).toHaveBeenNthCalledWith(2, expect.objectContaining({
      apiKey: undefined,
      to: 'ada@example.com',
      from: 'bookings@example.com',
    }))
    expect(integrationLogService.write).toHaveBeenCalledWith(expect.objectContaining({
      level: 'info',
      code: 'resend.scoped_credentials_missing',
    }), { tenantId: 'tenant-3', organizationId: 'org-3' })
  })
})
