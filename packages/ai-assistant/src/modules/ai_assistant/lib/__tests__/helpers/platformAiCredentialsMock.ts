import type { AiModelFactoryInput, AiModelFactoryRegistry } from '../../model-factory'

type ScopedModelInput = {
  container: unknown
  model: AiModelFactoryInput
  registry?: AiModelFactoryRegistry
}

/**
 * Module factory for `jest.mock('<path>/ai-credentials', ...)` in runtime tests that exercise
 * prompts, tools and loop controls rather than credential resolution. It resolves models exactly
 * as the platform-key path does (process env, the test's registry mock), so those tests keep
 * asserting the behaviour they were written for. Credential resolution itself is covered by
 * `ai-credentials.test.ts` and `agent-runtime-credentials.test.ts`.
 */
export function platformAiCredentialsMock() {
  const actual = jest.requireActual('../../ai-credentials')
  const { createModelFactory } = jest.requireActual('../../model-factory')
  const registryModule = require('@open-mercato/shared/lib/ai/llm-provider-registry')
  return {
    ...actual,
    resolveScopedAiModel: jest.fn(async (input: ScopedModelInput) => {
      const registry: AiModelFactoryRegistry = input.registry ?? registryModule.llmProviderRegistry
      const resolution = createModelFactory(input.container, { registry }).resolveModel(input.model)
      return {
        ...resolution,
        credentialSource: 'platform',
        resolveProviderApiKey: (providerId: string) => registry.get?.(providerId)?.resolveApiKey() ?? null,
      }
    }),
  }
}
