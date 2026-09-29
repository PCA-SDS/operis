import * as React from 'react'
import { sendEmail } from '../send'
import {
  deliverCustomerEmail,
  resolveCustomerEmailCredential,
  resolveCustomerEmailCredentialWith,
  sendCustomerEmail,
} from '../customer-send'
import { createTestCredentialResolver } from '../../testing/integrationCredentials'

jest.mock('../send', () => ({ sendEmail: jest.fn() }))

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const message = { to: 'customer@example.com', subject: 'Hello', react: React.createElement('div', null, 'Hi') }

function containerWith(resolver: unknown) {
  return {
    resolve: <T,>(name: string) => (name === 'integrationCredentialResolver' ? resolver : undefined) as T,
    hasRegistration: (name: string) => name === 'integrationCredentialResolver',
  }
}

describe('customer email delivery', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_TEST_MODE
    delete process.env.OM_DISABLE_EMAIL_DELIVERY
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('sends with the organization key and its default sender', async () => {
    const resolver = createTestCredentialResolver({ resend: { secret: 're_org', settings: { fromEmail: 'Acme <billing@acme.test>' } } })

    const result = await sendCustomerEmail(containerWith(resolver), { ...message, scope, operation: 'test.send' })

    expect(result).toEqual({ source: 'customer' })
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 're_org', from: 'Acme <billing@acme.test>' }))
    expect(resolver.requests[0]).toMatchObject({ integrationId: 'resend', scope, operation: 'test.send' })
  })

  it('lets a feature-provided sender win over the credential sender', async () => {
    const resolver = createTestCredentialResolver({ resend: { secret: 're_org', settings: { fromEmail: 'Acme <billing@acme.test>' } } })

    await sendCustomerEmail(containerWith(resolver), { ...message, from: 'Bookings <book@acme.test>', scope, operation: 'test.send' })

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ from: 'Bookings <book@acme.test>' }))
  })

  it('orders the instance default sender after the organization sender and before the platform sender', async () => {
    const customer = createTestCredentialResolver({ resend: { secret: 're_org', settings: { fromEmail: 'Acme <billing@acme.test>' } } })
    const platform = createTestCredentialResolver({ resend: { secret: 're_platform', source: 'platform', settings: { fromEmail: 'ops@platform.test' } } })

    await deliverCustomerEmail(await resolveCustomerEmailCredential(containerWith(customer), { scope, operation: 'a' }), {
      ...message,
      defaultFrom: 'notifications@platform.test',
    })
    await deliverCustomerEmail(await resolveCustomerEmailCredential(containerWith(platform), { scope, operation: 'b' }), {
      ...message,
      defaultFrom: 'notifications@platform.test',
    })

    expect(jest.mocked(sendEmail).mock.calls[0]?.[0]).toMatchObject({ from: 'Acme <billing@acme.test>', apiKey: 're_org' })
    expect(jest.mocked(sendEmail).mock.calls[1]?.[0]).toMatchObject({ from: 'notifications@platform.test', apiKey: 're_platform' })
  })

  it('does not send and surfaces the configuration error when the organization has no key', async () => {
    await expect(
      sendCustomerEmail(containerWith(createTestCredentialResolver({})), { ...message, scope, operation: 'test.send' }),
    ).rejects.toMatchObject({ code: 'integration_not_configured', service: 'email' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('fails closed when the resolver is not registered', async () => {
    await expect(
      sendCustomerEmail({ resolve: jest.fn(), hasRegistration: () => false }, { ...message, scope, operation: 'test.send' }),
    ).rejects.toMatchObject({ code: 'resolver_unavailable' })
    await expect(resolveCustomerEmailCredentialWith(undefined, { scope, operation: 'x' })).rejects.toMatchObject({
      code: 'resolver_unavailable',
    })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('refuses to deliver without a credential while delivery is enabled', async () => {
    await expect(deliverCustomerEmail(null, message)).rejects.toThrow('[internal]')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('skips credential resolution entirely when email delivery is disabled', async () => {
    process.env.OM_TEST_MODE = 'true'
    const resolver = createTestCredentialResolver({})

    const result = await sendCustomerEmail(containerWith(resolver), { ...message, scope, operation: 'test.send' })

    expect(result).toEqual({ source: null })
    expect(resolver.requests).toHaveLength(0)
    expect(jest.mocked(sendEmail).mock.calls[0]?.[0]).not.toHaveProperty('apiKey')
  })
})
