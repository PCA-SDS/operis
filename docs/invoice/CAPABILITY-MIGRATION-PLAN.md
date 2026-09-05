# Invoice Capability Migration Plan

This file converts Phase 1 dependencies into Day 3 implementation order. Each CAP
has target files, data rules, implementation type, tests, and done criteria.

Locked decisions:

- Module path: `packages/core/src/modules/invoice`
- Full parity target: CAP-001 through CAP-008
- No production data migration
- Existing `sales` invoice flow stays separate
- GDT sync uses queue worker plus `ProgressJob`
- Tenant and organization scoping is required everywhere
- Raw public tokens are never persisted; DB lookup/persistence uses token hashes.
- `invoice.ai.view` is reserved for the optional M10 helper and is inactive in M0.

## Implementation Milestones

| Milestone | Capability | Main result |
| --- | --- | --- |
| M0 | Module foundation | Module shell, ACL, setup, DI, entities, validators, OpenAPI helper. |
| M1 | CAP-003 | Partner payment terms. |
| M2 | CAP-006 | Company email memory. |
| M3 | CAP-007 | Exchange rates. |
| M4 | CAP-008 | Company lookup. |
| M5 | CAP-004 | Auto-paid rules. |
| M6 | CAP-001 | Invoice core. |
| M7 | CAP-005 | Payment confirmations. |
| M8 | CAP-002 | GDT tax portal sync. |
| M9 | UI parity | Backend pages and browser flows. |
| M10 | AI helper | Optional read-only invoice assistant. |

## Phase 3 Start Packet

Phase 3 can start with M0. Do not implement UI or GDT provider details before
the module foundation exists.

Before coding M0, read:

- `AGENTS.md`
- `packages/core/AGENTS.md`
- `docs/invoice/TARGET-INVOICE-ARCHITECTURE.md`
- `docs/invoice/OLD-TO-NEW-DATA-MAPPING.md`
- `docs/invoice/MIGRATION-DECISIONS.md`
- `.ai/specs/2026-08-25-invoice-module-migration.md`

M0 first PR should create only:

- module shell and auto-discovery files
- ACL and setup grants
- DI service placeholders if needed
- MikroORM entities and validators
- route/OpenAPI helper shape
- search contract for invoice companies and invoices
- migration files and snapshots
- focused smoke tests

M0 must not:

- change `sales`
- add production import scripts
- call GDT
- build backend pages beyond route/page placeholders needed for discovery
- store raw GDT secrets or raw public tokens

M0 is ready for M1 when `yarn generate`, `yarn db:generate`, and the smallest
relevant type/test checks pass or have a documented blocker.

## M0 Module Foundation

Dependencies:

- `packages/core/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/core/src/modules/progress/AGENTS.md`
- `packages/queue/AGENTS.md`

Target files:

- `index.ts`
- `acl.ts`
- `setup.ts`
- `di.ts`
- `events.ts`
- `search.ts`
- `data/entities.ts`
- `data/validators.ts`
- `api/openapi.ts`
- module migrations folder

Data requirements:

- Create all target tables from `OLD-TO-NEW-DATA-MAPPING.md`.
- Every table includes `tenant_id` and `organization_id`.
- User-editable entities include `updated_at`.
- Preserve enum values and limits from `Persisted Enums And Value Contracts`.
- Add optimistic locking to every user-editable entity.
- Add search configuration with `invoice.view` ACL gating, allowlisted text
  fields, tax-code hash-only fields, and token/hash exclusions.
- Keep `invoice_company_registry.payload` unencrypted in M0 only because M0 does
  not call lookup providers or write raw provider responses. M4 must revisit
  payload encryption before provider writes.

Optimistic locking decisions:

- `InvoiceLineItem`: no separate row-level optimistic lock for now. It is edited
  as part of the `Invoice` aggregate, so the parent `Invoice.updated_at` should
  protect the whole edit flow.
- `InvoiceSyncJob`: no optimistic lock because it is system-owned job state, not
  user-editable data.

Implementation type:

- Rewrite old Prisma schema into MikroORM v7 entities.
- Adapt old shared DTOs into Zod validators.
- Preserve old business enum values unless a later product decision removes them.

Expected tests:

- Entity discovery and route export smoke tests.
- ACL/setup grants test if local pattern exists.
- Migration generation review.
- Scope test proving invoice rows cannot be read across tenant or organization.

Definition of done:

- `yarn generate` discovers module files.
- `yarn db:generate` emits only intended invoice schema.
- No `sales` module behavior changes.
- DS governance pre-registers future invoice backend/component globs; mention
  this explicitly in the PR body.

## M1 CAP-003 Partner Payment Terms

Progress:

- Task 4.1 implemented the domain service, DI registration, partner validators,
  and focused unit coverage for list/search, matching, updates, and due-date
  default resolution.
- The API route and UI settings page remain for later CAP-003 tasks.

Dependencies:

- M0 tables and DI.

Target files:

- `services/partner-terms-service.ts`
- `api/partners/route.ts`
- `backend/invoice/settings/page.tsx`
- `data/validators.ts`

Data read/write:

- Reads `invoice_companies` scoped by tenant and organization.
- Writes only `default_due_days`.
- Does not rewrite partner identity from the settings route.

Implementation type:

- Preserve matching behavior.
- Rewrite DB access to MikroORM/Kysely style used by Operis.
- Adapt API to `/api/invoice/partners`.

Expected tests:

- Search/list is scoped.
- Update only changes `default_due_days`.
- Tax-code match wins and does not fall back to name.
- Name-only match is case-insensitive.

Definition of done:

- Manual invoice create and sync persistence can call the service for due-date defaults.

## M2 CAP-006 Company Email Memory

Dependencies:

- M0 table `invoice_company_emails`.
- Partner table.

Target files:

- `services/company-emails-service.ts`
- `api/company-emails/route.ts`
- recipient picker component under `components/`

Data read/write:

- Reads emails by company id and scope.
- Upserts normalized email by company and scope.
- Removes only scoped email rows.

Implementation type:

- Preserve behavior.
- Rewrite DB access and tenant/org scoping.

Expected tests:

- List by company is scoped.
- Upsert is idempotent.
- Remove cannot affect another tenant/org.
- Send invoice and payment confirmation record recipient best-effort.

Definition of done:

- CAP-001 send invoice and CAP-005 request confirmation can depend on this service.

## M3 CAP-007 Exchange Rates

Dependencies:

- M0 DI and config access.

Target files:

- `services/exchange-rates-service.ts`
- `api/exchange-rates/route.ts`

Data read/write:

- No invoice table writes.
- Optional process-local snapshot cache.

Implementation type:

- Preserve old process-local cache by default.
- Adapt provider HTTP/config access to Operis.

Expected tests:

- VND returns 1.
- Foreign rates use `rates.VND / rates[currency]`.
- Fresh cache is reused.
- Stale cache is used when upstream fails.
- No cache plus upstream failure returns service unavailable.
- Invalid upstream response is rejected.

Definition of done:

- Summary, forecast, and form preview can request rates.

## M4 CAP-008 Company Lookup

Dependencies:

- M0 table `invoice_company_registry`.
- Any shared company lookup provider available in Operis, or an invoice-local provider adapter if none exists.

Target files:

- `services/company-lookup-service.ts`
- `api/company-lookup/route.ts`
- form autofill component logic

Data read/write:

- Reads/writes `invoice_company_registry`.
- Does not create `invoice_companies`.
- Before writing provider payloads, either add payload encryption for
  `invoice_company_registry.payload` or document a stricter provider response
  shape that proves encryption is not required.

Implementation type:

- Adapt shared provider integration.
- Preserve invoice wrapper behavior and module gating.

Expected tests:

- Route requires auth and invoice feature.
- Country-aware identifier validation.
- Provider outage can serve allowed stale cache.
- Lookup does not create partner row.

Definition of done:

- Invoice form can autofill partner data before save.

## M5 CAP-004 Auto Paid

Dependencies:

- M0 invoice and rule tables.
- CAP-001 rollup helpers can be stubbed early or implemented in same milestone.

Target files:

- `services/auto-paid-service.ts`
- `commands/auto-paid.ts`
- `api/auto-paid/route.ts`
- settings UI

Data read/write:

- Reads/writes `invoice_auto_paid_tax_codes`.
- Bulk-updates scoped AP invoices.
- Must respect `auto_pay_excluded`.

Implementation type:

- Preserve domain behavior.
- Rewrite raw SQL/set-based update with scoped SQL suitable for current DB layer.
- Adapt to command side effects where user actions mutate rules.

Expected tests:

- Add rule upserts tax code.
- Add rule bulk-settles matching AP invoices.
- Remove rule reverts only invoices auto-settled by the rule.
- Reverse auto-paid marks unpaid and excluded.
- Repeated add/remove is idempotent.

Definition of done:

- Manual AP create and sync completion can call auto-paid logic.

## M6 CAP-001 Invoice Core

Dependencies:

- M0 through M5 for full parity.
- Mail abstraction for send flow.

Target files:

- `services/invoice-service.ts`
- `commands/invoices.ts`
- `api/invoices/route.ts`
- `api/summary/route.ts`
- `api/forecast/route.ts`
- `api/track/[token]/pixel.gif/route.ts`
- backend invoice pages

Data read/write:

- Reads/writes `invoice_invoices`, `invoice_invoice_line_items`,
  `invoice_installments`, `invoice_companies`.
- Dedicated endpoints mutate tenant-owned payment metadata.
- Generic update cannot mutate derived rollups.

Implementation type:

- Preserve AP/AR behavior.
- Rewrite persistence, commands, OpenAPI, and query/index integration.
- Adapt frontend to Operis backend UI components.

Expected tests:

- Tenant/org scoped list/detail.
- Imported invoice edit/delete blocked.
- Manual AP only and non-Vietnam partner only.
- Manual totals computed server-side.
- Duplicate guard.
- Explicit due date wins; otherwise partner default due days apply; otherwise
  due date stays null.
- Due date validation and update.
- AR settlement, non-recoverable, and installments recompute rollups.
- AP direct settlement blocked.
- Summary/forecast exclude non-recoverable AR and use exchange rates.
- Send invoice stamps state and records recipient best-effort.
- Tracking pixel stores only token hash, records first open only, and returns GIF
  on failure.

Definition of done:

- Dashboard/list/detail/create/edit/send/tracking parity is proven by unit and browser scenarios.

## M7 CAP-005 Payment Confirmations

Dependencies:

- CAP-001 invoice settlement/installment helpers.
- CAP-006 company email memory.
- Mail abstraction.

Target files:

- `services/payment-confirmations-service.ts`
- `commands/payment-confirmations.ts`
- `api/payment-confirmations/route.ts`
- `api/payment-confirmations/public/[token]/route.ts`
- confirmation UI components

Data read/write:

- Reads/writes `invoice_payment_confirmations`.
- Mutates invoice rollups only through invoice service/commands.
- Stores token hash only.

Implementation type:

- Preserve business behavior.
- Rewrite routing, token hashing, transactions, mail integration.

Expected tests:

- Request is AP only and unsettled only.
- Installment request validates target and unpaid status.
- Mail failure rolls back confirmation.
- New request supersedes older pending request.
- Public preview is safe and unauthenticated.
- Confirm is idempotent after confirmed.
- Rejected/expired token cannot confirm.
- Incoming AR accept settles both sides in one transaction.

Definition of done:

- Email link flow and incoming confirmation flow work end to end.

## M8 CAP-002 Tax Portal Sync

Dependencies:

- M0 schema.
- CAP-003 due terms.
- CAP-004 auto-paid.
- CAP-001 invoice persistence helpers.
- Queue and progress modules.
- GDT provider configuration.

Target files:

- `services/sync-service.ts`
- `services/sync-persistence-service.ts`
- `services/gdt/*`
- `workers/invoice-sync.ts`
- `api/sync/route.ts`
- `api/sync/authenticate/route.ts`
- `api/sync/[jobId]/route.ts`
- sync dialog UI

Data read/write:

- Reads/writes `invoice_sync_jobs`.
- Upserts `invoice_companies`, `invoice_invoices`, and line items.
- Preserves tenant-owned payment metadata on re-sync.
- Uses cache/Redis for captcha/token only.

Implementation type:

- Preserve business rules and idempotency.
- Rewrite queue from BullMQ direct usage to Operis `@open-mercato/queue`.
- Adapt progress to `ProgressJob`.

Expected tests:

- Availability requires Vietnamese MST and configured GDT endpoint.
- Start requires acknowledgements.
- Invalid/future/too-large windows reject; max fallback window is 1825 days.
- Scope tax codes normalize/dedupe/validate.
- Password is scrubbed and not persisted.
- Token/captcha are TTL cache only: captcha 180 seconds and GDT token cap 82800
  seconds by default.
- One active sync per tenant/org.
- Normal cooldown defaults to 300 seconds; failed-auth backoff defaults to 900
  seconds; active lock TTL defaults to 1800 seconds.
- Idempotency key returns existing job.
- Worker imports sold as AR and purchased as AP.
- Re-sync updates source fields but preserves payment metadata.
- Auto-paid apply runs after sync and failure is best-effort.
- Progress reaches terminal completed or failed.

Definition of done:

- Start/auth/enqueue/worker/status lifecycle works with local queue and async queue strategy.

## M9 UI Parity

Dependencies:

- API contracts for each page action.

Target files:

- `backend/invoice/**`
- `components/**`
- `i18n/**`

Implementation type:

- Rewrite old frontend into Operis backend UI.
- Use `DataTable`, `CrudForm`, guarded mutations, i18n, and DS tokens.

Expected tests:

- Dashboard/list/detail/form/send browser flow.
- Settings edit/save/search.
- Sync dialog lifecycle.
- Payment confirmation public link flow.
- Company lookup autofill.

Definition of done:

- Cross-capability scenarios in `PARITY-MATRIX.md` pass.

## M10 AI Helper

Dependencies:

- Stable read APIs.
- Optional mutation APIs if enabled later.

Target files:

- `ai-agents.ts`
- `ai-tools.ts`
- optional injection widget for list/detail surfaces

Implementation type:

- New Operis feature.
- Read-only default.
- Mutation tools only through approval.
- Uses reserved ACL feature `invoice.ai.view`, which has no active M0 runtime
  surface.

Expected tests:

- Tool required features are enforced.
- Read-only agent cannot mutate.
- Mutation tool uses pending approval if added.

Definition of done:

- Assistant can explain invoice status, overdue AP/AR, and sync state without bypassing RBAC.

## Validation Gate

Run the smallest relevant set per milestone:

```bash
yarn generate
yarn db:generate
yarn build:packages
yarn typecheck
yarn lint
yarn test
```

For UI milestones add browser/integration scenarios. For queue milestones test
local and async queue strategies.
