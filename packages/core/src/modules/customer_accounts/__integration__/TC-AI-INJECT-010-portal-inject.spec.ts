import { test, expect } from '@playwright/test';
import type { ModuleInjectionSlot } from '@open-mercato/shared/modules/widgets/injection';
import injectionTable from '@open-mercato/core/modules/customer_accounts/widgets/injection-table';

const PORTAL_AI_TRIGGER_WIDGET_ID = 'customer_accounts.injection.portal-ai-assistant-trigger';

function slotWidgetId(slot: ModuleInjectionSlot): string {
  return typeof slot === 'string' ? slot : slot.widgetId;
}

/**
 * TC-AI-INJECT-010: the portal "Ask AI" trigger stays unmapped.
 *
 * The widget embeds `customers.account_assistant`, a staff CRM agent, and
 * every AI chat route accepts staff sessions only, so a portal customer
 * could never use it. It must not be mapped to any spot until a
 * customer-facing AI endpoint exists.
 */
test.describe('TC-AI-INJECT-010: portal AiChat trigger', () => {
  test('portal-ai-assistant-trigger is not mapped to any injection spot', () => {
    const widgetIds = Object.values(injectionTable)
      .flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))
      .map(slotWidgetId);
    expect(widgetIds.length).toBeGreaterThan(0);
    expect(widgetIds).not.toContain(PORTAL_AI_TRIGGER_WIDGET_ID);
  });
});
