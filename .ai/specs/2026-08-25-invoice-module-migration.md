# Invoice Module Migration

## TLDR

Create a new core `invoice` module in `packages/core/src/modules/invoice` that
ports the old AP/AR Invoice behavior into Operis. The target is full parity for
CAP-001 through CAP-008, but there is no production data import in this plan.
The existing `sales` invoice flow stays separate.

Phase 2 implementation design lives in:

- `docs/invoice/TARGET-INVOICE-ARCHITECTURE.md`
- `docs/invoice/OLD-TO-NEW-DATA-MAPPING.md`
- `docs/invoice/CAPABILITY-MIGRATION-PLAN.md`
- `docs/invoice/MIGRATION-DECISIONS.md`

Phase 3 implementation can start from M0 in
`docs/invoice/CAPABILITY-MIGRATION-PLAN.md`. No Phase 2documentation blocker is
currently open.

Phase 1 source evidence lives in:

- `docs/invoice/FEAT-001-invoices.md`
- `docs/invoice/FEAT-002-sync.md`
- `docs/invoice/FEAT-003-partners-payment-terms.md`
- `docs/invoice/FEAT-004-auto-paid.md`
- `docs/invoice/FEAT-005-payment-confirmations.md`
- `docs/invoice/FEAT-006-company-emails.md`
- `docs/invoice/FEAT-007-exchange-rates.md`
- `docs/invoice/FEAT-008-company-lookup.md`
- `docs/invoice/DATA-OWNERSHIP-MAP.md`
- `docs/invoice/MIGRATION-DEPENDENCY-MAP.md`
- `docs/invoice/PARITY-MATRIX.md`

## Overview

The old Invoice module is an AP/AR accounting module from the tenant company
point of view. It includes manual AP invoices, AR settlement, installments,
non-recoverable AR, email sending and tracking, payment confirmations, partner
payment terms, auto-paid AP rules, exchange-rate summaries, company lookup, and
Vietnam GDT tax portal sync.

Operis already has `sales_invoices`, but those belong to the sales document
flow. This migration will not merge the two concepts. The new module will own
old Invoice behavior under the `invoice` module id.

## Problem Statement

The old repo docs describe business behavior and dependency order, but Day 3
implementation needs final decisions for:

- target module location and boundaries
- target tables and field ownership
- old-to-new data mapping
- capability implementation order
- queue/progress strategy for GDT sync
- API, ACL, tenant/org scope, and public token rules
- tests and parity criteria

Without these decisions, different coding agents could place features in
different modules or change source-owned/tenant-owned behavior during porting.

## Proposed Solution

Implement a new core module:

```text
packages/core/src/modules/invoice
```

Use the Phase 2docs as implementation blueprint:

- Architecture: `docs/invoice/TARGET-INVOICE-ARCHITECTURE.md`
- Data mapping: `docs/invoice/OLD-TO-NEW-DATA-MAPPING.md`
- Migration order: `docs/invoice/CAPABILITY-MIGRATION-PLAN.md`
- Final decisions: `docs/invoice/MIGRATION-DECISIONS.md`

The implementation will be phased:

1. Module foundation and schema.
2. Partner terms, company emails, exchange rates, company lookup.
3. Auto-paid.
4. Invoice core.
5. Payment confirmations.
6. GDT sync.
7. Backend UI parity.
8. Optional read-only AI helper.

## Phase 3 Readiness

This spec and the invoice docs answer the implementation questions as follows:

| Question | Answer |
| --- | --- |
| How will the same behavior exist inside the new ERP? | CAP-001 through CAP-008 move into a new core `invoice` module, with old AP/AR behavior preserved and `sales` left separate. |
| Target Architecture | `docs/invoice/TARGET-INVOICE-ARCHITECTURE.md` defines module boundary, folders, services, routes, workers, events, ACL, UI pages, logging, and token policy. |
| Data Mapping | `docs/invoice/OLD-TO-NEW-DATA-MAPPING.md` maps old fields, enums, limits, ownership classes, overwrite rules, tokens, and defaults to target tables. |
| Migration Plan | `docs/invoice/CAPABILITY-MIGRATION-PLAN.md` defines milestones M0 through M10, dependencies, files, tests, and done criteria. |
| Architecture Decisions | `docs/invoice/MIGRATION-DECISIONS.md` records final decisions DEC-001 through DEC-028. |
| Migration Spec | This file is the official pre-implementation spec and points to the design pack instead of duplicating every detail. |

Phase 3 starts with M0 only:

- build the module shell, ACL/setup, DI, entities, validators, OpenAPI helper,
  migrations, and smoke tests
- do not implement UI parity, GDT provider calls, or production import scripts
  in M0
- keep raw GDT secrets and raw public tokens out of DB and logs
- keep `sales` unchanged

Source questions resolved before Phase 3:

- Legacy enum values are locked in the data mapping doc.
- Email tracking uses target SHA-256 token hashes even though old code stored
  raw tracking tokens.
- Payment confirmation tokens are 64 hex chars and stored as SHA-256 hashes.
- Public token schemas are separated by branded types: raw public tokens are
  accepted only at public route boundaries, while DB lookup and persistence use
  token-hash types produced by the invoice token hashing helper.
- Sync defaults are locked: 1825-day max window, 300-second cooldown,
  900-second failed-auth backoff, 3 auth attempts, 1800-second active lock,
  180-second captcha TTL, and 82800-second GDT token TTL cap.
- Due-date fallback is locked: explicit due date, then partner default due
  days, then null.

## Architecture

The module follows Operis auto-discovery:

- `api/` for API routes.
- `backend/` for backend pages.
- `data/entities.ts` for MikroORM entities.
- `data/validators.ts` for Zod validators.
- `commands/` for domain writes.
- `services/` for domain services and provider adapters.
- `workers/` for queue workers.
- `acl.ts`, `setup.ts`, `di.ts`, `events.ts`, `search.ts` for module contracts.

GDT sync must use:

- `@open-mercato/queue`
- `ProgressJob`
- idempotent worker payloads scoped by tenant and organization

AI helper, if implemented, is read-only by default. Mutation tools must use
pending approval through `prepareMutation(...)`.
The `invoice.ai.view` ACL feature is reserved for M10 and is inert in M0 because
no invoice AI agents or AI tools are active.

Invoice search is part of the M0 module contract. Search configuration must
declare `aclFeatures: ['invoice.view']`, use field allowlists, keep tax-code
fields hash-only, and exclude token/hash fields from index text.

The DS governance globs for future invoice backend and component paths are
pre-registered in M0. They are intentional even before backend UI files exist.

Full architecture detail is in
`docs/invoice/TARGET-INVOICE-ARCHITECTURE.md`.

## Data Models

Target tables:

- `invoice_companies`
- `invoice_company_emails`
- `invoice_auto_paid_tax_codes`
- `invoice_invoices`
- `invoice_invoice_line_items`
- `invoice_installments`
- `invoice_payment_confirmations`
- `invoice_sync_jobs`
- `invoice_company_registry`

All persisted records are tenant and organization scoped. User-editable records
include `updated_at` for optimistic locking.

Invoice scope is intentionally stricter than the shared scoped payload helper.
Private Invoice handlers must derive `InvoiceScope` from trusted runtime/auth
context with `requireInvoiceScope(...)`, then pass reads and writes through the
scoped persistence boundary. Do not replace this with `withScopedPayload`
without first changing the shared helper's ownership semantics: the shared
helper accepts payload-supplied `tenantId` / `organizationId` before falling
back to runtime context, while Invoice ownership must be payload-blind.

The Invoice module treats `selectedOrganizationId` as trusted platform context.
It assumes the platform request scope resolver has already validated the
selected organization against the caller's accessible organizations before an
Invoice handler receives it. If that contract is wrong, track and fix it at the
platform scope resolver boundary rather than hiding the authorization gap inside
Invoice.

Invoice scoped persistence hides soft-deleted `Invoice` and `InvoiceCompany`
rows by default across `findById`, `findOne`, and `findMany`. Deleted-row reads
must opt in with `includeDeleted: true`; this is reserved for explicit
admin-restore screens and audit/reconciliation jobs that need historical rows.
Normal UI, API, import, and command flows should not pass `includeDeleted`.
Invoices may still reference soft-deleted `InvoiceCompany` rows for accounting
history. The `restrict` FK protects hard delete only; UI and API surfaces must
handle historical company references explicitly when they need to display them.

The soft-delete read boundary is registered by entity constructor, not runtime
class-name strings, so bundling/minification or class renames cannot silently
drop the `deletedAt: null` filter. New invoice entities with a `deletedAt`
column must be explicitly added to the scoped persistence soft-delete map unless
the module later adopts a shared MikroORM metadata-based helper.

The old-to-new field mapping and ownership rules are in
`docs/invoice/OLD-TO-NEW-DATA-MAPPING.md`.

Important invariants:

- GDT may update source-owned fields.
- GDT must preserve tenant-owned payment metadata.
- Manual invoice totals are server-computed.
- Generic invoice update cannot write derived settlement rollups.
- Raw GDT secrets and raw payment-confirmation tokens are not stored.
- `invoice_company_registry.payload` is created in M0 but provider payload use
  is deferred to M4. Payload encryption must be decided and implemented before
  M4 writes raw provider responses.

## API Contracts

Private route groups:

- `/api/invoice/invoices`
- `/api/invoice/summary`
- `/api/invoice/forecast`
- `/api/invoice/partners`
- `/api/invoice/auto-paid`
- `/api/invoice/company-emails`
- `/api/invoice/exchange-rates`
- `/api/invoice/company-lookup`
- `/api/invoice/sync`
- `/api/invoice/sync/authenticate`
- `/api/invoice/sync/[jobId]`
- `/api/invoice/payment-confirmations`

Public route groups:

- `/api/invoice/payment-confirmations/public/[token]`
- `/api/invoice/track/[token]/pixel.gif`

Every API route must export `openApi`. Private writes must use commands or
mutation guards. Public token routes must return safe data and must not log raw
tokens.

Detailed route ownership is in
`docs/invoice/TARGET-INVOICE-ARCHITECTURE.md` and milestone order is in
`docs/invoice/CAPABILITY-MIGRATION-PLAN.md`.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
| --- | --- | --- | --- | --- |
| Mixing old Invoice with `sales_invoices` changes business semantics. | High | Data model, UI, payments | Keep separate `invoice` module and record DEC-002. | Later integration may still need explicit bridge design. |
| GDT re-sync overwrites tenant payment metadata. | High | Sync, settlement | Use ownership rules from data mapping and regression tests. | Requires careful persistence tests. |
| Public token leak through logs. | High | Payment confirmations, tracking | Store hashes, structured safe logs only. | Pixel token hashing needs source confirmation. |
| Company registry payload may contain PII once provider lookup is implemented. | High | Company lookup cache | M0 does not call providers; M4 must add encryption or record a stricter payload contract before writing provider responses. | Schema exists before encrypted writes are implemented. |
| Worker retry duplicates imported invoices. | High | Sync | Natural source key and idempotent worker. | Provider edge cases still need mock tests. |
| Exchange-rate cache semantics change in multi-replica deploy. | Medium | Summary, forecast | Preserve process-local cache first. | Different replicas can have different stale snapshots. |
| Feature parity missed in UI. | Medium | Backend pages | Use `PARITY-MATRIX.md` cross-capability scenarios. | Browser tests may need staged implementation. |
| ACL grants incomplete for existing tenants. | Medium | Access control | Add `setup.ts` grants and run role ACL sync during implementation. | Existing tenant rollout must be verified. |

## Test Plan

Per capability tests are defined in
`docs/invoice/CAPABILITY-MIGRATION-PLAN.md`.

Minimum parity scenarios:

1. Create manual AP invoice for foreign partner with default terms and auto-paid rule.
2. Import sold and purchased GDT invoices, re-run sync, and preserve tenant metadata.
3. Send AR invoice, open tracking pixel, and verify recipient memory.
4. Request AP payment confirmation, confirm public link, and settle AP invoice.
5. Accept incoming AR confirmation and settle both matching sides.
6. Create AR installment plan and confirm one installment.
7. Mark AR invoice non-recoverable and exclude it from summary/forecast.
8. View USD summary/forecast with rate provider unavailable with and without cache.
9. Lookup company identifier in invoice form without creating partner row before save.

Validation commands by implementation phase:

```bash
yarn generate
yarn db:generate
yarn build:packages
yarn typecheck
yarn lint
yarn test
```

For queue work, test local and async queue strategies. For UI work, add browser
or integration coverage for key flows.

## Final Compliance Report

This is a pre-implementation spec. Compliance requirements for implementation:

- No direct ORM relationships across modules.
- No changes to existing `sales` invoice behavior.
- No production data import scripts.
- No raw GDT credentials, captcha, raw GDT token, or raw payment-confirmation
  token in DB or logs.
- All API routes export `openApi`.
- All private data access is tenant and organization scoped.
- All writes use commands or mutation guards.
- GDT sync uses `@open-mercato/queue` and `ProgressJob`.
- User-facing strings use i18n.
- New backend pages use Operis UI primitives and guarded mutations.

## Changelog

- 2026-08-25: Created migration spec and Phase 2implementation-ready design pack references.
- 2026-08-25: Added Phase 3 readiness summary and resolved source-code
  confirmation points.
- 2026-08-26: Added the Invoice data safety foundation. Future private Invoice
  reads and writes must derive tenant and organization ownership through
  `requireInvoiceScope(...)` and pass persistence through the scoped helper
  boundary instead of trusting request payload ownership fields.
- 2026-08-27: Clarified the Invoice scoped persistence read boundary:
  soft-deleted `Invoice` and `InvoiceCompany` rows are hidden by default, and
  deleted-row reads must opt in with `includeDeleted: true`. The boundary uses
  constructor-based soft-delete registration instead of runtime class-name
  strings.
- 2026-08-27: Documented the payload-blind Invoice scope boundary and the
  upstream-validation assumption for `selectedOrganizationId`.
- 2026-08-28: Added M0 review clarifications for branded public-token/hash
  boundaries, invoice search configuration, deferred company-registry payload
  encryption, reserved AI ACL behavior, soft-deleted company history, and DS
  governance pre-registration.
- 2026-09-05: Implemented Task 4.1 CAP-003 partner payment terms service,
  partner-term validators, DI registration, and focused service coverage.
- 2026-09-05: Exposed CAP-003 partner list, partner match, and partner payment
  terms update API routes with OpenAPI metadata, scope handling, optimistic
  locking, and mutation guards.
