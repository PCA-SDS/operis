# Target Invoice Architecture

This is the Phase 2target design for moving the old Invoice module into Operis.
Phase 1 explains what the old system does. This file explains where the same
behavior will live in the new repo.

Source evidence:

- `docs/invoice/FEAT-001-invoices.md`
- `docs/invoice/FEAT-002-sync.md`
- `docs/invoice/FEAT-003-partners-payment-terms.md`
- `docs/invoice/FEAT-004-auto-paid.md`
- `docs/invoice/FEAT-005-payment-confirmations.md`
- `docs/invoice/FEAT-006-company-emails.md`
- `docs/invoice/FEAT-007-exchange-rates.md`
- `docs/invoice/FEAT-008-company-lookup.md`
- `docs/invoice/DATA-OWNERSHIP-MAP.md`
- `docs/invoice/PARITY-MATRIX.md`

Old code evidence checked for Phase 3:

- `pca_erp/packages/shared-types/src/invoice.ts`
- `pca_erp/packages/shared-types/src/invoice-sync.ts`
- `pca_erp/apps/backend/prisma/schema.prisma`
- `pca_erp/apps/backend/src/modules/invoice/features/**`

## Locked Architecture

Invoice becomes a new core module:

```text
packages/core/src/modules/invoice/
```

It is not an app-local module and it is not part of the existing `sales` module.
The existing `sales` invoice flow stays separate because it is tied to
Quote -> Order -> Invoice, channels, sales document numbers, and sales payments.
The migrated Invoice module is an AP/AR accounting and tax portal module from
the tenant company point of view.

## Module Boundary

The new `invoice` module owns:

- AP and AR invoice records for the tenant company.
- Partner payment terms used by invoice due dates.
- Manual AP invoice entry for non-Vietnam partners.
- GDT tax portal import and sync job state.
- Auto-paid AP tax-code rules.
- Company email memory for invoice recipients.
- Payment confirmation request and public confirmation workflow.
- Invoice email send state and open tracking.
- Exchange-rate lookup behavior used by invoice summary and forecast.
- Company lookup cache used by invoice forms.

The module does not own:

- Existing `sales_invoices`, sales order conversion, sales channels, or sales
  payment allocations.
- Customer/company master data in the `customers` module.
- Production import from the old repo database.
- Raw GDT credentials, raw captcha solution, or raw payment-confirmation token.

## Folder Structure

```text
packages/core/src/modules/invoice/
  index.ts
  acl.ts
  setup.ts
  di.ts
  events.ts
  search.ts
  encryption.ts
  ai-agents.ts
  ai-tools.ts
  api/
    openapi.ts
    invoices/route.ts
    summary/route.ts
    forecast/route.ts
    partners/route.ts
    auto-paid/route.ts
    company-emails/route.ts
    exchange-rates/route.ts
    company-lookup/route.ts
    sync/route.ts
    sync/authenticate/route.ts
    sync/[jobId]/route.ts
    payment-confirmations/route.ts
    payment-confirmations/public/[token]/route.ts
    track/[token]/pixel.gif/route.ts
  backend/
    invoice/page.tsx
    invoice/all/page.tsx
    invoice/all/create/page.tsx
    invoice/all/[id]/page.tsx
    invoice/all/[id]/edit/page.tsx
    invoice/payables/page.tsx
    invoice/receivables/page.tsx
    invoice/settings/page.tsx
  commands/
    invoices.ts
    payment-confirmations.ts
    auto-paid.ts
  data/
    entities.ts
    validators.ts
    mappers.ts
    queries.ts
  services/
    invoice-service.ts
    partner-terms-service.ts
    company-emails-service.ts
    auto-paid-service.ts
    exchange-rates-service.ts
    company-lookup-service.ts
    payment-confirmations-service.ts
    sync-service.ts
    sync-persistence-service.ts
    gdt/
  workers/
    invoice-sync.ts
  components/
  i18n/
  __tests__/
  __integration__/
```

Exact filenames can be split during implementation when a file becomes too
large, but ownership must stay inside these areas.

## DI And Services

Register services in `di.ts` with stable names:

| Service | Purpose |
| --- | --- |
| `invoiceService` | Invoice create/update/read/payment rollups/send logic. |
| `invoicePartnerTermsService` | Partner search and `defaultDueDays` updates. |
| `invoiceCompanyEmailsService` | Recipient memory list/upsert/remove. |
| `invoiceAutoPaidService` | Tax-code rules, apply, revert, reverse exclusion. |
| `invoiceExchangeRatesService` | VND rate lookup with stale fallback. |
| `invoiceCompanyLookupService` | Invoice wrapper over shared registry lookup. |
| `invoicePaymentConfirmationsService` | Request, public confirm/reject, incoming match. |
| `invoiceSyncService` | Availability, start, authenticate, status. |
| `invoiceSyncPersistenceService` | GDT invoice upsert and metadata preservation. |

All services must receive tenant and organization scope from request or worker
context. Do not accept trusted scope from client body.

## API Boundary

New routes use Operis API discovery:

- Routes live under `packages/core/src/modules/invoice/api`.
- Each route exports `openApi`.
- CRUD-like routes use `makeCrudRoute` where it fits.
- Custom write routes must run mutation guards.
- All private routes require auth and feature checks.

Target private API routes:

| Capability | Route group | Feature |
| --- | --- | --- |
| CAP-001 | `/api/invoice/invoices`, `/api/invoice/summary`, `/api/invoice/forecast` | `invoice.view`, `invoice.manage` |
| CAP-002 | `/api/invoice/sync` | `invoice.sync` |
| CAP-003 | `/api/invoice/partners` | `invoice.settings.manage` |
| CAP-004 | `/api/invoice/auto-paid` | `invoice.settings.manage` |
| CAP-005 | `/api/invoice/payment-confirmations` | `invoice.payment_confirmations.manage` |
| CAP-006 | `/api/invoice/company-emails` | `invoice.manage` |
| CAP-007 | `/api/invoice/exchange-rates` | `invoice.view` |
| CAP-008 | `/api/invoice/company-lookup` | `invoice.view` |

Target public API routes:

- `/api/invoice/payment-confirmations/public/[token]`
- `/api/invoice/track/[token]/pixel.gif`

Public routes must never log raw token values.

Target route method matrix:

| Method | Target route | Old route | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/invoice/summary` | `GET /invoice/summary` | Dashboard AP/AR/net summary. |
| `GET` | `/api/invoice/forecast` | `GET /invoice/forecast` | Cash-flow forecast. |
| `GET` | `/api/invoice/invoices` | `GET /invoice/invoices` | Paginated list with filters. |
| `POST` | `/api/invoice/invoices` | `POST /invoice/invoices` | Manual AP invoice create. |
| `GET` | `/api/invoice/invoices/[id]` | `GET /invoice/invoices/:id` | Invoice detail. |
| `PUT` | `/api/invoice/invoices/[id]` | `PUT /invoice/invoices/:id` | Manual invoice full replace. |
| `DELETE` | `/api/invoice/invoices/[id]` | `DELETE /invoice/invoices/:id` | Delete manual invoice. |
| `POST` | `/api/invoice/invoices/[id]/send` | `POST /invoice/invoices/:id/send` | Send AR invoice email. |
| `PATCH` | `/api/invoice/invoices/[id]/due-date` | `PATCH /invoice/invoices/:id/due-date` | Tenant-owned due-date update. |
| `PATCH` | `/api/invoice/invoices/[id]/settlement` | `PATCH /invoice/invoices/:id/settlement` | AR settlement toggle. |
| `PATCH` | `/api/invoice/invoices/[id]/reverse-auto-paid` | `PATCH /invoice/invoices/:id/reverse-auto-paid` | Reverse AP auto-paid settlement. |
| `PATCH` | `/api/invoice/invoices/[id]/non-recoverable` | `PATCH /invoice/invoices/:id/non-recoverable` | AR write-off toggle. |
| `PUT` | `/api/invoice/invoices/[id]/installments` | `PUT /invoice/invoices/:id/installments` | Replace AR installment plan. |
| `DELETE` | `/api/invoice/invoices/[id]/installments` | `DELETE /invoice/invoices/:id/installments` | Delete AR installment plan. |
| `PATCH` | `/api/invoice/invoices/[id]/installments/[installmentId]` | `PATCH /invoice/invoices/:id/installments/:installmentId` | Mark one installment paid/unpaid. |
| `GET` | `/api/invoice/partners` | `GET /invoice/partners` | Partner payment-terms list. |
| `GET` | `/api/invoice/partners/match` | `GET /invoice/partners/match` | Match typed partner identity. |
| `PATCH` | `/api/invoice/partners/[id]` | `PATCH /invoice/partners/:id` | Set or clear default due days. |
| `GET` | `/api/invoice/auto-paid` | `GET /invoice/auto-paid` | List auto-paid tax codes. |
| `POST` | `/api/invoice/auto-paid` | `POST /invoice/auto-paid` | Add auto-paid tax code. |
| `DELETE` | `/api/invoice/auto-paid/[id]` | `DELETE /invoice/auto-paid/:id` | Remove auto-paid tax code. |
| `GET` | `/api/invoice/auto-paid/candidates` | `GET /invoice/auto-paid/candidates` | AP partner candidates. |
| `GET` | `/api/invoice/company-emails` | `GET /invoice/companies/:companyId/emails` | Saved recipient emails. |
| `POST` | `/api/invoice/company-emails` | old service method | Upsert saved recipient email. |
| `DELETE` | `/api/invoice/company-emails/[id]` | old service method | Remove saved recipient email. |
| `GET` | `/api/invoice/exchange-rates` | `GET /invoice/exchange-rates` | VND conversion hints. |
| `GET` | `/api/invoice/company-lookup/[identifier]` | `GET /invoice/company-lookup/:taxCode` | Country-aware company lookup. |
| `GET` | `/api/invoice/sync/latest` | `GET /invoice/sync/latest` | Sync availability and latest job. |
| `POST` | `/api/invoice/sync` | `POST /invoice/sync` | Start sync or ask for captcha auth. |
| `POST` | `/api/invoice/sync/authenticate` | `POST /invoice/sync/authenticate` | Submit password and captcha. |
| `GET` | `/api/invoice/sync/[jobId]` | `GET /invoice/sync/:jobId` | Poll sync job status. |
| `POST` | `/api/invoice/payment-confirmations` | `POST /invoice/invoices/:id/request-payment-confirmation` | Request AP confirmation email. |
| `GET` | `/api/invoice/payment-confirmations/public/[token]` | `GET /public/invoice/payment-confirmations/:token` | Public preview. |
| `POST` | `/api/invoice/payment-confirmations/public/[token]/confirm` | `POST /public/invoice/payment-confirmations/:token/confirm` | Public confirm. |
| `POST` | `/api/invoice/payment-confirmations/public/[token]/reject` | `POST /public/invoice/payment-confirmations/:token/reject` | Public reject. |
| `GET` | `/api/invoice/track/[token]/pixel.gif` | `GET /public/invoice/track/:token/pixel.gif` | Email open tracking pixel. |

If implementation groups sub-actions under one route file, it must still expose
the same actions and OpenAPI operation ids.

## Workers And Jobs

CAP-002 Tax Portal Sync must use:

- `@open-mercato/queue` worker: `workers/invoice-sync.ts`
- queue name: `invoice-sync`
- worker id: `invoice:sync`
- `ProgressJob` job type: `invoice.sync`

The sync start route creates an `invoice_sync_jobs` row, creates a `ProgressJob`,
and enqueues a worker payload containing:

- `syncJobId`
- `progressJobId`
- `tenantId`
- `organizationId`
- `userId`
- trusted date window and scope tax codes

The worker must be idempotent. Queue retries or duplicate delivery must not
duplicate invoices or corrupt settlement data.

Source-compatible sync defaults:

| Setting | Default | Notes |
| --- | --- | --- |
| max sync window | 1825 days | Inclusive `fromDate` to `toDate`. |
| normal cooldown | 300 seconds | Applies after a successful sync. |
| failed-auth backoff | 900 seconds | Applies after too many auth failures or account lock. |
| max auth attempts | 3 | Per tenant plus transaction attempts. |
| active lock TTL | 1800 seconds | Stale active jobs can be failed and retried manually. |
| captcha TTL | 180 seconds | Captcha transaction lives only in cache. |
| GDT token TTL cap | 82800 seconds | Also capped by provider expiry. |
| old BullMQ attempts | 1 | Operis worker may retry, but persistence must be idempotent. |

These are defaults, not hard product policy. If config overrides exist, keep the
same fallback values.

## Events

Declare events in `events.ts` with `createModuleEvents`:

| Event id | When emitted |
| --- | --- |
| `invoice.invoice.created` | Manual or sync-created invoice. |
| `invoice.invoice.updated` | Invoice source or tenant metadata changed. |
| `invoice.invoice.deleted` | Manual invoice deleted. |
| `invoice.invoice.sent` | AR invoice email sent. |
| `invoice.invoice.opened` | Tracking pixel records first open. |
| `invoice.invoice.settled` | AR/AP settlement rollup changes. |
| `invoice.payment_confirmation.requested` | Confirmation email requested. |
| `invoice.payment_confirmation.confirmed` | Public token confirms payment. |
| `invoice.payment_confirmation.rejected` | Public token or incoming flow rejects. |
| `invoice.sync.started` | Sync job queued. |
| `invoice.sync.completed` | Sync reaches terminal success. |
| `invoice.sync.failed` | Sync reaches terminal failure. |

Event IDs are persisted contract values. Do not rename them after release
without migration and compatibility work.

## ACL

Declare features in `acl.ts`:

```text
invoice.view
invoice.manage
invoice.delete
invoice.sync
invoice.settings.manage
invoice.payment_confirmations.manage
invoice.ai.view
```

`setup.ts` grants:

- `admin`: `invoice.*`
- `employee`: `invoice.view`, `invoice.manage`,
  `invoice.payment_confirmations.manage`
- sync access can be admin-only at first unless product chooses otherwise.

Use wildcard-aware feature checks. Do not use role-name checks for pages or
routes.

## Tenant And Organization Scoping

Every table stores:

- `tenant_id`
- `organization_id`
- standard timestamps
- `deleted_at` where records are user-editable or soft-deletable
- `updated_at` for user-editable records

All queries must filter by both `tenant_id` and `organization_id`.

Public token routes do not trust tenant in URL or body. They resolve the token
hash to a scoped record and only return safe public preview data.

Worker payloads include scope from the authenticated start request. The worker
must re-load `invoice_sync_jobs` by id plus scope before mutating records.

Token storage:

- Payment confirmation tokens are 32 random bytes, hex encoded to 64 chars.
- Store SHA-256 hex hashes only.
- Email tracking tokens should also be 64 hex chars and stored as SHA-256 hex
  hashes in `email_tracking_token_hash`.
- Pixel lookup hashes the raw path token, updates `opened_at` only when it is
  null, and always returns the transparent GIF.

## Cross-Module Dependencies

Use scalar IDs and snapshots. Do not create direct MikroORM relations across
modules.

| Dependency | Usage | Rule |
| --- | --- | --- |
| `customers` | Optional link to company/person later. | Store scalar id only if added. No ORM relation. |
| `auth` | User id for audit and sync start. | Use request context. |
| `queue` | Durable sync worker. | Use worker contract. |
| `progress` | User-visible sync progress. | Use `ProgressJob`. |
| `events` | Broadcast and workflow triggers. | Emit after successful writes. |
| `ai_assistant` | Optional read-only assistant. | Mutation tools need approval. |
| mail provider | Send invoice and confirmations. | Use existing mail abstraction through DI. |

## Frontend Pages

Backend pages live in:

```text
packages/core/src/modules/invoice/backend/invoice/
```

Target pages:

| Page | Purpose |
| --- | --- |
| `/backend/invoice` | Dashboard summary and forecast. |
| `/backend/invoice/all` | All invoices list. |
| `/backend/invoice/all/create` | Manual AP invoice form. |
| `/backend/invoice/all/[id]` | Invoice detail. |
| `/backend/invoice/all/[id]/edit` | Manual invoice edit. |
| `/backend/invoice/payables` | AP filtered list. |
| `/backend/invoice/receivables` | AR filtered list. |
| `/backend/invoice/settings` | Payment terms, auto-paid, email memory, sync settings. |

Use `DataTable` for lists and `CrudForm` where possible. Custom write actions
must use guarded mutations.

## AI Agent Role

AI is not required for parity. If added, it must be a helper, not a hidden write
path.

Target:

- `ai-agents.ts`: `invoice.accounting_assistant`
- `ai-tools.ts`: read tools first, mutation tools only after APIs are stable
- default policy: read-only
- required features: `invoice.ai.view`, plus read/write feature per tool

Mutation tools must use `prepareMutation(...)` and require user approval.

## CAP To Architecture Map

| CAP | Target areas |
| --- | --- |
| CAP-001 Invoice Management | `data/entities.ts`, `commands/invoices.ts`, `services/invoice-service.ts`, `api/invoices`, `api/summary`, `api/forecast`, backend invoice pages. |
| CAP-002 Tax Portal Sync | `services/sync-service.ts`, `services/sync-persistence-service.ts`, `services/gdt/*`, `workers/invoice-sync.ts`, `api/sync/*`. |
| CAP-003 Partner Payment Terms | `invoice_companies.default_due_days`, `services/partner-terms-service.ts`, `api/partners`, settings UI. |
| CAP-004 Auto Paid | `invoice_auto_paid_tax_codes`, `commands/auto-paid.ts`, `services/auto-paid-service.ts`, `api/auto-paid`, settings UI. |
| CAP-005 Payment Confirmations | `invoice_payment_confirmations`, `commands/payment-confirmations.ts`, `services/payment-confirmations-service.ts`, private and public confirmation APIs. |
| CAP-006 Company Emails | `invoice_company_emails`, `services/company-emails-service.ts`, `api/company-emails`, recipient picker UI. |
| CAP-007 Exchange Rates | `services/exchange-rates-service.ts`, `api/exchange-rates`, dashboard/form consumers. |
| CAP-008 Company Lookup | `invoice_company_registry`, `services/company-lookup-service.ts`, `api/company-lookup`, form autofill UI. |

## Logging And Monitoring

Use structured logging. Do not use raw `console`.

Required log areas:

- sync job lifecycle: tenant, organization, sync job id, progress job id, phase,
  counts, terminal error code
- GDT auth and provider failures, without password/captcha/token
- mail send failures and non-blocking recipient memory failures
- exchange-rate provider outage and stale-cache usage
- company lookup provider outage and stale-cache usage
- public confirmation and tracking outcomes, without raw token

Sync progress must be visible through `ProgressJob` status and counts.
