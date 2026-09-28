import type { AiAgentDefinition } from '../ai-agent-definition'

const streamTextMock = jest.fn()
const resolveScopedAiModelMock = jest.fn()

jest.mock('ai', () => {
  const actual = jest.requireActual('ai')
  return {
    ...actual,
    streamText: (...args: unknown[]) => streamTextMock(...args),
    convertToModelMessages: (messages: unknown) => messages,
  }
})

jest.mock('../ai-credentials', () => ({
  ...jest.requireActual('../ai-credentials'),
  resolveScopedAiModel: (...args: unknown[]) => resolveScopedAiModelMock(...args),
}))

import { IntegrationCredentialError } from '@open-mercato/shared/modules/integrations/credential-resolution'
import { resetAgentRegistryForTests, seedAgentRegistryForTests } from '../agent-registry'
import { runAiAgentText } from '../agent-runtime'

function makeAgent(): AiAgentDefinition {
  return {
    id: 'customers.assistant',
    moduleId: 'customers',
    label: 'Customers assistant',
    description: 'Customers assistant',
    systemPrompt: 'System prompt base.',
    allowedTools: [],
  }
}

const authContext = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  userId: 'user-1',
  features: ['*'],
  isSuperAdmin: false,
}

const messages = [{ role: 'user' as const, id: 'm1', parts: [{ type: 'text' as const, text: 'hi' }] }]

describe('runAiAgentText credential resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetAgentRegistryForTests()
    seedAgentRegistryForTests([makeAgent()])
    streamTextMock.mockImplementation(() => ({
      toUIMessageStreamResponse: () => new Response('streamed', { status: 200 }),
      toTextStreamResponse: () => new Response('streamed', { status: 200 }),
    }))
    resolveScopedAiModelMock.mockResolvedValue({
      model: { id: 'claude-haiku-4-5', apiKey: 'sk-org-anthropic' },
      modelId: 'claude-haiku-4-5',
      providerId: 'anthropic',
      source: 'provider_default',
      credentialSource: 'customer',
      resolveProviderApiKey: () => 'sk-org-anthropic',
    })
  })

  it("resolves the model for the caller's own tenant and organization", async () => {
    const container = { resolve: jest.fn() }

    await runAiAgentText({ agentId: 'customers.assistant', messages: messages as never, authContext, container: container as never })

    expect(resolveScopedAiModelMock).toHaveBeenCalledTimes(1)
    expect(resolveScopedAiModelMock.mock.calls[0][0]).toMatchObject({
      container,
      request: {
        scope: { tenantId: authContext.tenantId, organizationId: authContext.organizationId },
        operation: 'ai_assistant.agent.customers.assistant',
      },
      model: expect.objectContaining({ moduleId: 'customers' }),
    })
    expect(streamTextMock.mock.calls[0][0]).toMatchObject({ model: { id: 'claude-haiku-4-5', apiKey: 'sk-org-anthropic' } })
  })

  it('stops before calling the model when the organization has no AI credential', async () => {
    resolveScopedAiModelMock.mockRejectedValue(
      new IntegrationCredentialError('integration_not_configured', { service: 'ai' }),
    )

    await expect(
      runAiAgentText({ agentId: 'customers.assistant', messages: messages as never, authContext, container: { resolve: jest.fn() } as never }),
    ).rejects.toMatchObject({ code: 'integration_not_configured' })
    expect(streamTextMock).not.toHaveBeenCalled()
  })
})
