# Invoice Migration Decisions

This file records final Phase 2decisions for implementation. Keep entries short.
If a decision changes, update this file and the official spec together.

## DEC-001 Module Location

Decision:

Use `packages/core/src/modules/invoice`.

Reason:

Invoice is a reusable core business module, not an app-local customization.

## DEC-002 Separate From `sales`

Decision:

Keep the migrated Invoice module separate from the existing `sales` module.

Reason:

The `sales` invoice entity belongs to the Quote -> Order -> Invoice flow with
channels and sales document rules. The old Invoice module is AP/AR accounting
from the tenant company point of view and includes GDT sync, AP payment
confirmation, and tax portal behavior.

## DEC-003 Full Parity Target

Decision:

Plan for CAP-001 through CAP-008 parity.

Reason:

Partial migration would leave core invoice flows broken because payment terms,
auto-paid, company emails, exchange rates, payment confirmations, sync, and
lookup are connected.

## DEC-004 No Production Data Migration

Decision:

Do not include old DB production data import in this plan.

Reason:

The current request is code and design migration only. Schema mapping still
documents semantics, but no import script or old DB backfill is required.

## DEC-005 Tenant And Organization Scope

Decision:

Every persisted invoice module row stores `tenant_id` and `organization_id`.
Every private read/write filters by both values.

Reason:

Operis requires tenant and organization isolation. Old `tenantId` maps to
Operis scope and must not come from request body.

## DEC-006 No Cross-Module ORM Relations

Decision:

Use scalar ids and snapshots for any future link to `customers`, `sales`, or
other modules. Do not create direct MikroORM relations across modules.

Reason:

Repo architecture prohibits direct ORM relationships between modules.

## DEC-007 Module-Local Partner Master

Decision:

Keep `invoice_companies` as the invoice partner master.

Reason:

Old behavior needs invoice-specific payment terms, tax identity matching, and
GDT name freshness. This is not the same as the `customers` company entity.

## DEC-008 Source-Owned Vs Tenant-Owned Fields

Decision:

GDT may update source-owned invoice fields, but must preserve tenant-owned
payment metadata.

Reason:

Re-sync should refresh tax source data without erasing due dates, settlement,
installments, non-recoverable flags, or payment confirmations.

## DEC-009 Manual Invoice Rules

Decision:

Manual invoice create remains AP-only and non-Vietnam partner only.

Reason:

Vietnam invoices should come from tax portal sync. This preserves old business
behavior.

## DEC-010 AP Direct Settlement

Decision:

AP direct settlement remains blocked.

Reason:

Old behavior allows AP settlement through auto-paid or payment confirmation, not
through direct user marking.

## DEC-011 AR Payment Metadata

Decision:

AR settlement, installments, and non-recoverable state are tenant-owned actions
through dedicated endpoints.

Reason:

They are business payment decisions, not source tax data.

## DEC-012 Sync Uses Queue And Progress

Decision:

GDT sync must use `@open-mercato/queue` plus `ProgressJob`.

Reason:

Sync is long-running, external, retryable work. Operis requires durable workers
and shared progress for this class of work.

## DEC-013 Sync Retry Semantics

Decision:

Keep old single-run/manual retry behavior at business level, but make the
worker idempotent for Operis queue retries.

Reason:

Operis workers may be retried or delivered more than once. Duplicate execution
must be safe even if product still exposes manual retry.

## DEC-014 GDT Secrets

Decision:

Never persist GDT password, raw captcha solution, or raw GDT token.

Reason:

Old security boundary stored these only in Redis/cache with TTL. The new module
must preserve that boundary.

## DEC-015 Payment Confirmation Tokens

Decision:

Store only token hashes for payment confirmations. Raw public tokens and token
hashes use distinct branded schemas/types. Public routes accept raw token types;
DB lookup and persistence accept only token-hash types produced by the invoice
hashing helper.

Reason:

Public tokens are credentials. Raw token storage is not needed for business
logic and increases risk.

## DEC-016 Email Tracking Token

Decision:

Store only a SHA-256 hex hash for email tracking tokens.

Reason:

The old system stored a raw 64-character token and looked it up directly. In the
new module, the pixel route can hash the raw path token and query
`email_tracking_token_hash`, so raw token storage is not needed.

## DEC-017 Exchange-Rate Cache

Decision:

Use process-local cache first to preserve old behavior.

Reason:

Old repo used process-local cache. A shared cache can be added later only as an
explicit design change.

## DEC-018 Company Lookup Cache

Decision:

Keep `invoice_company_registry` separate from `invoice_companies`.
M0 creates the table but defers raw provider payload writes to M4. Before M4
writes provider responses, the implementation must add payload encryption or
document a stricter provider response shape that proves encryption is not
needed.

Reason:

Lookup cache is provider/reference data. It must not create business partner
records until the user saves/imports an invoice.

## DEC-019 API Shape

Decision:

Use new Operis routes under `/api/invoice/*` and backend pages under
`/backend/invoice/*`.

Reason:

Operis module routing uses `api/` and `backend/` auto-discovery. Old `/invoice/*`
frontend paths are not preserved unless requested later.

## DEC-020 OpenAPI

Decision:

Every API route must export `openApi`.

Reason:

Operis API docs and AI/code-mode discovery depend on route OpenAPI metadata.

## DEC-021 Commands And Mutation Guards

Decision:

Domain writes use commands. Custom write routes must run mutation guards.

Reason:

This preserves audit, undo, indexing, cache invalidation, and global mutation
extensions.

## DEC-022 AI Agent

Decision:

AI helper is optional and read-only by default. Mutation tools require
`prepareMutation(...)` and user approval.
The `invoice.ai.view` ACL feature is reserved for M10 and has no active M0
agent or tool surface.

Reason:

AI must not become a hidden write path around RBAC and mutation approval.

## DEC-023 Logging

Decision:

Use structured logging for sync, mail, exchange rates, company lookup, and
public token flows. Never log raw secrets or tokens.

Reason:

These flows touch credentials, public bearer tokens, and external providers.

## DEC-024 Spec Authority

Decision:

The official spec references Phase 2docs instead of duplicating every detail.
When docs conflict, update both before implementation continues.

Reason:

This keeps the spec concise while the implementation-ready design remains
complete.

## DEC-025 Enum Contracts

Decision:

Preserve the old enum values listed in
`docs/invoice/OLD-TO-NEW-DATA-MAPPING.md`.

Reason:

These values are persisted and drive API/UI state. Changing them during the port
would add migration risk without product value.

## DEC-026 Due-Date Defaults

Decision:

Use this fallback order for invoice due dates:

1. Explicit request `dueDate`.
2. Matched partner `default_due_days`.
3. `null`.

New invoice partner rows default `default_due_days` to 30 unless settings clear
it to `null`. The manual form may seed 45 days in the UI, but the server must
not invent 45 days when no explicit due date is sent.

Reason:

This matches old backend behavior while keeping the UI convenience separate
from persisted business policy.

## DEC-027 Sync Limits

Decision:

Keep source-compatible sync fallback values: max window 1825 days, normal
cooldown 300 seconds, failed-auth backoff 900 seconds, max auth attempts 3,
active lock TTL 1800 seconds, captcha TTL 180 seconds, GDT token TTL cap 82800
seconds.

Reason:

These values are part of the old operational behavior and unblock queue/service
implementation without guessing.

## DEC-028 Public Token Rate Limits

Decision:

Add rate limits to public token routes. Preserve old tracking pixel behavior of
120 requests per 60 seconds as the default. Use the existing Operis throttling
pattern for payment confirmation public preview/confirm/reject.

Reason:

Public token endpoints are unauthenticated and should be cheap to abuse-resist
without changing the business flow.

## DEC-029 Search Contract

Decision:

Implement invoice `search.ts` in M0 for invoice companies and invoices. Search
requires `invoice.view`, uses allowlisted text fields, keeps tax-code fields
hash-only, and excludes token/hash fields and provider payloads from index text.

Reason:

The M0 schema includes searchable invoice fields and the search package requires
modules with searchable entities to declare a search contract.

## DEC-030 Soft-Deleted Company History

Decision:

Invoices may reference soft-deleted `InvoiceCompany` rows for accounting
history. FK `restrict` protects hard delete only. Normal scoped reads hide
soft-deleted companies, while audit/detail flows that need historical company
display must opt in explicitly.

Reason:

Accounting records should keep their historical partner reference even if the
partner is later archived.

## DEC-031 DS Governance Pre-Registration

Decision:

Keep invoice backend/component globs in the DS governance config before the UI
files exist.

Reason:

Future M9 invoice UI work should be checked by the same design-system rules as
other backend module surfaces from the first UI file.
