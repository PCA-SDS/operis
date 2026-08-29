# Align company fields with PCA ERP's CRM client model

## TLDR

`customer_companies` gains nine account-governance columns taken from PCA ERP's
`crm.company_clients` — tax code, registration country, registered address,
incorporation date, client tier, and the four client-lifecycle dates. Client tier
lands as a new `client-tiers` dictionary kind rather than a separate catalog table.
Status transitions now stamp the lifecycle dates automatically. The companies grid
drops Next interaction, Marketing case study ready and Renewal quarter.

## Overview

Operis's `customers` module is a sales-pipeline CRM: people, companies, deals,
pipelines, activities, interactions, a calendar. PCA ERP's `crm` module is a
client-master / account-governance CRM: KYC identifiers, a client lifecycle with
dated transitions, per-tenant tier and service catalogs.

The two describe a company very differently. Operis had no tax code at all, no
registration country, no incorporation date, no lifecycle dates and no tier. This
change closes that gap on the company record while leaving Operis's own
architecture — and its pipeline half — untouched.

## Problem Statement

1. A company in Operis carries no legal identifier. `search.ts` already declared
   `hashOnly: ['tax_id', 'registration_number']` and `message-objects.ts` already
   set `optionSubtitleField: 'taxId'`, both pointing at columns that never existed.
2. There is no way to record when a client entered the pipeline, when they were
   registered, or when the relationship ended — so no cohort or churn reporting is
   possible from company data.
3. There is no notion of a client tier.
4. The companies grid led with sales-pipeline signals (Next interaction) and two
   demo custom fields, rather than the account-identity columns PCA's list leads with.

## Proposed Solution

### Where the fields live

Operis splits a company across `customer_entities` (the polymorphic root, FK'd by
deals, activities, addresses, tags, comments, todos and interactions) and
`customer_companies` (the company-specific profile). PCA uses one flat table.

**All new fields go on `customer_companies`.** Flattening to mirror PCA literally
would mean rewriting every FK in the module; the field set is what matters, not
the table count.

Columns are `text` / `date` / `timestamptz` per Operis convention — `data/entities.ts`
uses no `varchar` anywhere. PCA's varchar limits are enforced in the zod validator
instead, so the contract is the same at the request boundary.

## Data Models

`customer_companies` (`packages/core/src/modules/customers/data/entities.ts`):

| PCA `crm.company_clients` | Operis column | Type | Notes |
|---|---|---|---|
| `tax_code` varchar(20) | `tax_code` | text NULL | partial unique `(tenant_id, tax_code) WHERE tax_code IS NOT NULL` |
| `registration_country` varchar(120) | `registration_country` | text NULL | open set |
| `address` varchar(500) | `address` | text NULL | flat registry address; structured `customer_addresses` is unchanged |
| `incorporation_date` date | `incorporation_date` | date NULL | |
| `client_tier_id` uuid FK | `client_tier` | text NULL | dictionary value, not an FK |
| `onboarded_at` date | `onboarded_at` | date NULL | auto-stamped |
| `registered_at` date | `registered_at` | date NULL | auto-stamped |
| `end_date` date | `end_date` | date NULL | auto-stamped |
| `reactivated_at` timestamp | `reactivated_at` | timestamptz NULL | service-written only; not accepted on the wire |

Migration: `migrations/Migration20260826095354_customers.ts`, with the module
snapshot regenerated. `yarn db:generate` reports `customers: no changes` afterwards.

Already covered, unchanged: `company_name` → `customer_entities.display_name` plus
the profile's `legal_name`; `status` → `customer_entities.status`; `website` →
`website_url`; `industry`; `created_at` / `updated_at`.

### Not ported

`section_order text[]` backs PCA's drag-rearrangeable detail card grid. Operis's
company detail page is tabbed, and Operis already has `perspectives` for view
preferences, so the column would have no reader or writer. Left out deliberately.

## Client tier as a dictionary kind

Rather than a second catalog system beside `dictionaries`, tier is the new
`client-tiers` kind. Operis dictionary entries already carry label, colour, icon
and sort order per tenant — the same shape as PCA's `crm.client_tiers` — and come
with a settings UI, validators and a picker for free.

Four wiring points, all required:

- `lib/dictionaries.ts` — `CUSTOMER_DICTIONARY_KINDS`
- `api/dictionaries/context.ts` — `BUILTIN_DICTIONARY_ROUTE_KINDS` and
  `KIND_MAP['client-tiers'] = 'client_tier'` (plural-kebab route → singular-snake column)
- `data/validators.ts` — `KNOWN_DICTIONARY_KINDS`

Seeded with Standard and VIP in `cli.ts#seedCustomerDictionaries`, matching the
pair PCA auto-creates per tenant.

## Status values

`ENTITY_STATUS_DEFAULTS` moves from `active / inactive / pending / archived` to
PCA's `prospect / active / inactive / blacklisted`. Seeding is additive via
`ensureDictionaryEntry`, so existing tenants keep any `pending` / `archived`
entries; only new tenants get the PCA set.

## Lifecycle auto-stamping

`commands/companies.ts#applyCompanyLifecycleDates`, called from both the create and
update commands inside the existing `withAtomicFlush` phase:

```
create as prospect  → onboarded_at  = today
→ prospect          → onboarded_at ??= today
→ active            → onboarded_at ??= today
                      registered_at ??= today
                      end_date = null
                      reactivated_at = now, when the prior status was
                                       inactive or blacklisted
→ inactive          → end_date = today
→ blacklisted       → end_date = today
```

A status outside the four PCA values leaves every date untouched, so a
tenant-defined status stays inert. A date the caller supplied explicitly always
wins over the stamp, which is what lets an import or a correction backfill real
history.

This is deliberately **not** PCA's full guarded state machine — there is no
dedicated status endpoint, no allowed-transition table and no 409 on a racing
write. Status remains an ordinary field on the general update.

## API Contracts

No new endpoints. The nine fields flow through the existing surfaces:

- `POST` / `PUT /api/customers/companies` accept all of them except `reactivatedAt`
- `GET /api/customers/companies` returns them snake_cased on each list row
- `GET /api/customers/companies/:id` returns them camelCased under `profile`

Adding a company profile field means editing six allowlists; missing one drops the
value silently rather than rejecting it:

| File | What |
|---|---|
| `data/validators.ts` | `companyDetailsSchema` |
| `api/companies/payload.ts` | `SUPPORTED_COMPANY_PROFILE_KEYS` |
| `api/companies/route.ts` | list projection |
| `api/companies/[id]/route.ts` | detail projection + response zod |
| `commands/companies.ts` | snapshot type, read, create, update, 6 undo restore sites |
| `components/formConfig.tsx` | value type, zod, field defs, group arrays, `assign()`, edit schema |

## UI

- **Create / edit form** — two new groups: *Identification* (tax code, registration
  country, registered address, incorporation date, client tier) and *Lifecycle*
  (onboarded, registered, end date).
- **Companies grid** — adds Tax code, Tier and Onboarded as visible columns;
  Registration country, Registered address, Incorporated, Registered and End date
  ship hidden behind the column chooser. Removes the Next interaction column and
  filters `customer_marketing_case` / `renewal_quarter` out of the custom-field
  columns. `customFieldDefaults.ts` is untouched, so existing tenant data survives.
- **Company detail** — eight new inline-editable rows, tier through
  `InlineDictionaryEditor`.

Twenty-four new i18n keys, translated in all five locales (en, de, es, ko, pl).

## Security

`tax_code` is **deliberately not added to `encryption.ts`**, unlike its sibling
`legal_name` / `domain` / `industry` on the same entity. Two reasons:

1. The per-tenant uniqueness guarantee is a Postgres unique index. Tenant data
   encryption is non-deterministic, so an index over ciphertext cannot detect a
   duplicate — encrypting the column would silently void the constraint this
   change exists to provide.
2. A company tax code is a public business-register identifier in both
   jurisdictions PCA supports, not personal data.

It is still treated as sensitive for search: `search.ts#fieldPolicy` lists it under
`hashOnly`, so it is matched through the hashed token index rather than
plaintext-indexed. That is what the pre-existing (and until now dangling)
`hashOnly: ['tax_id']` entry was reaching for.

The remaining new fields are business metadata (a dictionary value and four dates)
and carry no PII. Tenant and organization scoping is unchanged — every field rides
the existing `makeCrudRoute` scoping, and no new endpoint or ACL feature is added.

## UI consistency

- Dates render through the shared `formatDate` from `@open-mercato/ui/utils/format`
  on **both** the list and the detail page. The list page's local `toLocaleDateString`
  helper was deleted — its only remaining caller was the Next interaction column that
  this change removes — so there is now one date format across the two surfaces.
- Empty date cells fall back to the same muted `noValue` span every other column in
  the grid uses, rather than an unstyled string.
- `client_tier` renders through `renderDictionaryCell` in the grid and
  `InlineDictionaryEditor` on the detail page — the same components `status`,
  `lifecycleStage`, `source` and `industry` already use.
- Every new column's `columnChooserGroup` matches its `filterGroup`, the convention
  the rest of the table follows. Two coherent groups result: Identification (5) and
  Lifecycle (4).
- The registered address is a `textarea` in the form and a `multiline` detail field
  spanning the full grid row (`sm:col-span-2 xl:col-span-3`), copying the sibling
  `description` field. A textarea in a one-third grid cell would make its row taller
  than its neighbours.
- The Identification form group orders its four half-width fields into two even rows
  with the full-width address closing the group, so no row is left half-empty.
- The Lifecycle group carries a `description` explaining the dates are stamped
  automatically, so three empty date inputs do not read as required.

## Date-only columns

The four lifecycle dates and `incorporation_date` are `type: 'date'` columns. MikroORM
maps those to a **`Date` instance**, so the properties are typed `Date | null` — the
convention `staff/data/entities.ts` already follows.

Declaring them `string | null` (the first attempt) type-checked, built, passed 11 594
unit tests and applied its migration cleanly, then returned **HTTP 500 on every company
create** at runtime. It was caught only by the integration suite.

Both directions therefore go through `lib/dateOnly.ts` so no call site has to remember:

| Helper | Use |
|---|---|
| `toDateOnlyValue(v)` | wire `YYYY-MM-DD` → `Date`, on create, update and undo-restore |
| `toDateOnlyString(v)` | `Date` → `YYYY-MM-DD`, in both API projections and the undo snapshot |
| `todayDateOnly()` | the stamp value used by `applyCompanyLifecycleDates` |

The projections must emit `YYYY-MM-DD`, not a full ISO timestamp: the detail page feeds
these values straight into an `<input type="date">`, which rejects anything longer. The
undo snapshot stores the string form because the action log is JSON.

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| One of the six allowlists is missed on a future field, dropping it silently | Medium | API | TC-CRM-088 asserts round-trip on every new field | Low — a new field still needs its own assertion |
| Partial unique on `tax_code` collides with existing data | Low | DB | The column is new, so nothing can collide at apply time | None |
| Lifecycle stamping overwrites a deliberate historical date | Medium | Data | Explicitly supplied dates always win; covered by TC-CRM-088 | Low |
| `ENTITY_STATUS_DEFAULTS` change alters new-tenant seeds | Low | Setup | Additive seeding; existing tenants keep their entries | Low |
| `yarn db:generate` emits unrelated `mcp` / `wms` drift | Low | Build | Those files were removed and their snapshots reverted; only the customers migration is committed | Low — the drift recurs for anyone running the generator |
| No guarded status transitions, unlike PCA | Medium | Domain | Explicit scope decision; a concurrent status write can still interleave | Accepted |

## Final Compliance Report

| Gate | Result |
|---|---|
| `yarn generate` | pass |
| `yarn db:generate` | `customers: no changes` (no-op re-check) |
| `yarn build:packages` | 23/23 |
| `yarn typecheck` | 23/23 |
| `yarn lint` | 0 errors (8 pre-existing warnings, unrelated files) |
| `yarn lint:ds` | 0 errors; the one warning on the companies list is pre-existing (line-shifted only) |
| `yarn build:app` | compiled successfully, 0 warnings |
| `yarn check:client-boundaries` / `logger:check-console` | pass |
| unit tests | `@open-mercato/core` 1420 suites / 11594 tests passing; 26-package `yarn test` green apart from the known jest worker SIGSEGV flake |
| `yarn i18n:check-values` | 0 missing across all five locales |
| integration | `TC-CRM-088` **4/4 passing** against ephemeral Postgres + a live app (migrations applied by the runner) |

## Changelog

- **2026-08-26** — Fixed `type: 'date'` properties declared as `string | null`, which
  500'd every company create at runtime; added `lib/dateOnly.ts` and routed all write,
  read, snapshot and restore paths through it. Caught by TC-CRM-088, which now passes
  4/4 end to end. Added the missing Client tiers section to the dictionary settings page
  (its list is hardcoded, so a new kind is not picked up automatically), completed the
  under-documented OpenAPI list-item schema, and pointed `message-objects.ts` at the real
  `taxCode` field instead of the non-existent `taxId`.
- **2026-08-26** — UI consistency pass: shared `formatDate` across list and detail,
  muted empty-state parity, chooser/filter group alignment, full-row multiline
  address, ordered form groups, lifecycle hint, `reactivated_at` surfaced (it was
  projected by the list route but read by nothing). Security rationale for leaving
  `tax_code` unencrypted recorded above.
- **2026-08-26** — Initial implementation. Nine columns on `customer_companies`,
  the `client-tiers` dictionary kind, PCA's status seed set, lifecycle
  auto-stamping in the company commands, form/grid/detail surfaces, i18n for five
  locales, and TC-CRM-088.
