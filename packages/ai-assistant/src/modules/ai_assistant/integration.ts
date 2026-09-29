import type { IntegrationBundle, IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'
import { buildAiProviderIntegrations } from './lib/ai-provider-integrations'

export const integrations: IntegrationDefinition[] = buildAiProviderIntegrations()
export const bundles: IntegrationBundle[] = []
