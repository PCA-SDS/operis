import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import PortalAiAssistantTriggerWidget from './widget.client'

/**
 * Step 4.10 — Portal AiChat injection example.
 *
 * Intentionally NOT mapped in `widgets/injection-table.ts`. The AI chat
 * routes accept staff sessions only (`getAuthFromRequest` rejects customer
 * tokens) and `customers.account_assistant` is a staff CRM agent, so a
 * portal customer would get a button that can never work. Map it again
 * only once a customer-facing AI endpoint, agent and feature exist.
 *
 * Demonstrates how a third-party module can drop `<AiChat>` onto a
 * portal page it does NOT own (the customer-portal profile page) via
 * the existing widget-injection system. Built for spot
 * `portal:profile:after` (see `PortalInjectionSpots.pageAfter('profile')`
 * in `packages/ui/src/backend/injection/spotIds.ts`).
 *
 * The trigger opens a right-side sheet embedding
 * `<AiChat agent="customers.account_assistant" pageContext={...} />`.
 * `pageContext` follows the spec §10.1 shape:
 *
 *   { view: 'portal.profile',
 *     recordType: 'customer',
 *     recordId: <customer-user-id | null>,
 *     extra: {} }
 *
 * Gated behind customer feature `portal.account.manage`, which is the
 * closest existing customer-facing feature (no dedicated
 * `portal.ai_assistant.view` feature exists yet — tracked as a
 * follow-up gap; see Step 4.10 checks).
 *
 * Phase 2 ships `customers.account_assistant` as the agent because no
 * dedicated customer-portal agent has been introduced yet.
 */
const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'customer_accounts.injection.portal-ai-assistant-trigger',
    title: 'Portal AI Assistant Trigger',
    description:
      'Renders an "Ask AI" button on the portal profile page that opens a sheet embedding the customers account assistant.',
    features: ['portal.account.manage'],
    priority: 100,
    enabled: true,
  },
  Widget: PortalAiAssistantTriggerWidget,
}

export default widget
