import {
  IntegrationCredentialError,
  requireIntegrationCredentialResolver,
  type IntegrationCredentialResolver,
  type IntegrationCredentialScopeInput,
  type IntegrationCredentialSource,
  type ResolvedIntegrationCredential,
} from '../../modules/integrations/credential-resolution'
import { isEmailDeliveryDisabled } from './delivery'
import { sendEmail, type SendEmailOptions } from './send'

export const RESEND_INTEGRATION_ID = 'resend'

type ResolverContainer = Parameters<typeof requireIntegrationCredentialResolver>[0]

export type CustomerEmailCredentialRequest = {
  scope: IntegrationCredentialScopeInput
  operation: string
  correlationId?: string | null
}

export type CustomerEmailMessage = Omit<SendEmailOptions, 'apiKey'> & {
  /**
   * Instance-wide sender configured for the feature (for example the notifications delivery
   * sender). With the organization's own credential the organization's default sender wins,
   * because its Resend account is unlikely to have verified the platform's domain; with the
   * platform credential it keeps its previous precedence over the platform env sender.
   */
  defaultFrom?: string | null
}

export type SendCustomerEmailInput = CustomerEmailMessage & CustomerEmailCredentialRequest

export type SendCustomerEmailResult = {
  source: IntegrationCredentialSource | null
}

/**
 * Resolves the organization's Resend credential through `integrationCredentialResolver`.
 * Returns `null` when email delivery is disabled (test mode), since nothing reaches a
 * provider. Throws `IntegrationCredentialError` when the organization has no key and
 * `OM_EMAIL_CREDENTIAL_FALLBACK` does not permit the platform key. Call it before
 * committing state that assumes the email will go out, then pass the result to
 * {@link deliverCustomerEmail}.
 */
export async function resolveCustomerEmailCredential(
  container: ResolverContainer,
  request: CustomerEmailCredentialRequest,
): Promise<ResolvedIntegrationCredential | null> {
  if (isEmailDeliveryDisabled()) return null
  return resolveCustomerEmailCredentialWith(requireIntegrationCredentialResolver(container), request)
}

/** Same as {@link resolveCustomerEmailCredential} for services that receive the resolver by injection. */
export async function resolveCustomerEmailCredentialWith(
  resolver: IntegrationCredentialResolver | null | undefined,
  request: CustomerEmailCredentialRequest,
): Promise<ResolvedIntegrationCredential | null> {
  if (isEmailDeliveryDisabled()) return null
  if (!resolver) throw new IntegrationCredentialError('resolver_unavailable')
  return resolver.resolve({
    integrationId: RESEND_INTEGRATION_ID,
    scope: request.scope,
    operation: request.operation,
    correlationId: request.correlationId ?? null,
  })
}

export async function deliverCustomerEmail(
  credential: ResolvedIntegrationCredential | null,
  message: CustomerEmailMessage,
): Promise<void> {
  const { defaultFrom, ...email } = message
  const configuredDefault = defaultFrom?.trim() || undefined
  if (!credential) {
    if (!isEmailDeliveryDisabled()) {
      throw new Error('[internal] deliverCustomerEmail requires a resolved credential while email delivery is enabled')
    }
    await sendEmail({ ...email, from: email.from ?? configuredDefault })
    return
  }
  const credentialSender = credential.settings.fromEmail
  const from = email.from ?? (credential.source === 'customer'
    ? credentialSender ?? configuredDefault
    : configuredDefault ?? credentialSender)
  await sendEmail({
    ...email,
    from,
    apiKey: credential.secret.reveal(),
  })
}

/**
 * Sends customer-facing email with the organization's own Resend credential. Platform and
 * account email (password reset, staff invitations, onboarding) keep calling `sendEmail`.
 */
export async function sendCustomerEmail(
  container: ResolverContainer,
  input: SendCustomerEmailInput,
): Promise<SendCustomerEmailResult> {
  const { scope, operation, correlationId, ...message } = input
  const credential = await resolveCustomerEmailCredential(container, { scope, operation, correlationId })
  await deliverCustomerEmail(credential, message)
  return { source: credential?.source ?? null }
}
