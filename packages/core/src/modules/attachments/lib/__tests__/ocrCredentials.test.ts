/** @jest-environment node */

import { IntegrationCredentialError } from '@open-mercato/shared/modules/integrations/credential-resolution'
import { createTestCredentialResolver } from '@open-mercato/shared/lib/testing/integrationCredentials'
import { OCR_AI_INTEGRATION_ID, resolveOcrCredential } from '../ocrCredentials'
import { OcrService } from '../ocrService'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }

describe('resolveOcrCredential', () => {
  it("returns the organization's OpenAI credential", async () => {
    const resolver = createTestCredentialResolver({ [OCR_AI_INTEGRATION_ID]: { secret: 'sk-org-openai', service: 'ai' } })

    const credential = await resolveOcrCredential(resolver, { ...scope, attachmentId: 'att-1' })

    expect(credential?.secret.reveal()).toBe('sk-org-openai')
    expect(resolver.requests[0]).toMatchObject({
      integrationId: 'ai_openai',
      scope,
      operation: 'attachments.ocr',
      correlationId: 'att-1',
    })
  })

  it('returns null so the upload keeps local extraction when OCR credentials are not usable', async () => {
    await expect(resolveOcrCredential(createTestCredentialResolver({}), scope)).resolves.toBeNull()
    await expect(resolveOcrCredential(null, scope)).resolves.toBeNull()
    await expect(
      resolveOcrCredential(
        createTestCredentialResolver({}, { failWith: new IntegrationCredentialError('credential_unreadable') }),
        scope,
      ),
    ).resolves.toBeNull()
  })
})

describe('OcrService', () => {
  const saved = process.env.OPENAI_API_KEY

  afterEach(() => {
    if (saved === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = saved
  })

  it('never falls back to the platform OPENAI_API_KEY', () => {
    process.env.OPENAI_API_KEY = 'sk-platform-openai'

    expect(new OcrService().available).toBe(false)
    expect(new OcrService({ apiKey: 'sk-org-openai' }).available).toBe(true)
  })
})
