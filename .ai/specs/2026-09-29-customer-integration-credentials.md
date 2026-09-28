# Customer Integration Credentials

## TLDR

Customer-facing email and AI features stop reading shared platform keys directly. One resolver,
`integrationCredentialResolver` (integrations module), decides which credential an organization
uses for a service. It returns the organization's own key from the existing encrypted
credentials store, or, only when a per-service server policy allows it, the platform key, and it
records every platform use. With the default policy (`disabled`), a missing customer key is a
typed, actionable configuration error.

## Overview

- Scope: credentials belong to an **organization** (the existing `integration_credentials` model;
  `organization_id` is required). No schema change.
- Services: `email` (Resend) and `ai` (LLM providers with fixed public endpoints).
- Policy: `OM_EMAIL_CREDENTIAL_FALLBACK` and `OM_AI_CREDENTIAL_FALLBACK`, each `disabled`
  (default) or `platform`. Any other value is treated as `disabled`.
- Customer-facing email uses the resolver: quotes, invoices, payment confirmations, checkout,
  appointments, customer portal signup and invitations, inbox replies, messages to external
  recipients. Platform mail keeps the platform key: staff password reset, staff invitations,
  onboarding, demo feedback, staff notifications, internal messages, the quote-accepted notice to
  `ADMIN_EMAIL`, and the inbound Resend webhook fetch.
- AI uses the resolver for agents, chat, structured runs, command-palette routing, inbox
  extraction, categorization and translation, warranty AI and document OCR. The command-palette
  chat (OpenCode server) can only use its own
  server key, so it is allowed only when the AI policy permits platform use, and each use is
  recorded.
- Semantic search embeddings stay on the platform key as shared search infrastructure (one global
  index and embedding model; tenant-wide jobs have no organization).

## Problem Statement

`sendEmail` falls back to `RESEND_API_KEY`, and 15 of 16 senders never pass a customer key. The
only customer-key reader (appointments) silently falls back to the platform key. Every AI path
reads provider keys from `process.env`. `createCredentialsService().getRaw` returns `{}` when a
stored credential cannot be decrypted, which is indistinguishable from "not configured" and would
silently enable fallback. The Test action can only test saved credentials.

## Proposed Solution

1. **Contract** (`@open-mercato/shared/modules/integrations/credential-resolution`): resolver
   interface, request/result types, `IntegrationCredentialError` with a runtime code list and a
   structural guard (no `instanceof` across chunks), and `IntegrationSecret`, a wrapper whose
   `toJSON`/`toString`/inspect output is `[redacted]`; only `reveal()` returns the value.
2. **Definition opt-in**: `IntegrationDefinition.credentialResolution` declares the service, the
   secret field and the platform env names per field. Provider packages own their env names;
   core stays provider-agnostic.
3. **Strict read**: `integrationCredentialsService.readForResolution` returns `missing` or
   `present`, and throws `credential_unreadable` when a stored row cannot be decrypted or parsed.
   Existing `getRaw`/`resolve` behaviour is unchanged.
4. **Resolver** (`integrations/lib/credential-resolver.ts`, DI `integrationCredentialResolver`):
   - `resolve({ integrationId, scope, operation })` for one integration (email, OCR);
   - `resolveService({ service, scope, operation })` for AI: the organization's configured
     providers, else the policy; `markUsed(integrationId)` records platform use once the caller
     knows which provider it used;
   - `authorizePlatformUse({ integrationId, scope, operation })` for platform-only paths;
   - `getServiceStatus({ service, scope })` for "is it configured" UI checks, with no secrets
     and no usage records.
5. **Email**: `sendCustomerEmail(container, { scope, operation, ...email })` in
   `@open-mercato/shared/lib/email` resolves the Resend credential and calls `sendEmail` with an
   explicit key and sender.
6. **AI**: `resolveScopedAiModel` in `ai_assistant/lib/ai-credentials.ts` builds a model-factory
   env overlay: all provider secret env keys removed, then the organization's keys (customer) or
   the platform env (fallback). In customer mode `createModelFactory` receives
   `preferredProviderIds` (the organization's providers): env and agent-default provider or model
   picks for other providers are skipped, so an env pin to a provider the organization lacks does
   not block it. Request, caller and tenant overrides are unchanged; an explicit override to a
   provider the organization lacks is `integration_not_configured`. Platform use is recorded for
   the provider the factory picked.
7. **Integrations page**: AI provider integrations (`ai_<provider>`) generated from the provider
   registry for providers with fixed endpoints and authenticated model listing (openai,
   anthropic, google, deepinfra, groq, together, fireworks). Providers that need a base URL
   (azure, litellm, ollama, lm-studio) are excluded so customers cannot point keys or requests at
   arbitrary hosts. openrouter and requesty are excluded until a verified key-check call exists.
8. **Test action**: `POST /api/integrations/:id/health` accepts optional unsaved `credentials`.
   Masked placeholders merge with the stored secret. The check runs without persisting
   credentials, health state or logs and requires `integrations.credentials.manage`. The route is
   rate limited (30 per minute). Provider probes time out after 8 seconds, classify 401/403,
   429, 5xx, timeouts and connection failures, and submitted values are redacted from the message.
   The credentials form shows a **Test connection** control when the integration has a health
   check.

## Architecture

```
caller (route / subscriber / worker, trusted tenantId + organizationId)
  -> integrationCredentialResolver
       -> integration definition (service, secret field, platform env names)
       -> integrationStateService.isEnabled        (disabled -> integration_disabled)
       -> integrationCredentialsService.readForResolution  (strict; unreadable -> error)
       -> present: customer credential
       -> missing: policy(service)
            disabled -> integration_not_configured
            platform -> platform env -> integrationLogService (credentials.platform_fallback)
  -> provider call (Resend / AI SDK), secret revealed at the call site
```

Jobs carry `tenantId` and `organizationId` only; the worker resolves at execution, so a replaced
key applies to later executions and no secret enters a queue payload. No credential caching is
added.

## Data Models

No schema change. Fallback usage is recorded as `integration_logs` rows
(`code: credentials.platform_fallback`, payload: service, operation, correlationId, attribution).

## API Contracts

- `POST /api/integrations/:id/health`: optional body `{ credentials?: Record<string, unknown> }`.
  With credentials, requires `integrations.credentials.manage` (403 otherwise), validates like
  the save route (422), and persists nothing. Response shape unchanged. Rate limit 30 per minute.
- `GET /api/integrations/:id`: adds `hasHealthCheck`; the definition's `credentialResolution`
  (platform env names) is omitted from the response.
- `POST /api/chat` (OpenCode): 409 `platform_fallback_prohibited` unless
  `OM_AI_CREDENTIAL_FALLBACK=platform`.
- Customer-facing routes that send email or call AI may return
  `{ error, code: 'integration_not_configured' | 'integration_disabled' | ... }` with status
  409 (configuration), 400 (missing organization) or 503 (system errors).

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Default `disabled` stops customer email/AI for organizations without keys | High (intended) | Clear 409 errors, Integrations page entries, `UPGRADE_NOTES.md`; operators can set `platform` | Operators must communicate the change |
| Decryption failure treated as "not configured" enables fallback | High | Strict read, `credential_unreadable` never enters the policy path | None known |
| Secret leakage via logs/JSON/queues | High | `IntegrationSecret` redaction, secrets revealed only at the provider call, payloads carry ids only, tests assert logs | Provider SDK internals |
| Cross-tenant use | High | Scope comes from trusted server context; the credential filter pins tenant and organization; tests with two tenants and interleaving | None known |
| Platform key used although the org has its own key | Medium | AI env overlay strips platform keys whenever the org has any AI key | Model pinned by env to a provider the org lacks returns a configuration error |
| Base URL override exfiltrates keys | Medium | No customer base URLs added; existing overrides unchanged | Pre-existing tenant AI base URL override |
| Portal signup email skipped for an organization without a Resend key | Medium | The send runs after the response (as before) and logs the credential error | The signing-up customer gets no email until the organization adds a key |
| Usage records are not billing | Low | Each platform use is an `integration_logs` row with operation and correlation id | Billing or quota enforcement is not implemented |
| Test action used to probe providers with arbitrary keys | Low | Needs `integrations.credentials.manage`, rate limited, fixed provider endpoints only | None known |

## Final Compliance Report — 2026-09-29

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/integrations/AGENTS.md`
- `packages/ai-assistant/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Never expose cross-tenant data or skip tenant scoping | Compliant | Resolver requires UUID tenant and organization ids; reads pin tenant, organization and `user_id IS NULL`; two-tenant and interleaving tests |
| root AGENTS.md | Use `findWithDecryption` | Compliant | `readManyForResolution` uses it; the credential blob is decrypted strictly with the tenant key |
| root AGENTS.md | Validate inputs with zod | Compliant | The Test action reuses `saveCredentialsSchema` and URL field validation |
| root AGENTS.md | No hard-coded user-facing strings | Compliant | 16 keys in all 8 locales; `i18n:check-sync` passes |
| root AGENTS.md (Design System) | Semantic tokens and shared primitives only | Compliant | `StatusBadge`, `text-status-error-text`, `text-muted-foreground` |
| root AGENTS.md | `apiCall`, never raw `fetch`, in UI | Compliant | `CredentialTestField` uses `apiCall`; the test POST writes nothing, so no mutation guard |
| root AGENTS.md | Never commit credentials | Compliant | Tests use fake keys only |
| packages/core/AGENTS.md | Structural error guards across chunks | Compliant | `isIntegrationCredentialError` checks `name` and `code` |
| packages/core/AGENTS.md | Custom write routes run mutation guards | Compliant | Save path unchanged; the test path persists nothing |
| integrations AGENTS.md | Secret-bearing fields use `secret` | Compliant | AI `apiKey` fields are `secret` |
| integrations AGENTS.md | Health checks registered by the provider module | Compliant | Resend in `email-resend`, AI checks in `ai-assistant` `di.ts` |
| integrations AGENTS.md | Never special-case provider env in core | Compliant | Each provider definition declares its own `platformEnv` |
| integrations AGENTS.md | Ask before changing resolution order, health-check timeouts or redaction | Flagged | New strict read path with the same order; 8 s provider timeouts inside the existing 10 s limit; submitted values redacted from probe messages |
| ai-assistant AGENTS.md | Model selection through the factory | Compliant | `resolveScopedAiModel` wraps `createModelFactory` |
| ai-assistant AGENTS.md | Ask before changing provider/model resolution precedence | Flagged | Customer mode skips env and agent-default picks for providers the organization lacks (`preferredProviderIds`) |
| ai-assistant AGENTS.md | Never log credentials | Compliant | `IntegrationSecret` redaction; logs carry ids only |
| .ai/qa/AGENTS.md | Integration tests are self-contained with cleanup | Compliant | TC-INT-011 creates and removes its own organization, users, role and rows |

### Verification (local mode)

- Passed: `build:packages` (27/27), `generate`, `build:packages`, `i18n:check-sync`, `i18n:check-usage` (advisory; no new key unused), `lint:check-graph`, `lint` (0 errors), `test:repo-wide-guards`, `test:scripts`, `audit:ci`, `check:time-bombs:fail`, `typecheck:serial` (27/27), `test:ci` (57/57 tasks; core 1,611 suites and 13,736 tests), ESLint on every changed file, `agents:check-budget`.
- `test:ci` passed on attempt 3; attempts 1 and 2 lost a `packages/cli` worker to the known macOS V8 crash. Attempt 1 also exposed 3 real failures in `quotes.acceptance.test.ts`, fixed before attempt 2.
- `ai-assistant` has no `typecheck` script; a scratch `tsc` over its sources reported 0 errors.
- Pending: `build:app`, the Docker image build, the Playwright run of `integrations/__integration__` (including TC-INT-011), a browser check of the Integrations page, and the independent security review findings.

### Internal Consistency Check

The Overview, Proposed Solution, API Contracts and Risks sections were updated on 2026-09-29 to match the implementation.

## Changelog

- 2026-09-29: Spec created with product decisions (per-organization scope, both fallback
  policies default `disabled`, customer-facing email classification, embeddings and OpenCode
  handling).
- 2026-09-29: Implemented the resolver, the Integrations page Test action and AI category, the
  email and AI migrations and execution-time job resolution. Docs: `.env.example`,
  `UPGRADE_NOTES.md`, the integrations and ai-assistant guides, the AI overview and the
  integrations user guide. Verification status is in the Final Compliance Report.
