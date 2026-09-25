import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { z } from 'zod'

type ResendHealthResult = {
  status: 'healthy' | 'degraded' | 'unhealthy'
  message: string
  details: Record<string, unknown>
}

function resolveApiKey(credentials: Record<string, unknown>): string {
  return typeof credentials.apiKey === 'string' ? credentials.apiKey.trim() : ''
}

function resolveSenderEmail(credentials: Record<string, unknown>): string {
  return typeof credentials.fromEmail === 'string' ? credentials.fromEmail.trim() : ''
}

function resolveSenderDomain(senderEmail: string): string {
  return senderEmail.slice(senderEmail.lastIndexOf('@') + 1).toLowerCase()
}

function parseDomains(payload: unknown): Array<{ name: string; status: string }> {
  if (typeof payload !== 'object' || payload === null || !('data' in payload) || !Array.isArray(payload.data)) {
    return []
  }
  return payload.data.flatMap((domain) => {
    if (typeof domain !== 'object' || domain === null) return []
    if (!('name' in domain) || typeof domain.name !== 'string') return []
    if (!('status' in domain) || typeof domain.status !== 'string') return []
    return [{ name: domain.name.toLowerCase(), status: domain.status.toLowerCase() }]
  })
}

export const resendHealthCheck = {
  async check(credentials: Record<string, unknown>, _scope: IntegrationScope): Promise<ResendHealthResult> {
    const apiKey = resolveApiKey(credentials)
    const senderEmail = resolveSenderEmail(credentials)
    const senderFormatValid = !senderEmail || z.string().email().safeParse(senderEmail).success
    if (!senderFormatValid) {
      return {
        status: 'unhealthy',
        message: 'Default sender email is invalid',
        details: { provider: 'resend', senderConfigured: true, senderFormatValid: false },
      }
    }
    if (!apiKey) {
      return {
        status: 'unhealthy',
        message: 'Resend API key is empty',
        details: { provider: 'resend' },
      }
    }

    try {
      const response = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${apiKey}` },
      })

      if (!response.ok) {
        if (response.status === 403) {
          return {
            status: 'degraded',
            message: 'Resend accepted the key but denied the non-sending domain probe; Sending access can still send from its permitted domain',
            details: {
              provider: 'resend',
              httpStatus: response.status,
              requiredPermission: 'full_access',
              ...(senderEmail ? { senderConfigured: true, senderFormatValid: true, senderDomainVerified: null } : {}),
            },
          }
        }
        return {
          status: 'unhealthy',
          message: `Resend rejected the API key with HTTP ${response.status}`,
          details: { provider: 'resend', httpStatus: response.status },
        }
      }

      if (senderEmail && typeof response.json === 'function') {
        const domains = parseDomains(await response.json())
        const senderDomain = resolveSenderDomain(senderEmail)
        const senderDomainVerified = domains.some((domain) => domain.name === senderDomain && domain.status === 'verified')
        if (!senderDomainVerified) {
          return {
            status: 'unhealthy',
            message: 'Default sender domain is not verified with Resend',
            details: { provider: 'resend', httpStatus: response.status, senderConfigured: true, senderFormatValid: true, senderDomainVerified: false },
          }
        }
        return {
          status: 'healthy',
          message: 'Connected to Resend and default sender domain is verified',
          details: { provider: 'resend', httpStatus: response.status, senderConfigured: true, senderFormatValid: true, senderDomainVerified: true },
        }
      }

      return {
        status: 'healthy',
        message: 'Connected to Resend',
        details: {
          provider: 'resend',
          httpStatus: response.status,
          ...(senderEmail ? { senderConfigured: true, senderFormatValid: true, senderDomainVerified: null } : {}),
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Resend connection error'
      return {
        status: 'unhealthy',
        message: `Resend connection failed: ${message}`,
        details: { provider: 'resend' },
      }
    }
  },
}
