# Codebase deduplication and canonical-helper adoption

- **Date:** 2026-09-28
- **Status:** Implemented on branch `refactor/dedupe-canonical-helpers` (from `apple-ui` at `f51dc42a`); not yet merged
- **Scope:** every layer — `packages/shared` canonical helpers and every call site that re-implements one, module-local
  duplicates, custom-route mutation-guard wiring, field validation (email, currency, pagination, dates), display
  formatters, and the near-duplicate screens and commands listed below.
- **Builds on:** the September 2026 passes that created the canonical helpers without adopting them —
  `ec61feee` (validation, date, authz and http helpers), `4efbb6ef` (string, email pattern, search guard),
  `7926f887` (file size, error message, password form), `22d6be52` (command scope helpers) — and the findings of
  [`.ai/analysis/2026-09-09-consistency-audit.md`](../analysis/2026-09-09-consistency-audit.md).

## TLDR

The canonical helpers existed; most call sites still carried private copies of them. This pass moved the copies onto
the canonical helpers, collapsed copies that live inside one module into that module, and added a shared home only for
infrastructure logic that several modules duplicated verbatim. Validation, custom-route mutation guards and display
formatting are standardized on one rule each, per the decisions below. Everything that intentionally stays different
is listed, with the reason, in [Intentional differences](#intentional-differences); every observable change is listed
in [Behaviour changes](#behaviour-changes).

## Overview

The work ran in seven phases, each verified before the next started:

1. Exact duplicates (no behaviour change) — private copies of shared helpers, re-declared types, identical copies
   inside one module, identical infrastructure copied across modules, re-export shims.
2. Validation — email, currency code, pagination, UUID, ISO date normalizers.
3. Mutation guards — every custom write route on `runRouteMutationGuards`; the deprecated pair removed.
4. Server patterns — list-envelope schema wrappers, the `x-om-operation` header, near-identical route pairs.
5. Client — display formatters, address editors and commands, the appointments create/edit forms, the WMS inventory
   pages.
6. Docs — this spec, the package guides, active skills, the consistency audit.
7. Verification — the CI gate and the Docker build on a copy of the tree, a generator-output comparison, per-batch
   commit checks.

## Problem Statement

Measured 2026-09-28 over 5,859 tracked, non-generated, non-test TypeScript files with read-only scripts:

| Finding | Count |
|---|---|
| Top-level functions with an identical body in more than one file | 425 groups (159 spanning modules) |
| Function names with several different bodies across files | 626 |
| Type/interface declarations copied between files | 184 groups |
| File pairs sharing ≥ 50% of their token shingles | 245 |

| Concept | Canonical | Before this pass |
|---|---|---|
| Password | `shared/lib/auth/passwordPolicy` | Already consistent (staff and portal share one policy) |
| Email | `shared/lib/validation` `emailSchema()` | 7 adopters; 41 hand-written rules in 27 files |
| Currency code | `currencyCodeSchema`, `CURRENCY_CODE_PATTERN` | 12 hard-coded `/^[A-Z]{3}$/` literals |
| Pagination | `paginationQuerySchema` | 4 adopters; ~200 hand-written `page`/`pageSize` rules |
| ISO dates | `shared/lib/date/normalize` | 31 local helpers in 23 variants |
| Custom-route mutation guards | `runRouteMutationGuards` | 57 routes canonical; 85 on the deprecated DI-only pair; 18 wired by hand (15 legacy-only) |
| Display dates / money | none | 150 local formatter definitions, several formats for the same purpose |

Copies drift: the same concept was validated up to six ways, a date rendered as `9 Jun 2026`, `06/09/2026` or
`2026-06-09 15:04:05` depending on the screen, and 85 write routes silently skipped every registry mutation guard.

## Proposed Solution

### Decisions

Recorded with the repository owner before implementation (2026-09-28):

1. **Mutation guards — full guard set.** Every custom write route runs `runRouteMutationGuards`, which runs every
   registered guard plus the bridged legacy service. The deprecated `validateCrudMutationGuard` /
   `runCrudMutationGuardAfterSuccess` pair and the five legacy-only module wrappers are removed. This is a
   deliberate behaviour change: registry guards (optimistic locking, the customer-account domain-mapping rules) now
   apply to routes that previously skipped them.
2. **Email — canonical everywhere.** Every email field uses `emailSchema()` (trim, cap at 320). Checkout's pay page
   keeps its stricter structural validator (see Intentional differences).
3. **Display formatters — standardized output.** One date format and one money format per purpose, defined in
   [Formatting standard](#formatting-standard). Some screens visibly change.
4. **Near-duplicate screens — included.** Merged so each pair shares one implementation, with rendered output and API
   behaviour proven unchanged.

### Phase 1 — exact duplicates

Every replacement was checked equivalent before the copy was removed (free-identifier comparison of the bodies, or
exact-semantics review where a shared helper already existed).

- **Private copies of shared helpers:** `normalizeOptionalString` ×22, `trimToUndefined`, `toIsoOrNull`, `isRecord`
  ×48, `isStringArray` ×5, comma-list parsing, `forkEm`, and ~20 singles.
- **Re-declared types:** 21 translator types → `TranslateWithFallbackFn` (plus `TranslateWithRequiredFallbackFn`),
  and ten domain types re-declared outside their owner.
- **Identical copies inside one module** moved into that module (`api/*Context.ts`, `lib/*`, `components/*` files in
  warranty_claims, customers, eudr, sales, wms, staff, invoice, appointments, workflows, planner, audit_logs, search,
  resources, messages, auth and ~20 smaller modules).
- **Identical infrastructure across modules** → new shared homes: `lib/guards`, `lib/async`, `lib/env`, `lib/array`,
  `lib/ids`, `lib/string/case`, `lib/http/{cookies,query,responses,sse}`, `lib/auth/actor`, `lib/di/tryResolve`,
  `lib/db/kysely`, `lib/encryption/{debugLog,decryptedRecord,rotation}`, `lib/i18n/translatorFallback`,
  `lib/indexers/{log-format,verbose}`, `lib/pagination/keysetCursor`, `lib/cli/args`, `lib/tree`. Additions to existing
  shared files: `date/format` (`toLocalDateKey`, `addDaysToIsoDate`, `startOfUtcDay`), `number` (`readCount`,
  `toFiniteNumber`), `search/descriptorHelpers`, `custom-fields` (`normalizeCustomFieldValue`).
- **ui ↔ core:** `ui/backend/detail/{attachmentFiles,dictionaryValue,tempId}`, `ui/backend/utils/{dateTimeLocalInput,
  customFieldOptionsUrl,customFieldSubmitValue,now,routeParams,treeIndent}`, `ui/backend/JsonBuilderCrudField`.
- **Re-export shims removed:** catalog, resources and staff `api/helpers.ts` (29 importers now use the shared module).

### Phase 2 — validation

- **Email:** 44 hand-written validators in 27 files → `emailSchema()`, keeping each site's message and any tighter
  cap (appointments 255, warranty per field). Client pre-checks → `LOOSE_EMAIL_PATTERN`; the ui message composer →
  `isEmailAddress` (now accepts exactly what the messages API accepts).
- **Currency:** 12 literals → `CURRENCY_CODE_PATTERN`; sales → `currencyCodeSchema` (same case normalization).
- **Pagination:** 106 `page`/`pageSize` pairs → `...paginationQuerySchema({ defaultPageSize }).shape` in place. The
  generated OpenAPI is byte-identical with the rewrite reverted.
- **UUID:** `shared/lib/validation/uuid` names the three rules in use (`UUID_SHAPE_PATTERN`, `RFC_UUID_PATTERN`,
  `RFC4122_UUID_PATTERN`); ~35 literal copies now use the named rule each site already applied.
- **ISO dates:** exact equivalents only → `toIsoOrEcho` / `toIsoOrNull`.
- **Clearable strings:** `shared/lib/validation/preprocess` (three identical factories, 73 uses).

### Phase 3 — mutation guards

- 82 routes on the deprecated pair or on legacy-only wiring → `runRouteMutationGuards` (74 by script, 8 by hand); 32
  callers of the five module wrappers (`catalog`, `integrations`, `messages`, `payment_gateways`, `staff`
  `api/guards.ts`) likewise; the wrappers are deleted. A later sweep moved the last eight hand-wired routes (configs
  cache, email accounting defaults, two eudr imports, push custom-send, sales quote send/convert, staff employee
  record).
- `runRouteMutationGuards` gained `runAfterSuccess({ resourceId })`: 31 routes ran their after-success hook with the
  written record's id rather than the validated one, and still do.
- `shared/lib/crud/mutation-guard.ts` keeps its types only; the deprecated functions are removed.
- The generator's extension-fact detector (`packages/cli/src/lib/generators/module-extension-facts.ts`) recognizes
  `runRouteMutationGuards` and `runMutationGuards` only.
- customers `resolveAuthActorId` (identical to the shared one) removed; nine importers use `shared/lib/auth/actor`.

### Phase 4 — server patterns

- **List envelopes:** `createOptionalMetaPagedListResponseSchema` in `shared/lib/openapi/crud`; the 17 identical module
  wrappers are now aliases of it.
- **Operation header:** `attachOperationMetadataHeader`, `OPERATION_METADATA_HEADER_NAME` and
  `OperationLogEntryLike` in `shared/lib/commands/operationMetadata` replace the CRUD factory's private copy, the
  customers/devices/messages/checkout helpers and 33 inline blocks.
- **Route pairs:** where two route handlers were equal once their constants were swapped, the body moved into one
  module-local helper and each route kept its literal `metadata` / `openApi` (the generator reads them statically):
  staff leave-request decisions, resource and customer tag assignment, message conversation actor mutations,
  customer interaction lifecycle, feature-toggle config readers, payment-gateway transaction actions, invoice payment
  confirmations and field updates, search reindex cancel, warranty claim action guards, comment author enrichment
  (`entities/lib/authorMetadata`).

### Phase 5 — client

- **Formatters:** the [Formatting standard](#formatting-standard) below; `ui/utils/format.ts` and four module format
  files deleted; 150 → 98 formatter definitions, the rest being distinct purposes.
- **File sizes:** the last three copies (ui attachment preview, the attachments field, catalog product media) →
  `formatFileSize` from `shared/lib/units/fileSize`.
- **Channel connect `Field` ×4** → the `FormField` primitive.
- **Addresses:** `shared/lib/location/postalAddress` (read / assign / patch the 14 address columns) replaces the
  per-command blocks in customers and staff `commands/addresses.ts`; the two `AddressTiles` share
  `ui/backend/detail/addressDraft` (draft shape, empty draft, server field map, validation-detail reader).
- **Appointments create/edit:** `appointments/components/useAppointmentFormFields.tsx` (customer search, phone
  lookup, location and service loaders, fields, groups) and `components/appointmentFormHelpers.ts`
  (`validateAppointmentForm`, `buildAppointmentRequestBody`, phone helpers). Each page keeps its own record loading,
  submit call and error mapping. The nine `appointments.edit.customerSearch.*` keys, identical in all eight locales
  to the `create` keys, were removed.
- **WMS inventory pages** (lot, SKU and location detail, inventory console, operational dashboard, lots list, lookup
  loaders): `components/backend/inventoryTypes.ts` (`PagedResponse`, `WarehouseOption`, canonical
  `InventoryBalanceRow` / `InventoryMovementRow`), `inventoryMovementDisplay.ts` (movement labels, status map,
  title/subtitle/location), `inventoryDetailFormat.ts` (distribution filters, `resolveBalanceStatus`),
  `InventoryKpiCard.tsx`, `useBalancePageSelection.ts`.

## Architecture

- **Where a helper lives:** in `shared` only when it is infrastructure used by several packages; in the owning module
  when copies sat inside one module; in `ui` when it needs React or ui primitives. No new module-to-module imports
  were introduced except where the target already depended on the source (e.g. appointments → directory hierarchy).
- **Sealed modules** (ADR-0007) keep relative imports internally; their new files sit inside the module.
- **Route helpers keep generator contracts:** each route file keeps its literal `metadata` and `openApi`, and every
  guard call keeps a literal `resourceKind` and `operation`, so generated route metadata, OpenAPI and extension facts
  stay static.
- **Screens keep their state where it was:** shared hooks take page-owned state as arguments when the page's own
  effects also write it, so effect order — and with it request order — is unchanged.

## Data Models

None. No entity, column, migration or persisted identifier changed. Translation keys are not persisted; the removed
duplicates are listed under Proposed Solution.

## API Contracts

No URL, method, ACL feature, event id or response shape changed. Observable API differences are the accepted ones in
[Behaviour changes](#behaviour-changes): email fields trim and cap at 320 (the OpenAPI schema gains `maxLength: 320`),
custom write routes can now answer the registry guards' 409/422, and `x-om-operation` always carries `executedAt`.

## Formatting standard

Display formatting lives in `@open-mercato/shared/lib/time` and `@open-mercato/shared/lib/units/money`. Every
formatter takes `{ locale?, fallback? }`: an empty or invalid value returns `fallback` (default `null`), and `locale:
''` means the runtime locale. `Intl` instances are cached per locale.

| Purpose | Function | en-US example |
|---|---|---|
| Calendar date | `formatDate` (`dateStyle: 'medium'`) | Jun 9, 2026 |
| Short date (cards, boards, compact rows) | `formatShortDate` | Jun 9 |
| Date and time | `formatDateTime` (medium date + short time) | Jun 9, 2026, 3:04 PM |
| Time of day | `formatTime` (`timeStyle: 'short'`) | 3:04 PM |
| Relative | `formatRelativeTime` (existing thresholds) | 5 minutes ago |
| Money | `formatCurrency(value, code?)` | $1,234.50 — without a code: 1,234.50; malformed code: `1,234.50 XYZ` |

Screens that need something else keep their own formatter and say why (see Intentional differences).

## Intentional differences

Kept on purpose, with the reason:

- **Formatters with a distinct purpose:** customers whole-unit card amounts, CompanyCard compact money, deals board
  decimals, dashboard KPI formatters, compact translated relative labels (CompanyCard, staff projects),
  Today/Yesterday labels, timezone-aware schedule ranges, email formats (appointments timezone, invoice UTC
  dd/mm/yyyy), input values (`<input type="date">` etc.), ISO keys, chart axis labels, search/seed text, DebugPanel.
- **Validation:** checkout's stricter pay-page email check; weak `.length(3)` currency checks (tightening would reject
  inputs accepted today); ~24 ISO-date variants with different null/echo/trim/throw rules; `moneyAmountSchema` not
  adopted (it adds scale and ceiling constraints).
- **Address editors:** the customers `AddressEditor` fork and the ui `AddressEditor` render differently (field layout,
  inline per-field errors, country picker, placeholders, fixed label keys vs `labelPrefix`, address-type source);
  merging would change one of them.
- **Appointments:** `BookingOverviewCreateSheet` is a compact sheet with its own markup. The edit form keeps three
  behaviours as explicit options of the shared code: `pickedPhone` (its own phone join), form-level-only validation
  (`attachFieldErrors: false`), and the embedded/profile-update extras.
- **WMS:** the lot page's movement title (lot keys, different cycle-count text), `matchesDistributionFilter` (lot and
  SKU filter differently), the location page's movement location, `WmsConfigurationPage`'s paged response.
- **Guards:** `communication_channels/lib/route-mutation-guard.ts` stays — a thin adapter over
  `runRouteMutationGuards` for that module's auth shape.
- **Phase 1 keeps:** helpers with the same name but different contracts (`buildToolContext`, `isModuleAiTool`,
  `fetchAgents`, per-module `tryResolve` returning `undefined`, `startOfDay` variants, `resolveIcon`), module-local
  state (widget registries, umes stores), example-module reference copies, frozen migrations.

## Behaviour changes

All accepted in the decisions above; nothing else changed observably.

- **Email fields** trim surrounding whitespace and reject more than 320 characters. The ui message composer accepts
  exactly what the messages API accepts.
- **Custom write routes** (Decision 1): registry guards now run on them —
  - a stale optimistic-lock header yields the lock guard's 409;
  - customer-account domain mappings get the format 422, collision and per-organization-limit 409 (`{ error,
    guardId }`) and record-scope checks.
  The legacy service sees `custom` as `update` and is no longer consulted for creates (as in `makeCrudRoute`).
  After-success hook failures are logged instead of failing a committed write. A guarded write resolves the caller's
  features once (one RBAC lookup) when the route does not pass them.
- **Warranty action routes:** the guard's 401 carries the translated message instead of the raw i18n key.
- **`x-om-operation`:** `executedAt` is always present (it was omitted only for a non-`Date` `createdAt`, which
  `ActionLog` never produces).
- **Display formats** follow the standard above: seconds dropped from date-times, month names instead of numeric dates,
  "Jun 9" short dates, two decimals for money without a currency. Some sites show their empty label for an invalid
  value instead of echoing it. The customers changelog row uses the shared relative-time thresholds. The attachments
  field and the product media list format sizes by the shared rule: a non-finite size shows `—` instead of `NaN`, a
  negative one `0 B`, and sizes of 1 TB and more use TB.
- **Channel connect forms** use `FormField`: the label is linked to its input and errors use the status token in a
  `role="alert"` paragraph.

## Risks & Impact Review

| Scenario | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| A client sends a stale lock header to a custom action route and now gets 409 | Medium | Custom write routes | Accepted in Decision 1; the header is only sent by lock-aware forms | Low |
| A guard's after-success hook fails and the failure is now only logged | Low | Guarded writes | Matches `makeCrudRoute`; the log carries the guard id | Low |
| An official module still imports the removed guard pair | Medium | `external/official-modules` | Typecheck fails loudly; migrate to `runRouteMutationGuards` | Low |
| A moved helper behaves differently at a call site | High | All phases | Equivalence checked per copy before removal (script-verified bodies, HEAD-vs-new harnesses for screens) | Low |
| A route factory makes `metadata`/`openApi` dynamic and the generator loses it | High | Route pairs | Literal `metadata`/`openApi` kept in every route file; generator output compared HEAD vs tree | Low |
| A visible format change surprises users | Low | Screens | Decision 3; formats listed above | Low |
| Jest whole-module mocks hide a new export | Medium | Tests | Mocks updated per file; full suites run per phase | Low |

## Verification

Per phase (details in the implementation log):

- typecheck (`typecheck:serial`, or `tsc --noEmit` per package) after every batch;
- ESLint and design-system lint deltas against HEAD: no new findings;
- jest for every touched package — full core suite (~13.6k tests) at each phase boundary;
- scans after every batch: unused imports, dead locals, whitespace runs, late imports, invisible characters.

Output-equality proofs:

- **Pagination:** OpenAPI byte-identical with the rewrite reverted.
- **Address tiles helpers:** byte-equal before removal.
- **Appointments forms:** HEAD page copies against the new pages in jsdom:
  - 34 tests, 968 snapshot pairs identical — rendered HTML, API calls with raw bodies, flashes, redirects and form
    writes;
  - covers 8 locales, the full interaction and submit matrices, clone/embedded/failure paths.
- **WMS helpers:** HEAD implementations against the shared ones over input matrices, plus the KPI card HTML against
  both HEAD cards.

Gate and build, on a fresh copy of the final tree (2026-09-28):

- the full CI gate passed: install, `build:packages`, `generate`, i18n sync and usage, `lint:check-graph`, `lint`,
  repo-wide guards, script tests, `audit:ci`, time-bombs, `typecheck:serial`, `test:ci`, `build:app`;
- the Docker `runner` image built (`linux/amd64`).

Generator output, HEAD against the tree, each side built the same way:

- route registries and every other file in `.mercato/generated`: identical once the generator's import-alias counters
  are normalized (they shift whenever a discovered file is added anywhere);
- `packages/*/generated`: identical;
- full OpenAPI (609 paths): 14 differences, all `maxLength: 320` on email fields (Decision 2);
- module fact sheets: 17 more hosts and 13 more mutation-guard bindings — the routes that used the removed module
  wrappers or wired guards by hand were invisible to the detector. No host or binding was lost; four hosts now cite a
  different site.

Commit series: 63 commits, every file in its final form, ordered shared → ui → other packages → modules → the removed
guard pair and the superseded copies → docs. An import scan fixes the order: a file lands no earlier than the new
exports it imports, and a removed export goes only after its last importer has moved. Two couplings sit outside the
scan: the customers custom-field test lands with the `formatDateTime` output it asserts on (commit 3), and the cli
fact extractor lands with customer_accounts, whose domain-mapping guards it must find through
`runRouteMutationGuards`. Commits 1–3 were rebuilt on a copy of HEAD and passed the full gate (commit 2 apart from
the known macOS jest-worker crash, with zero failed tests); commits 1–6 passed `build:packages`, `generate`,
`typecheck:serial` and their packages' tests. The later intermediate commits were not built one by one; the final
state was.

## Follow-ups

- Appointments edit form: picking a returning customer whose stored number has no leading `+` fills "84 912…", which
  the form's own save check rejects (create fills "+84 912…"); dropping the `pickedPhone` option fixes it. The edit
  form could also mark failing fields like create (`attachFieldErrors: true`). The create form's clone flow races the
  clone and branch-list responses (pre-existing).
- customers address update looks the address up without tenant scoping (pre-existing).
- configs `ModuleTelemetryPanel.tsx` holds a raw NUL byte (React key separator); text tools treat the file as binary.
- WMS `wms.backend.{lot,sku,location}.activity.types.*` and `{lot,sku}.distribution.status.*` hold identical text in
  every locale and could become one family.
- ui `version-history` still imports core `audit_logs/lib/display-helpers`.
- Adopt `moneyAmountSchema` and tighten the weak currency checks once the accepted-input change is decided.
- Pre-existing lint errors: catalog `products/[id]/page.tsx` (rules-of-hooks ×13), eudr `components/formConfig.tsx`.

## Superseded references

These documents describe APIs or paths this pass removed. They are records of earlier work and are not rewritten; read
them with this table:

| Removed | Use instead | Mentioned in |
|---|---|---|
| `validateCrudMutationGuard` / `runCrudMutationGuardAfterSuccess` | `runRouteMutationGuards` + `runAfterSuccess` | `.ai/plans/2026-05-27-crm-email-integration.md`, `.ai/specs/2026-05-21-email-integration-foundation.md`, `.ai/specs/2026-07-20-customer-interaction-completion-event-reliability.md`, `.ai/runs/2026-06-03-oss-lock-browser-coverage/NOTIFY.md` |
| Hand-wired `getAllMutationGuardInstances` + `bridgeLegacyGuard` + `runMutationGuards` in routes | `runRouteMutationGuards` (still built on them) | `.ai/specs/2026-06-30-omnibus-price-tracking.md`, `.ai/specs/2026-08-10-document-generators.md`, its analysis |
| `<module>/api/guards.ts` wrappers | `runRouteMutationGuards` | `.ai/analysis/2026-09-09-consistency-audit.md` |
| `@open-mercato/ui/utils/format` | `@open-mercato/shared/lib/time`, `@open-mercato/shared/lib/units/money` | `.ai/analysis/2026-09-09-consistency-audit.md`, `.ai/specs/2026-08-26-company-fields-pca-alignment.md` |
| `customers|devices|messages/lib/operationMetadata` | `shared/lib/commands/operationMetadata` | — |

## Final Compliance Report

- Tenant/organization scoping: unchanged; no query lost a scope filter (the one unscoped lookup above predates this pass).
- Generated files: none edited by hand; `yarn generate` output compared HEAD vs tree in Phase 7.
- Persisted identifiers (ACL features, event ids, notification types, schema): unchanged.
- No new production dependencies, no migrations, no new DS primitives.
- Hard-coded strings / colours: none added; moved code keeps its i18n keys.

## Changelog

- 2026-09-28 — Created. Inventory and decisions recorded; implementation in progress.
- 2026-09-28 — Phases 1–5 implemented; the last eight hand-wired guard routes moved to `runRouteMutationGuards`;
  proposed solution, architecture, formatting standard, intentional differences, behaviour changes, risks,
  verification, follow-ups and superseded references filled in.
- 2026-09-28 — Final verification: full CI gate and Docker build passed on a copy of the tree; generator output
  compared with HEAD (see Verification).
- 2026-09-29 — Split into 63 dependency-ordered commits; the customers custom-field test moved to the formatter
  commit (see Verification).
