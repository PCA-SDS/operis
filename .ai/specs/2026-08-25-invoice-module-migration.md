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

The old-to-new field mapping and ownership rules are in
`docs/invoice/OLD-TO-NEW-DATA-MAPPING.md`.

Important invariants:

- GDT may update source-owned fields.
- GDT must preserve tenant-owned payment metadata.
- Manual invoice totals are server-computed.
- Generic invoice update cannot write derived settlement rollups.
- Raw GDT secrets and raw payment-confirmation tokens are not stored.

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
