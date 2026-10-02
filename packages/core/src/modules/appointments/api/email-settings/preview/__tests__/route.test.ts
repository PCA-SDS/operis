/** @jest-environment node */

let authValue: Record<string, unknown> | null = { tenantId: 'tenant-1' }

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authValue),
}))
jest.mock('@react-email/components', () => {
  const actual = jest.requireActual('@react-email/components')
  return { ...actual, render: jest.fn(async () => '<!doctype html><html><body>Rendered email</body></html>') }
})

import { DEFAULT_APPOINTMENT_EMAIL_SETTINGS } from '../../../../lib/email-settings'
import { POST } from '../route'

function request(body: unknown) {
  return new Request('http://localhost/api/appointments/email-settings/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('appointment email preview route', () => {
  beforeEach(() => {
    authValue = { tenantId: 'tenant-1' }
  })

  it('renders both exact original emails without saving', async () => {
    const response = await POST(request(DEFAULT_APPOINTMENT_EMAIL_SETTINGS))
    const result = await response.json() as {
      internal: { subject: string; html: string }
      customer: { subject: string; html: string }
    }

    expect(response.status).toBe(200)
    expect(result.internal.subject).toBe('[TPS][BR] from Ms. Ruby Chou - Bến Thành')
    expect(result.internal.html).toContain('Rendered email')
    expect(result.customer.subject).toBe('Your booking has been recorded – The Privé Spa')
    expect(result.customer.html).toContain('Rendered email')
  })

  it('rejects an invalid custom color', async () => {
    const response = await POST(request({
      ...DEFAULT_APPOINTMENT_EMAIL_SETTINGS,
      templateMode: 'custom',
      customization: { ...DEFAULT_APPOINTMENT_EMAIL_SETTINGS.customization, accentColor: 'red' },
    }))

    expect(response.status).toBe(400)
  })

  it('requires authentication', async () => {
    authValue = null
    const response = await POST(request(DEFAULT_APPOINTMENT_EMAIL_SETTINGS))
    expect(response.status).toBe(401)
  })
})
