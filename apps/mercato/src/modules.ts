// Central place to enable modules and their source.
// - id: module id (plural snake_case; special cases: 'auth')
// - from: '@open-mercato/core' | '@app' | custom alias/path in future
// - overrides: optional unified per-app override surface — replace or
//   disable any contract a module presents: AI, routes, events, workers,
//   widgets, notifications, interceptors, setup, ACL, DI, encryption, etc.
//   See `.ai/specs/implemented/2026-05-04-modules-ts-unified-overrides.md` and
//   `apps/docs/docs/framework/modules/overrides.mdx`.
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import type { ModuleOverrides } from '@open-mercato/shared/modules/overrides'
import { officialModuleEntries } from './official-modules.generated'

export type ModuleEntry = {
  id: string
  from?: '@open-mercato/core' | '@app' | string
  overrides?: ModuleOverrides
}

/**
 * Copyable examples for every wired `entry.overrides` domain.
 *
 * This object is intentionally not assigned to any enabled module. Use it as
 * a reference when a downstream app needs to disable or replace contracts
 * from a package-backed module without editing that module's source.
 */
export const moduleOverrideExamples: ModuleOverrides = {
  ai: {
    agents: { 'catalog.catalog_assistant': null },
    tools: { inbox_ops_accept_action: null },
    extensions: [], // additive AiAgentExtension[]; do not use null-map semantics
  },
  routes: {
    api: { 'DELETE /api/example/items': null },
    pages: { '/backend/example/reports': null },
  },
  events: {
    subscribers: { 'example.todo.audit': null },
  },
  workers: { 'example:sync': null },
  widgets: {
    injection: { 'example.sidebar': null },
    components: { 'page:/backend/example': null },
    dashboard: { 'example.kpi': null },
  },
  notifications: {
    types: { 'example.notice': null },
    handlers: { 'example.notice.toast': null },
  },
  interceptors: { 'example.items.interceptor': null },
  commandInterceptors: { 'example.command.interceptor': null },
  enrichers: { 'example.items.enricher': null },
  guards: { 'example.backend.guard': null },
  cli: { 'example seed': null },
  setup: {
    seedExamples: false,
  },
  acl: {
    features: { 'example.manage': null },
  },
  di: { exampleService: null },
  encryption: {
    maps: { 'example:item': null },
  },
  nav: {
    // Prepends sidebar nav group ids ahead of the built-in ordering; unnamed groups keep their
    // current position. Applied beneath role and per-user sidebar preferences.
    groupOrder: ['example.nav.group'],
  },
}

/**
 * Every module compiled into this deployment.
 *
 * Presence here is a *build* decision — it registers routes, APIs, DI, entities
 * and migrations. It is NOT the decision about who may see a module: that is
 * tenant entitlement (`tenant_modules`) narrowed by per-user restrictions
 * (`user_modules`), and each module declares whether a newly provisioned tenant
 * gets it switched on via `ModuleInfo.defaultEntitlement` in its `index.ts`.
 * A super admin re-enables a withheld module from
 * `/backend/directory/tenants/[id]/modules` with no redeploy.
 *
 * Remove an entry here only when the module has no place in the product at all
 * — development fixtures, or public pages that carry no tenant context for
 * entitlement to evaluate. See
 * `.ai/specs/2026-08-25-mvp-module-scope-and-ui-gating.md`.
 */
export const enabledModules: ModuleEntry[] = [
  { id: 'dashboards', from: '@open-mercato/core' },
  { id: 'auth', from: '@open-mercato/core' },
  { id: 'directory', from: '@open-mercato/core' },
  { id: 'customers', from: '@open-mercato/core' },
  { id: 'perspectives', from: '@open-mercato/core' },
  { id: 'entities', from: '@open-mercato/core' },
  { id: 'configs', from: '@open-mercato/core' },
  { id: 'query_index', from: '@open-mercato/core' },
  { id: 'audit_logs', from: '@open-mercato/core' },
  { id: 'attachments', from: '@open-mercato/core' },
  { id: 'catalog', from: '@open-mercato/core' },
  { id: 'sales', from: '@open-mercato/core' },
  { id: 'invoice', from: '@open-mercato/core' },
  { id: 'warranty_claims', from: '@open-mercato/core' },
  { id: 'wms', from: '@open-mercato/core' },
  { id: 'api_keys', from: '@open-mercato/core' },
  { id: 'devices', from: '@open-mercato/core' },
  { id: 'dictionaries', from: '@open-mercato/core' },
  { id: 'onboarding', from: '@open-mercato/onboarding' },
  { id: 'api_docs', from: '@open-mercato/core' },
  // Live DS component gallery at /backend/design-system (feature-gated by
  // design_system.view). Disable by removing this line.
  { id: 'design_system', from: '@open-mercato/core' },
  { id: 'business_rules', from: '@open-mercato/core' },
  { id: 'feature_toggles', from: '@open-mercato/core' },
  { id: 'workflows', from: '@open-mercato/core' },
  { id: 'search', from: '@open-mercato/search' },
  { id: 'currencies', from: '@open-mercato/core' },
  { id: 'planner', from: '@open-mercato/core' },
  { id: 'resources', from: '@open-mercato/core' },
  { id: 'staff', from: '@open-mercato/core' },
  // Work management: projects, Kanban boards, milestones, docs and the personal
  // task views. Disable by removing this line — the nav group, routes and APIs
  // all disappear with it.
  { id: 'tasks', from: '@open-mercato/core' },
  { id: 'events', from: '@open-mercato/events' },
  { id: 'notifications', from: '@open-mercato/core' },
  { id: 'progress', from: '@open-mercato/core' },
  { id: 'integrations', from: '@open-mercato/core' },
  { id: 'data_sync', from: '@open-mercato/core' },
  { id: 'sync_excel', from: '@open-mercato/core' },
  { id: 'messages', from: '@open-mercato/core' },
  // Communication channels hub (SPEC-045d) — bridges external chat/email channels
  // (Slack, WhatsApp, Email) to the unified Messages inbox. Provider packages
  // (channel-slack, channel-whatsapp, future email providers) register adapters here.
  { id: 'communication_channels', from: '@open-mercato/core' },
  // Push notification rails — `push` delivery strategy + delivery log + send-push worker.
  // Fans out to `devices` tokens and sends through the `communication_channels` hub.
  { id: 'push_notifications', from: '@open-mercato/core' },
  { id: 'ai_assistant', from: '@open-mercato/ai-assistant' },
  // OAuth 2.1 protected MCP endpoint. Exposes only what a module publishes as an
  // MCP scope (today: the tasks module's tasks:read / tasks:write). Removing this
  // line removes the endpoint and its OAuth discovery documents.
  { id: 'mcp', from: '@open-mercato/core' },
  { id: 'translations', from: '@open-mercato/core' },
  { id: 'scheduler', from: '@open-mercato/scheduler' },
  { id: 'inbox_ops', from: '@open-mercato/core' },
  { id: 'payment_gateways', from: '@open-mercato/core' },
  { id: 'checkout', from: '@open-mercato/checkout' },
  { id: 'gateway_stripe', from: '@open-mercato/gateway-stripe' },
  // Per-user email channels for the Communications Hub (SPEC-045d / email
  // integration spec). Each provider package registers its `ChannelAdapter`
  // at import time via `setup.ts`; the hub picks them up by `providerKey`.
  { id: 'channel_imap', from: '@open-mercato/channel-imap' },
  { id: 'channel_gmail', from: '@open-mercato/channel-gmail' },
  // Mobile push providers for the push_notifications channel. Each registers a
  // `push` ChannelAdapter at import time; the push delivery strategy routes each
  // device to the channel whose providerKey matches its push_provider.
  { id: 'channel_apns', from: '@open-mercato/channel-apns' },
  { id: 'channel_expo', from: '@open-mercato/channel-expo' },
  { id: 'channel_fcm', from: '@open-mercato/channel-fcm' },
  { id: 'sync_akeneo', from: '@open-mercato/sync-akeneo' },
  // One-shot TPS catalog importer. CLI only — no routes, no entities. Client
  // menu data lives in the package so core carries no single customer's catalogue.
  { id: 'migrate_tps', from: '@open-mercato/migrate-tps' },
  { id: 'shipping_carriers', from: '@open-mercato/core' },
  { id: 'eudr', from: '@open-mercato/core' },
  { id: 'webhooks', from: '@open-mercato/webhooks' },
  { id: 'customer_accounts', from: '@open-mercato/core' },
  { id: 'portal', from: '@open-mercato/core' },
]

// Official modules activated via official-modules.json / official-modules.local.json
// (managed by `yarn official-modules`; backed by the external/official-modules submodule).
for (const entry of officialModuleEntries) {
  if (!enabledModules.some((existing) => existing.id === entry.id)) enabledModules.push(entry)
}

if (parseBooleanWithDefault(process.env.OM_ENABLE_STORAGE_S3, false)) {
  enabledModules.push({ id: 'storage_s3', from: '@open-mercato/storage-s3' })
}

// Open Mercato's commercially-licensed `@open-mercato/enterprise` package (record
// locks, MFA/security, SSO, status overlays) is intentionally NOT part of this fork.
// See docs/architecture/adr/ADR-0002-exclude-enterprise-edition.md for the licensing
// rationale and the resulting capability gaps.
