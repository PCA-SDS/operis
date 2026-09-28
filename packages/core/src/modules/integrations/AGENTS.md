# Integrations Module — Agent Guide

The `integrations` module is the foundation layer for all external connectors (payment gateways, shipping carriers, communication channels, data sync providers, etc.). It provides three shared mechanisms: **Integration Registry**, **Credentials API**, and **Operation Logs**.

**Spec**: `.ai/specs/implemented/SPEC-045-2026-02-24-integration-marketplace.md` + `.ai/specs/implemented/SPEC-045a-foundation.md`

---

## Always

- **Always scope by organizationId + tenantId** — every entity query and service call
- **Use `findWithDecryption`/`findOneWithDecryption`** for credential reads
- **New providers MUST support provider-owned env preconfiguration** when credentials/settings are deployment-managed; implement it in the provider package, not in core
- **Secret-bearing credential fields MUST use `secret`, `oauth`, or `ssh_keypair`** — never declare tokens, passwords, or private keys as `text`, and never embed credentials in a `url` field
- **Health check services** must be registered in DI by the provider module, not by integrations
- **API routes must export `openApi`** for documentation generation
- **All user-facing strings** via i18n keys in `i18n/en.json`
- **Keep ACL default export shape** consistent: `export const features = [...]; export default features`
- **Registry/type contracts** live in `@open-mercato/shared/modules/integrations/types`
- **Resolve tenant service keys through `integrationCredentialResolver`** (see Organization Credentials below); never read a provider key from `process.env` for tenant work

## Ask First

- Ask before changing credential resolution order, registry type contracts, canonical API routes, or compatibility surfaces.
- Ask before moving provider-specific logic into this module.
- Ask before changing health-check timeouts, log retention semantics, or credential redaction behavior.

## Never

- Never import from provider modules — integrations module is generic; providers import from integrations, not vice versa.
- Never log credential values — log service strips secret fields from payload.
- Never special-case provider env presets, credentials, mappings, or enabled state in core.
- Never remove legacy `integrations.detail:tabs` fallback without a compatibility plan.
- Never fall back to platform credentials after a read, decryption, database or configuration error. Only a missing credential under the `platform` policy may use them.
- Never return, log, or queue a resolved secret. Keep it in the `IntegrationSecret` wrapper and call `reveal()` only at the provider call.

## Validation Commands

```bash
yarn generate
yarn workspace @open-mercato/core build
```

## Module Structure

```
packages/core/src/modules/integrations/
├── index.ts                     # Module metadata
├── di.ts                        # DI registrations (4 services)
├── acl.ts                       # Features: view, manage, credentials.manage
├── setup.ts                     # Default role features
├── events.ts                    # 4 typed events
├── data/
│   ├── entities.ts              # IntegrationCredentials, IntegrationState, IntegrationLog, SyncExternalIdMapping
│   ├── validators.ts            # Zod schemas for all API inputs
│   └── enrichers.ts             # External ID response enricher
├── lib/
│   ├── registry-service.ts      # Read-only access to in-memory integration registry
│   ├── credentials-service.ts   # Encrypted CRUD + bundle credential fallthrough
│   ├── state-service.ts         # Enable/disable + API version + reauth + health state
│   ├── log-service.ts           # Structured logging with scoped loggers + pruning
│   └── health-service.ts        # Resolves and runs provider health checks via DI
├── api/
│   ├── route.ts                 # GET /api/integrations — list all
│   ├── logs/route.ts            # GET /api/integrations/logs — query logs
│   └── [id]/
│       ├── route.ts             # GET /api/integrations/:id — detail
│       ├── state/route.ts       # PUT — enable/disable
│       ├── credentials/route.ts # GET/PUT — read/save credentials
│       ├── version/route.ts     # PUT — change API version
│       └── health/route.ts      # POST — trigger health check
├── workers/
│   ├── log-pruner.ts            # Scheduled log retention cleanup
│   └── health-probe.ts          # Periodic health checks (queue: integration-health-probe)
├── backend/
│   └── integrations/
│       ├── page.tsx             # Marketplace listing page
│       ├── page.meta.ts
│       ├── [id]/
│       │   ├── page.tsx         # Integration detail (tabs: credentials/version/health/logs)
│       │   └── page.meta.ts
│       └── bundle/[id]/
│           ├── page.tsx         # Bundle config (shared credentials + per-integration toggles)
│           └── page.meta.ts
├── widgets/
│   ├── injection-table.ts
│   └── injection/external-ids/
│       └── widget.client.tsx    # External ID display for any entity detail page
└── i18n/
    ├── en.json
    └── pl.json
```

## Key Services (DI)

| Service Name | Factory | Purpose |
|---|---|---|
| `integrationCredentialsService` | `createCredentialsService(em)` | Encrypted credential CRUD with bundle fallthrough |
| `integrationStateService` | `createIntegrationStateService(em)` | Upsert integration state (enabled, version, health, reauth) |
| `integrationLogService` | `createIntegrationLogService(em)` | Structured logging: write, query, prune, scoped logger |
| `integrationCredentialResolver` | `createIntegrationCredentialResolver(deps)` | Organization credentials for a service (email, AI) with the fallback policy and usage logging. See Organization Credentials below |
| `integrationHealthService` | `createHealthService(container, stateService, logService)` | Resolves named health check service from DI, runs check with **10s timeout**, returns `unconfigured` when no checker/credentials, persists latency, updates state |

Scheduled **integration-health-probe** jobs (15m interval) are registered from `setup.seedDefaults` when `schedulerService` is available; target payload is `{ scope: { organizationId, tenantId } }`.

## Adding a New Integration Provider

1. Create a new module (e.g., `packages/core/src/modules/gateway_stripe/`)
2. Add `integration.ts` at the module root exporting `IntegrationDefinition`
3. Declare `credentials.fields` for the admin UI to render a dynamic form
4. Optionally declare `healthCheck.service` (register the service in your `di.ts`)
5. Optionally declare `apiVersions` for versioned external APIs
6. Add provider-owned env preconfiguration when the integration can be deployment-managed: read env vars in the provider package, apply them from `setup.ts`, and expose a rerunnable provider CLI command when practical
7. Document the provider env vars in public docs or package docs
8. Run `yarn generate` to auto-discover the integration

### Provider-Owned Env Preconfiguration

If the provider needs credentials, default mappings, or enabled state after a fresh install, implement that in the provider package, not in `integrations`:

- Read env vars in a provider-local helper such as `lib/preset.ts`
- Apply the preset from the provider module's `setup.ts` so tenant bootstrap can configure the integration automatically
- Expose a provider-local CLI command (for example `configure-from-env`) so operators can rerun the same bootstrap logic later
- Keep env names stable and provider-prefixed (for example `OM_INTEGRATION_AKENEO_*`)
- Persist through the normal integration services (`integrationCredentialsService`, mapping APIs, state service); never special-case providers in core

### Bundle Integrations

For platform connectors with multiple integrations (e.g., MedusaJS):
- Export `bundle: IntegrationBundle` and `integrations: IntegrationDefinition[]`
- Set `bundleId` on each child integration
- Bundle credentials are shared via fallthrough: child reads own credentials first, then bundle's

## Credential Resolution Order

1. Direct credentials for the integration ID
2. If `bundleId` is set, fallback to bundle's credentials
3. Return `null` if neither exists

`readForResolution` / `readManyForResolution` follow the same order for the resolver, pin `user_id IS NULL`, and throw `credential_unreadable` instead of returning `null` when a stored row cannot be decrypted or parsed.

## Organization Credentials (email, AI)

Spec: `.ai/specs/2026-09-29-customer-integration-credentials.md`. Contract: `@open-mercato/shared/modules/integrations/credential-resolution`. Implementation: `lib/credential-resolver.ts`, registered as `integrationCredentialResolver`.

A provider opts in by declaring `credentialResolution: { service, secretField, platformEnv }` on its `IntegrationDefinition` (Resend is `email`; the `ai_<provider>` definitions from ai-assistant are `ai`). The resolver offers:

- `resolve({ integrationId, scope, operation, correlationId })`: the organization's credential for one integration. Scope needs UUID `tenantId` and `organizationId`.
- `resolveService({ service, ... })`: every enabled organization credential for a service, so AI can pick a provider.
- `authorizePlatformUse(...)`: gate for work that can only run on platform keys (the OpenCode chat).
- `getServiceStatus(...)`: "configured" flags for settings screens, without secrets.

Fallback policy per service: `OM_EMAIL_CREDENTIAL_FALLBACK` and `OM_AI_CREDENTIAL_FALLBACK`, each `disabled` (default) or `platform`; any other value is `disabled`. Under `platform`, a missing organization credential resolves from `platformEnv` after writing a `credentials.platform_fallback` integration log entry. If that write fails, the call fails.

Errors are `IntegrationCredentialError` with a `code` and HTTP `status`. Detect them with `isIntegrationCredentialError` (structural, safe across chunks) and answer with `integrationCredentialErrorResponse`. A background job stops without retrying on a permanent code (`isPermanentIntegrationCredentialError`, status below 500) and retries on a 5xx code.

| Code | Status | Meaning |
|---|---|---|
| `tenant_context_missing` | 400 | Scope lacks a tenant or organization id |
| `provider_unsupported` | 400 | The integration has no `credentialResolution` |
| `integration_disabled` | 409 | The organization disabled the integration |
| `integration_not_configured` | 409 | No organization key and fallback is disabled |
| `platform_fallback_prohibited` | 409 | Platform-only work while fallback is disabled |
| `credential_unreadable` | 503 | A stored key could not be read or decrypted; never falls back |
| `platform_credential_unavailable` | 503 | `platform` policy but the platform key is unset |
| `usage_recording_failed` | 503 | The fallback log entry could not be written |
| `resolver_unavailable` | 503 | The DI service is not registered |

Rules:

- Background jobs carry only tenant, organization and record ids, and resolve at execution time.
- Resolve before any side effect you cannot undo (for example, before marking a quote as sent).
- `POST /api/integrations/:id/health` with `{ credentials }` tests unsaved values: it runs the provider health check, saves nothing, needs `integrations.credentials.manage`, and redacts submitted values from the probe message.

## Per-User Credential Scoping

`IntegrationScope` carries an optional `userId?: string | null` (added 2026-05-26 for per-user email channels). Every `createCredentialsService` method scopes by it:

- **Omit `scope.userId`** (or pass `null`) for tenant-wide credentials (shared API keys, e.g. Stripe/Akeneo) — the filter pins `user_id IS NULL`, the historical behaviour.
- **Pass `scope.userId`** for per-user credentials (Gmail/IMAP mailboxes) — reads and writes land on that user's own row.

Uniqueness across `(integration_id, organization_id, tenant_id, user_id)` is enforced by the partial unique index `integration_credentials_user_lookup_idx` (`WHERE user_id IS NOT NULL AND deleted_at IS NULL`). **Callers MUST thread the correct `userId` on every per-user read AND write** — a tenant-wide scope can never read a user-scoped row and vice versa, so a missing `userId` silently resolves the wrong (or no) credentials.

## Events

| Event ID | Emitted When |
|---|---|
| `integrations.credentials.updated` | Credentials saved |
| `integrations.state.updated` | Integration enabled/disabled or reauth flag changed |
| `integrations.version.changed` | API version changed |
| `integrations.log.created` | Log entry written (excluded from triggers) |

## ACL Features

- `integrations.view` — view marketplace, detail, logs
- `integrations.manage` — enable/disable, change version, run health checks
- `integrations.credentials.manage` — read/save credentials

## UMES Extensibility

Integration provider modules can leverage the full **Unified Module Extension System (UMES)** — see `.ai/specs/implemented/SPEC-041-2026-02-24-universal-module-extension-system.md` for details.

### Available Extension Points for Providers

| Extension Mechanism | Use Case | Files |
|---|---|---|
| **Widget Injection** | Inject UI tabs, cards, or status badges into other modules' pages | `widgets/injection/`, `widgets/injection-table.ts` |
| **Event Subscribers** | React to integration events (`integrations.state.updated`, etc.) for side-effects | `subscribers/*.ts` |
| **Entity Extensions** | Link provider data to core entities (e.g., external IDs on orders) | `data/extensions.ts` |
| **Response Enrichers** | Attach provider-specific data to other modules' API responses | `data/enrichers.ts` |
| **API Interceptors** | Intercept other modules' API routes (before/after hooks) | `api/interceptors.ts` |
| **Component Replacement** | Override or wrap UI components from other modules | `widgets/components.ts` |
| **Menu Injection** | Add sidebar/settings menu items | via `useInjectedMenuItems` |
| **Notifications** | Emit in-app notifications on integration events | `notifications.ts`, `subscribers/` |
| **DOM Event Bridge** | Push real-time events to browser (SSE) | Set `clientBroadcast: true` in event definitions |

### Integration Detail Page Widget Spot

Provider modules can opt into a provider-scoped integration detail extension surface directly from `integration.ts`:

```typescript
import { buildIntegrationDetailWidgetSpotId } from '@open-mercato/shared/modules/integrations/types'

export const integration = {
  id: 'gateway_example',
  detailPage: {
    widgetSpotId: buildIntegrationDetailWidgetSpotId('gateway_example'),
  },
} satisfies IntegrationDefinition
```

- Register React widgets for that spot in `widgets/injection-table.ts`
- Use `placement.kind: 'tab'` to create additional detail tabs
- Use `placement.kind: 'group'` for card-style panels and `placement.kind: 'stack'` for inline sections
- Integration detail page writes run through `useGuardedMutation` with that same spot, so widget `onBeforeSave` / `onAfterSave` handlers apply to built-in credentials/state/version/health actions too
- Backward compatibility: legacy `integrations.detail:tabs` still works as the fallback when `detailPage.widgetSpotId` is omitted

### Marketplace API UMES Hooks

The integrations marketplace read routes now support a safe subset of UMES:

- `GET /api/integrations` and `GET /api/integrations/:id` support response enrichers targeting `integrations.integration`
- `GET /api/integrations/logs` supports response enrichers targeting `integrations.log`
- These read routes also execute API interceptors for their route IDs (`integrations`, `integrations/detail`, `integrations/logs`)
- Safety rule: integrations read routes preserve built-in response keys and only accept additive fields from enrichers/interceptor-after hooks
- Write routes (`credentials`, `state`, `version`) already support mutation guards and events; they are not yet wired into the generic API interceptor/enricher pipeline

### Key UMES Imports for Providers

```typescript
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import { useInjectionDataWidgets } from '@open-mercato/ui/backend/injection/useInjectionDataWidgets'
import { useInjectedMenuItems } from '@open-mercato/ui/backend/injection/useInjectedMenuItems'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
```

### Example: External ID Widget

The integrations module itself uses UMES to inject external ID displays on any entity detail page via `widgets/injection/external-ids/widget.client.tsx`, mapped through `widgets/injection-table.ts`. Follow this pattern for provider-specific widgets.

## Progress Delivery Contract

- `ProgressTopBar` uses `progress.job.*` SSE updates for live progress.
- SSE DOM bridge forwards only events with `clientBroadcast: true`.
- `progress.job.*` events are marked `clientBroadcast: true` and must be bridged across worker and web processes.

## Integration Test Expectations

- Module-local integration tests go under `__integration__/`
- Use helpers from `@open-mercato/core/modules/core/__integration__/helpers/*`
- Tests must create prerequisites via API and clean up in `finally`
