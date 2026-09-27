import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { RESEND_INTEGRATION_ID } from '../index'
import type { ResendEmailMessage, ResendEmailScope, ResendEmailService } from '../contract'

type IntegrationCredentialsService = {
  resolve(integrationId: string, scope: ResendEmailScope): Promise<Record<string, unknown> | null>
}

type IntegrationStateService = {
  isEnabled(integrationId: string, scope: ResendEmailScope): Promise<boolean>
}

const logger = createLogger('resend').child({ component: 'sender' })

function resolveString(credentials: Record<string, unknown> | null, key: string): string | undefined {
  const value = credentials?.[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function createResendEmailService(
  integrationCredentialsService: IntegrationCredentialsService,
  integrationStateService: IntegrationStateService,
): ResendEmailService {
  return {
    async send(scope: ResendEmailScope, message: ResendEmailMessage): Promise<void> {
      let stage: 'integration_state' | 'credentials' | 'configuration' | 'provider_request' = 'integration_state'
      try {
        if (!await integrationStateService.isEnabled(RESEND_INTEGRATION_ID, scope)) {
          throw new Error('[internal] Resend integration is disabled')
        }

        stage = 'credentials'
        const credentials = await integrationCredentialsService.resolve(RESEND_INTEGRATION_ID, scope)
        const apiKey = resolveString(credentials, 'apiKey')
        const fromEmail = resolveString(credentials, 'fromEmail')

        stage = 'configuration'
        if (!apiKey) throw new Error('[internal] Resend API key is not configured')
        if (!fromEmail) throw new Error('[internal] Resend sender email is not configured')

        stage = 'provider_request'
        await sendEmail({ ...message, apiKey, from: fromEmail })
      } catch (error) {
        logger.error('Resend email delivery failed', {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          stage,
          err: error,
        })
        throw error
      }
    },
  }
}
