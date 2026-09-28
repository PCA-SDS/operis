/** @jest-environment node */

import * as React from 'react'
import { createTestCredentialResolver } from '@open-mercato/shared/lib/testing/integrationCredentials'

const mockResolveTranslations = jest.fn()
const mockSendEmail = jest.fn()
const mockUrlForCustomerOrg = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: (...args: unknown[]) => mockResolveTranslations(...args),
}))

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerUrl', () => ({
  urlForCustomerOrg: (...args: unknown[]) => mockUrlForCustomerOrg(...args),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/emails/CustomerInvitationEmail', () => ({
  __esModule: true,
  default: (props: unknown) => React.createElement('customer-invitation-email', props),
}))

describe('sendCustomerInvitationEmail', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveTranslations.mockResolvedValue({
      translate: (key: string, fallback: string) => `${key}:${fallback}`,
    })
    mockUrlForCustomerOrg.mockResolvedValue('https://acme.example/portal/invite?token=raw%20token%2B%2F%3D')
    mockSendEmail.mockResolvedValue(undefined)
  })

  it('builds a portal invite link with the raw one-time token and sends the invite email', async () => {
    const { sendCustomerInvitationEmail } = await import('../invitationEmail')
    const resolver = createTestCredentialResolver({ resend: { secret: 'org-portal-key' } })
    const container = {
      resolve: jest.fn((name: string) => (name === 'integrationCredentialResolver' ? resolver : undefined)),
      hasRegistration: (name: string) => name === 'integrationCredentialResolver',
    }

    await sendCustomerInvitationEmail({
      container: container as never,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      email: 'buyer@example.com',
      rawToken: 'raw token+/=',
    })

    expect(mockUrlForCustomerOrg).toHaveBeenCalledWith(
      'org-1',
      '/invite?token=raw%20token%2B%2F%3D',
      { container },
    )
    expect(resolver.requests[0]).toMatchObject({
      integrationId: 'resend',
      scope: { tenantId: 'tenant-1', organizationId: 'org-1' },
      operation: 'customer_accounts.invitation.send',
    })
    expect(mockSendEmail).toHaveBeenCalledWith({
      apiKey: 'org-portal-key',
      to: 'buyer@example.com',
      subject: expect.stringContaining('customer_accounts.invitation.email.subject'),
      react: expect.objectContaining({
        props: expect.objectContaining({
          inviteUrl: 'https://acme.example/portal/invite?token=raw%20token%2B%2F%3D',
          copy: expect.objectContaining({
            cta: expect.stringContaining('customer_accounts.invitation.email.cta'),
          }),
        }),
      }),
    })
  })
})
