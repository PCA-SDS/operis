import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  aiProviderIntegrationId,
  isIntegrationCredentialError,
  isPermanentIntegrationCredentialError,
  type IntegrationCredentialResolver,
  type ResolvedIntegrationCredential,
} from '@open-mercato/shared/modules/integrations/credential-resolution'

const logger = createLogger('attachments').child({ component: 'ocr-credentials' })

export const OCR_AI_INTEGRATION_ID = aiProviderIntegrationId('openai')

/**
 * Resolves the OpenAI credential LLM OCR runs on for this organization. `null` means LLM OCR is not
 * available, and the upload keeps the local text extraction it used before without an OpenAI key.
 */
export async function resolveOcrCredential(
  resolver: IntegrationCredentialResolver | null | undefined,
  input: { tenantId: string | null; organizationId: string | null; attachmentId?: string | null },
): Promise<ResolvedIntegrationCredential | null> {
  if (!resolver) return null
  try {
    return await resolver.resolve({
      integrationId: OCR_AI_INTEGRATION_ID,
      scope: { tenantId: input.tenantId, organizationId: input.organizationId },
      operation: 'attachments.ocr',
      correlationId: input.attachmentId ?? null,
    })
  } catch (error) {
    if (isPermanentIntegrationCredentialError(error)) return null
    logger.error('OCR credentials could not be resolved; using local text extraction instead', {
      code: isIntegrationCredentialError(error) ? error.code : undefined,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      err: error,
    })
    return null
  }
}
