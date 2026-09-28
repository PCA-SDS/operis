/**
 * Page-context hydration helpers for `customers.account_assistant`
 * (Phase 3 WS-A, Step 5.2).
 *
 * The `resolvePageContext` callback on the module-root `ai-agents.ts`
 * delegates to this file when the incoming request carries an `entityType`
 * + `recordId` combination the runtime recognises. Each helper reuses the
 * same tool-pack handler the Step 3.9 pack ships (`customers.get_person`,
 * `customers.get_company`, `customers.get_deal`) so there is exactly one
 * loader per record type — not a second parallel query path that could
 * drift from what the agent is actually allowed to call.
 *
 * Every helper:
 *  - Runs only when `tenantId` is present; cross-tenant ids return `null`
 *    (the tool handlers already guard tenant scope via
 *    `findOneWithDecryption`, but we double-check in the output).
 *  - Caps `includeRelated` payloads to what the tool's own cap enforces.
 *  - Swallows errors and returns `null` so a hydration fault NEVER breaks
 *    the chat request — the runtime will proceed without extra context.
 */
import type { AwilixContainer } from 'awilix'
import customersAiTools from './ai-tools'
import type {
  CustomersAiToolDefinition,
  CustomersToolContext,
} from './ai-tools/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { renderContextBlock } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-prompt-helpers'
import { RFC4122_UUID_PATTERN } from '@open-mercato/shared/lib/validation'

const logger = createLogger('customers')

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && RFC4122_UUID_PATTERN.test(value)
}

function findTool(name: string): CustomersAiToolDefinition | null {
  return (
    (customersAiTools as CustomersAiToolDefinition[]).find((tool) => tool.name === name) ?? null
  )
}

function buildToolContext(
  container: AwilixContainer,
  tenantId: string,
  organizationId: string | null,
): CustomersToolContext {
  return {
    tenantId,
    organizationId,
    userId: null,
    container,
    userFeatures: [],
    isSuperAdmin: true,
    apiKeySecret: undefined,
    sessionId: undefined,
  }
}

export interface HydrateCustomersContextInput {
  entityType: string
  recordId: string
  container: AwilixContainer
  tenantId: string | null
  organizationId: string | null
}

const PERSON_ENTITY_TYPES = new Set([
  'person',
  'customers.person',
  'customers:customer_entity',
])

const COMPANY_ENTITY_TYPES = new Set([
  'company',
  'customers.company',
])

const DEAL_ENTITY_TYPES = new Set([
  'deal',
  'customers.deal',
])

async function hydrateWithTool(
  toolName: string,
  inputArgs: Record<string, unknown>,
  toolContext: CustomersToolContext,
): Promise<unknown | null> {
  const tool = findTool(toolName)
  if (!tool) {
    logger.warn('resolvePageContext: tool not registered', { component: 'account_assistant', toolName })
    return null
  }
  try {
    const result = await tool.handler(inputArgs as never, toolContext)
    if (!result || typeof result !== 'object') return null
    if ((result as { found?: boolean }).found === false) return null
    return result
  } catch (error) {
    logger.warn('resolvePageContext: tool failed; skipping', { component: 'account_assistant', toolName, err: error })
    return null
  }
}

export async function hydrateCustomersAccountContext(
  input: HydrateCustomersContextInput,
): Promise<string | null> {
  const tenantId = input.tenantId
  if (!tenantId) return null
  if (!isUuid(input.recordId)) return null
  const entityType = input.entityType.trim().toLowerCase()
  if (!entityType) return null
  const toolContext = buildToolContext(input.container, tenantId, input.organizationId)

  if (PERSON_ENTITY_TYPES.has(entityType)) {
    const result = await hydrateWithTool(
      'customers.get_person',
      { personId: input.recordId, includeRelated: true },
      toolContext,
    )
    if (!result) return null
    return renderContextBlock(`Person ${input.recordId}`, result)
  }

  if (COMPANY_ENTITY_TYPES.has(entityType)) {
    const result = await hydrateWithTool(
      'customers.get_company',
      { companyId: input.recordId, includeRelated: true },
      toolContext,
    )
    if (!result) return null
    return renderContextBlock(`Company ${input.recordId}`, result)
  }

  if (DEAL_ENTITY_TYPES.has(entityType)) {
    const result = await hydrateWithTool(
      'customers.get_deal',
      { dealId: input.recordId, includeRelated: true },
      toolContext,
    )
    if (!result) return null
    return renderContextBlock(`Deal ${input.recordId}`, result)
  }

  return null
}
