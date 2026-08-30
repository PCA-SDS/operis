# Invoice Migration Dependency Map

This Phase 1 document describes dependency order between Invoice capabilities.
For Phase 2implementation details, use:

- `docs/invoice/TARGET-INVOICE-ARCHITECTURE.md`
- `docs/invoice/OLD-TO-NEW-DATA-MAPPING.md`
- `docs/invoice/CAPABILITY-MIGRATION-PLAN.md`
- `docs/invoice/MIGRATION-DECISIONS.md`
- `.ai/specs/2026-08-25-invoice-module-migration.md`

## Operis Target Notes

- Target module: `packages/core/src/modules/invoice`.
- Target schema: MikroORM entities and module migrations, not Prisma.
- Target contracts: Zod validators and route `openApi`, not old shared-types as runtime source.
- Target sync infra: `@open-mercato/queue` worker plus `ProgressJob`.
- Existing `sales` invoice flow stays separate.
- No production data migration is included in this plan.
- Every persisted table is scoped by `tenant_id` and `organization_id`.

## Safe Migration Order

1. **Module foundation**: module shell, ACL, setup, DI, events, entities, validators, OpenAPI helper.
2. **Foundation services**: partner terms, company emails, exchange rates, company lookup.
3. **Auto-paid**: rule table and scoped AP bulk-settlement behavior.
4. **Invoices core**: list, detail, create, update, delete, summary, forecast, send, settlement, installments, tracking.
5. **Payment confirmations**: request, public preview/confirm/reject, incoming AR accept/reject.
6. **Tax portal sync**: GDT auth/start/status, queue worker, progress job, persistence, auto-paid apply.
7. **Backend UI**: dashboard, list, detail, form, settings, sync dialog, confirmation flows.
8. **Optional AI helper**: read-only assistant first; mutations only through approval.

Do not migrate UI first. The UI depends on shared API contracts, invalidation
rules, and multiple cross-capability mutations.

## CAP-001 Invoice Management

Dependency graph:

```text
Backend invoice pages
  -> invoice API routes
  -> invoiceService and invoice commands
  -> invoice_companies, invoice_invoices, invoice_invoice_line_items,
     invoice_installments, invoice_payment_confirmations
```

Cross calls:

```text
invoiceService.create
  -> invoiceAutoPaidService.isAutoPaid
  -> invoicePartnerTermsService.resolveDefaultDueDate
  -> create invoice + line items
```

```text
invoiceService.getSummary / getForecast
  -> aggregate scoped invoice rows
  -> invoiceExchangeRatesService.getRates when foreign currency exists
  -> return VND-normalized summary/forecast
```

```text
invoiceService.sendInvoice
  -> invoice email builders
  -> mail provider through DI
  -> stamp lastSentAt/tracking token
  -> invoiceCompanyEmailsService.record best-effort
```

```text
tracking public route
  -> email tracking handler
  -> update openedAt first time only
  -> return transparent GIF even on failure
```

Must migrate before:

- CAP-005 payment confirmations.
- CAP-002 final sync persistence parity checks.
- Most backend invoice UI.

Needs before full parity:

- CAP-003 partner terms.
- CAP-004 auto-paid.
- CAP-006 company emails.
- CAP-007 exchange rates.

## CAP-002 Tax Portal Sync

Dependency graph:

```text
Sync dialog
  -> /api/invoice/sync routes
  -> invoiceSyncService
  -> captcha/token cache services
  -> @open-mercato/queue + ProgressJob
  -> workers/invoice-sync.ts
  -> GDT fetcher/client
  -> invoiceSyncPersistenceService
  -> invoice_sync_jobs, invoice_companies, invoice_invoices, invoice_invoice_line_items
  -> invoiceAutoPaidService.applyAll best-effort
```

Must migrate after:

- Module foundation and invoice schema.
- CAP-001 core invoice persistence helpers.
- CAP-003 due-date terms.
- CAP-004 auto-paid, if imported AP invoices must auto-settle.
- Operis queue/progress infrastructure.
- GDT HTTP client/token/captcha storage equivalent.

Can migrate before:

- CAP-005 payment confirmations.
- Most settings UI.

Security boundary:

- GDT password, captcha solution, and raw GDT token are not database-owned.
- They live only in the configured cache layer with TTL.
- Password is scrubbed after the auth attempt.

## CAP-003 Partner Payment Terms

Dependency graph:

```text
Payment terms settings page
  -> /api/invoice/partners
  -> invoicePartnerTermsService
  -> invoice_companies.default_due_days
```

Consumers:

```text
invoiceService.create/update due date resolution
invoiceSyncPersistenceService initial imported due date
```

Must migrate before:

- CAP-001 manual create/update parity.
- CAP-002 sync due-date parity.

Independent from:

- Payment confirmations.
- Company lookup.
- Exchange-rate fetch.

## CAP-004 Auto-Paid

Dependency graph:

```text
Auto-paid settings page
  -> /api/invoice/auto-paid
  -> invoiceAutoPaidService.add/remove/list
  -> invoice_auto_paid_tax_codes
  -> scoped bulk update of invoice_invoices
```

Consumers:

```text
invoiceService.create
  -> invoiceAutoPaidService.isAutoPaid
```

```text
invoice-sync worker
  -> invoiceSyncPersistenceService.persist
  -> invoiceAutoPaidService.applyAll
```

```text
invoiceService.reverseAutoPaid
  -> mark AP invoice unpaid and auto_pay_excluded = true
```

Must migrate before:

- CAP-001 manual AP create if auto-settlement parity is required.
- CAP-002 sync completion if imported AP invoices must auto-settle.

Data caution:

- Add/remove/applyAll are set-based domain behavior.
- Every update must be scoped by tenant and organization.

## CAP-005 Payment Confirmations

Dependency graph:

```text
Payment confirmation UI
  -> /api/invoice/payment-confirmations
  -> invoicePaymentConfirmationsService.request
  -> invoiceService settlement rules
  -> invoiceCompanyEmailsService.record best-effort
  -> mail provider
  -> invoice_payment_confirmations
```

Public flow:

```text
Magic link
  -> /api/invoice/payment-confirmations/public/[token]
  -> invoicePaymentConfirmationsService
  -> invoiceService.settleConfirmed / applyInstallmentConfirmed
```

Incoming AR flow:

```text
Receiver invoice UI
  -> invoicePaymentConfirmationsService.acceptIncoming/rejectIncoming
  -> match pending AP confirmation by invoice identity
  -> transaction settles payer AP and receiver AR
```

Must migrate after:

- CAP-001 invoice settlement/installment helpers.
- CAP-006 company email memory.
- Mail provider integration.
- Public route/rate-limit strategy.

## CAP-006 Company Email Memory

Dependency graph:

```text
Recipient picker
  -> /api/invoice/company-emails
  -> invoiceCompanyEmailsService
  -> invoice_company_emails
```

Producers:

```text
invoiceService.sendInvoice -> invoiceCompanyEmailsService.record
invoicePaymentConfirmationsService.request -> invoiceCompanyEmailsService.record
```

Must migrate before:

- CAP-001 send-invoice parity.
- CAP-005 request-confirmation parity.

Can migrate early:

- It only needs `invoice_companies` and tenant/org scoping.

## CAP-007 Exchange Rates

Dependency graph:

```text
Invoice form/dashboard
  -> /api/invoice/exchange-rates
  -> invoiceExchangeRatesService
  -> external rate API
  -> process-local cache/stale fallback
```

Consumers:

```text
invoiceService.getSummary
invoiceService.getForecast
invoice form rate preview
```

Must migrate before:

- CAP-001 dashboard summary/forecast parity when foreign currency exists.
- Invoice form rate preview, if required.

Can migrate independently:

- No invoice table writes.

Infra caution:

- Old repo uses process-local cache. The target preserves that behavior first.
- Shared cache is a later design change, not part of this migration.

## CAP-008 Company Lookup

Dependency graph:

```text
Invoice create/edit form
  -> /api/invoice/company-lookup
  -> invoiceCompanyLookupService
  -> provider adapter/shared company lookup
  -> invoice_company_registry cache
```

Must migrate before:

- Form autofill parity.

Can migrate independently:

- It does not create or mutate invoice partner rows.

Infra caution:

- Provider throttle/cache behavior belongs to lookup infrastructure.
- Invoice owns the module-gated wrapper route and form behavior.

## Frontend Dependency Notes

Backend UI should be migrated after matching API contracts exist:

- Dashboard needs CAP-001 summary/forecast and CAP-007.
- List/detail/form needs CAP-001.
- Form lookup needs CAP-003, CAP-007, CAP-008.
- Send invoice needs CAP-001 and CAP-006.
- Payment confirmation UI needs CAP-005.
- Sync dialog needs CAP-002.
- Auto-paid settings needs CAP-004.
- Payment-terms settings needs CAP-003.

## Migration Order Detail

| Order | Item | Why first | Blocks |
| --- | --- | --- | --- |
| 1 | Module shell, ACL, setup, DI, events | Routes/services need module contracts | all capabilities |
| 2 | MikroORM invoice entities and migrations | All features share the schema | all persistence |
| 3 | Validators and OpenAPI helpers | API and UI compile against contracts | all routes |
| 4 | CAP-003 partners/payment terms | Due-date defaults depend on it | create/update, sync |
| 5 | CAP-006 company emails | Send and confirmations record recipients | send, confirmations |
| 6 | CAP-007 exchange rates | Summary/forecast/form rates | dashboard/form |
| 7 | CAP-008 company lookup | Form autofill | form UX |
| 8 | CAP-004 auto-paid | Manual create and sync both call it | create parity, sync finish |
| 9 | CAP-001 invoices core | Central domain and settlement engine | confirmations, most UI |
| 10 | CAP-005 payment confirmations | Needs settlement/installment functions | confirmation UI/public links |
| 11 | CAP-002 sync | Needs queue/progress plus persistence/auto-paid | sync UI |
| 12 | Backend UI | Depends on user-facing API contracts | user parity |

## Legacy Logic To Preserve

Do not remove or simplify these during migration:

- Invoice status values like replacement/adjustment unless product removes them.
- Portal-origin invoice update/delete guard.
- AP direct settlement block.
- `autoPayExcluded` replay guard after reverse auto-paid.
- `company_registry` as lookup cache, not partner master data.
- Tenant-owned due date, settlement, installments, and non-recoverable metadata.

## Legacy Evidence Pointers

- Old backend aggregate: `apps/backend/src/modules/invoice/invoice.module.ts`.
- Old backend feature modules under `apps/backend/src/modules/invoice/features/*`.
- Old frontend routes: `apps/frontend/src/modules/invoice/routes.tsx`.
- Old shared contracts: `packages/shared-types/src/invoice.ts`, `invoice-sync.ts`, `invoice-email.ts`.
- Old schema: `apps/backend/prisma/schema.prisma`, invoice models/enums.
