export const RESEND_INTEGRATION_ID = 'resend'

export const metadata = {
  id: RESEND_INTEGRATION_ID,
  title: 'Resend Email',
  description: 'Send transactional email through Resend with tenant and organization-scoped credentials.',
  requires: ['integrations'],
  defaultEntitlement: 'enabled' as const,
  category: 'Communication' as const,
}
