import type { IntegrationBundle, IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const RESEND_INTEGRATION_ID = 'resend'

export const integration: IntegrationDefinition = {
  id: RESEND_INTEGRATION_ID,
  title: 'Resend',
  description: 'Send transactional emails through a Resend account scoped to this tenant and organization.',
  category: 'communication',
  providerKey: 'resend',
  icon: 'mail',
  docsUrl: 'https://resend.com/docs',
  package: '@open-mercato/core',
  tags: ['email', 'resend', 'transactional'],
  defaultState: { isEnabled: true },
  healthCheck: { service: 'resendHealthCheck' },
  credentials: {
    fields: [
      {
        key: 'apiKey',
        label: 'Resend API key',
        type: 'secret',
        required: true,
        placeholder: 're_...',
        helpText: 'Use Sending access for normal email delivery. Full access is only needed for domain-aware health checks.',
      },
      {
        key: 'fromEmail',
        label: 'Default sender email',
        type: 'text',
        placeholder: 'noreply@example.com',
        helpText: 'Used when a feature does not provide its own sender email.',
      },
    ],
  },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
