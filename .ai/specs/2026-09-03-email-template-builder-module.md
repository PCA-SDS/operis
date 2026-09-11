# Email Template Builder Module

## TLDR

Create a new core `email` module in `packages/core/src/modules/email` for
tenant-owned email templates and accounting-email defaults. This replaces the
earlier `pca_erp` plan because Operis is the active ERP and uses a different
architecture: Next.js App Router, MikroORM, Awilix DI, module auto-discovery,
feature RBAC, tenant/org scoping, and optional tenant data encryption.

First implementation scope is DB/BE only:

- module shell, metadata, ACL, setup, DI, entities, validators, API routes, and
  migrations
- tenant/org-scoped email templates
- tenant-owned accounting defaults and template-selection metadata
- visual-builder-ready block JSON, without building the frontend editor yet
- source migration map from `pca_accounting`, treating existing data as PCA
  tenant-owned data

Frontend builder, workflow execution, live sending, and production data import
are follow-up phases.

## Overview

The legacy `pca_accounting` project contains accounting email behavior and
templates that need to become an Operis module. The module id remains `email`.
Users must be able to own and edit their tenant's accounting defaults, because
Operis is a customer-facing multi-tenant ERP and PCA is only the first customer.

Operis already has communication channels, notifications, messages, workflows,
business rules, and transactional email transport. This spec does not replace
those systems. The new module owns reusable email-template authoring and
selection metadata. Later phases can let `business_rules` and `workflows`
select and execute templates.

## Problem Statement

The previous email-template work targeted `pca_erp`, which is no longer the
active product. That work used NestJS, Prisma, Postgres schemas, pnpm, and a
different tenancy model. Porting it directly would violate Operis conventions
and could bypass its security primitives.

Operis needs a fresh implementation plan that answers:

- where the `email` module lives
- how template data is tenant/org scoped
- which fields are editable by each tenant
- how accounting defaults are represented without hardcoding PCA behavior
- how rules drive future workflow/template selection
- how visual-builder blocks are persisted before the frontend exists
- how Google Drive/Sheets links become safe placeholders or tenant defaults
- how CI-sensitive validation should be staged

## Proposed Solution

Implement an Operis-native core module:

```text
packages/core/src/modules/email
```

Use `customers` as the CRUD and module-structure reference. Use
`business_rules` and `workflows` only as future integration boundaries; do not
hardwire workflow selection in the first slice.

The module stores:

1. **Templates** — tenant/org-scoped editable template records.
2. **Template blocks** — visual-builder-ready JSON blocks and ordering.
3. **Accounting defaults** — tenant/org-owned default placeholders, links,
   sending context, and rule metadata used to select a template later.
4. **Template versions or snapshots** — immutable publish-time snapshots in a
   later phase if needed for sends/workflows.

The first PR should be boring and reviewable: DB/BE contracts only, small API
surface, focused tests, no UI-heavy implementation.

## Architecture

### Module Layout

```text
packages/core/src/modules/email/
  index.ts
  acl.ts
  setup.ts
  di.ts
  data/
    entities.ts
    validators.ts
  api/
    openapi.ts
    templates/route.ts
    templates/[id]/route.ts
    accounting-defaults/route.ts
  commands/
    templates.ts
    accounting-defaults.ts
  services/
    templateRenderer.ts
    accountingDefaults.ts
  migrations/
    MigrationYYYYMMDDHHMMSS.ts
    .snapshot-open-mercato.json
  __tests__/
  __integration__/
```

### Module Activation

Add `{ id: 'email', from: '@open-mercato/core' }` to
`apps/mercato/src/modules.ts` once the module shell is in place. Run
`yarn generate` after adding module files or changing activation.

### ACL

Initial feature IDs:

- `email.templates.view`
- `email.templates.manage`
- `email.accounting_defaults.view`
- `email.accounting_defaults.manage`

Default grants:

- `admin`: `email.*`
- `employee`: likely `email.templates.view` only, if any grant is needed for
  read-only template usage

Any route/page must use `requireFeatures`; do not gate by mutable role names.

### API

Initial private APIs:

- `GET /api/email/templates`
- `POST /api/email/templates`
- `GET /api/email/templates/:id`
- `PATCH /api/email/templates/:id`
- `DELETE /api/email/templates/:id`
- `GET /api/email/accounting-defaults`
- `PUT /api/email/accounting-defaults`

Every route must export `openApi`. CRUD-style routes should use `makeCrudRoute`
where it fits. Custom writes must use the mutation guard contract.

## Data Models

All records are tenant scoped. Records tied to normal staff usage should also
carry `organization_id`.

### `email_templates`

Suggested columns:

- `id` uuid primary key
- `tenant_id` uuid not null
- `organization_id` uuid not null
- `template_key` text not null
- `name` text not null
- `description` text null
- `category` text not null, e.g. `accounting`
- `status` text not null, e.g. `draft`, `published`, `archived`
- `subject` text not null
- `preheader` text null
- `design` jsonb not null
- `blocks` jsonb not null
- `variables` jsonb not null
- `accounting_metadata` jsonb null
- `created_by_user_id` uuid null
- `updated_by_user_id` uuid null
- `created_at` timestamptz not null
- `updated_at` timestamptz not null
- `deleted_at` timestamptz null

Indexes/constraints:

- unique active `(tenant_id, organization_id, template_key)` where
  `deleted_at is null`
- `(tenant_id, organization_id, category, status)`
- `(tenant_id, organization_id, updated_at)`

### `email_accounting_defaults`

Suggested columns:

- `id` uuid primary key
- `tenant_id` uuid not null
- `organization_id` uuid not null
- `default_sender_name` text null
- `default_reply_to` text null
- `placeholders` jsonb not null
- `link_placeholders` jsonb not null
- `rules` jsonb not null
- `created_at` timestamptz not null
- `updated_at` timestamptz not null

Indexes/constraints:

- unique `(tenant_id, organization_id)`

Google Drive/Sheets links from `pca_accounting` should not be hardcoded. Store
them as tenant-editable placeholders or seeded PCA examples.

## Security And Privacy

### Tenant Boundary

`tenant_id` is mandatory on all module-owned tables. Every read/write must scope
by trusted request context, never by client-submitted tenant IDs.

### Organization Scope

`organization_id` is mandatory for templates/defaults unless a specific global
tenant-level use case is proven. A user's organization visibility should narrow
list/detail access.

### RBAC

All API methods and future backend pages require stable feature IDs from
`acl.ts`. Server-side conditional checks must use RBAC services or shared
feature-policy helpers, not raw array matching.

### Encryption

Template subjects, body blocks, variables, and accounting defaults may contain
business-sensitive or recipient-facing information. The first implementation
must avoid adding plaintext search over fields that may later be encrypted.

If fields are added to tenant encryption maps later:

- exact lookup needs hash columns
- substring search must use token index/query engine patterns
- raw `em.find` filters over encrypted text must be avoided

### Data Minimization

Accounting template metadata should store selection facts and placeholder keys,
not copied client records or personal data. Runtime workflow/send phases should
re-read owning module data under tenant scope.

### Cross-Module Isolation

The `email` module must not create direct ORM relationships to `customers`,
`invoice`, `business_rules`, `workflows`, or communication channel modules.
Use scalar IDs, snapshots, events, or optional DI resolution where integration
is needed.

## Migration From `pca_accounting`

Treat `pca_accounting` as a source system, not a codebase to paste in.

### Source Inventory Tasks

- Identify existing template definitions, hardcoded subjects, bodies, and
  variable names.
- Identify accounting defaults and which tenant/user should own them.
- Identify rule-like conditions used for choosing templates.
- Identify Google Drive/Sheets links and classify each as:
  - required tenant default
  - example placeholder
  - obsolete local/test data
- Identify any secrets, tokens, emails, or client data that must not be seeded
  globally.

### Import Policy

- Current `pca_accounting` data belongs to the PCA tenant.
- Source defaults may be seeded as PCA example/default rows only when the target
  tenant is PCA or when example data is explicitly requested.
- No source customer data should become global module defaults.
- No source hardcoded provider links should ship as hidden constants.

## Phasing

### M0 — Discovery And Spec

- Read Operis rules, security docs, and similar module patterns.
- Create this spec.
- Inventory `pca_accounting` once local file access is responsive.

### M1 — Module Shell And Contracts

- Add `packages/core/src/modules/email`.
- Add metadata, ACL, setup, DI, validators, OpenAPI helper, and skeletal tests.
- Enable the module in `apps/mercato/src/modules.ts`.
- Run `yarn generate`.

### M2 — DB/BE Foundation

- Add MikroORM entities and migration/snapshot.
- Add commands/services for template CRUD and accounting defaults.
- Add scoped APIs with OpenAPI metadata.
- Add RBAC and tenant/org-scope tests.

### M3 — PCA Accounting Mapping

- Convert source templates/defaults into structured seed data or import script.
- Convert hardcoded links into placeholders.
- Keep PCA data tenant-owned.

### M4 — Workflow/Rules Integration

- Expose safe template-selection metadata to `business_rules`/`workflows`.
- Do not execute arbitrary expressions or user code.
- Keep workflow selection tenant-scoped and auditable.

### M5 — Frontend Builder

- Build visual template editor over persisted `blocks`.
- Add optimistic-lock handling in forms.
- Add i18n and design-system compliant UI.

## API Contracts

Draft request/response shapes:

```ts
type EmailTemplateStatus = 'draft' | 'published' | 'archived'

type EmailTemplateBlock = {
  id: string
  type: string
  props: Record<string, unknown>
}

type AccountingTemplateMetadata = {
  purpose: string
  ruleKeys: string[]
  requiredVariables: string[]
  samplePlaceholders: Record<string, string>
}
```

Exact Zod schemas will live in `data/validators.ts`. Responses must include
`updatedAt` for optimistic locking.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual Risk |
| --- | --- | --- | --- |
| Cross-tenant template leak | High | Mandatory `tenant_id`, scoped query engine/filters, integration tests | Direct ORM calls must be reviewed carefully |
| Tenant defaults become PCA-global | High | Seed PCA data only as PCA-owned or explicit examples | Requires careful source inventory |
| Hardcoded Drive/Sheets links leak private resources | Medium | Store as tenant-editable placeholders, no hidden constants | Existing source links need classification |
| Encryption breaks search later | Medium | Avoid plaintext DB text filters; plan token/hash strategy | Full search may be deferred |
| Workflow rules execute unsafe logic | High | Store metadata only in v1; integrate with existing rules/workflows later | Rule engine contract must be rechecked in M4 |
| CI churn from generated/migration files | Medium | Small PR slices, review generated output, run targeted gates | Full CI may still uncover unrelated baseline issues |

## Validation Plan

Use local mode unless a compose `app` container is running.

For M1/M2:

```bash
yarn generate
yarn db:generate
yarn workspace @open-mercato/core build
yarn workspace @open-mercato/core test
```

Before PR:

```bash
yarn build:packages
yarn typecheck
yarn lint
yarn test
```

Do not run `yarn db:migrate` without explicit approval; normal PRs should
include reviewed migration files and snapshots.

## Open Questions

- Should `email_accounting_defaults` be tenant-level only or organization-level
  from day one?
- Should published templates have immutable version snapshots in M2 or wait
  until actual sending/workflows?
- Which default roles should get `email.templates.view`?
- Should template body/design fields be included in tenant encryption defaults
  immediately or only be encryption-map eligible?

## Final Compliance Report

Pending. This spec is pre-implementation and must not be moved to
`.ai/specs/implemented/` until all scoped phases selected for the PR are coded,
validated, and deployed/accepted.

## Changelog

- 2026-09-03: Created Operis-native email template builder module spec after
  confirming `pca_erp` is no longer the active ERP.
- 2026-09-03: Started M1/M2 with the core `email` module shell, ACL/setup,
  template/defaults entities, scoped API contracts, commands, and initial
  MikroORM migration/snapshot.
