# Upstream ports

Operis does not track Open Mercato ([ADR-0001](adr/ADR-0001-fork-from-open-mercato.md)), but it
can take selected upstream changes. This file records every upstream change ported into Operis and
every one deliberately left out, so the next comparison starts from here instead of from the fork
point.

## Baseline

| | |
|---|---|
| Fork point | `3019dc2328af92dd46d75243d9ba0197d0c0ed07` (see [`NOTICE.md`](../../NOTICE.md)) |
| Last upstream release compared | `v0.8.0` (`ab23d45ffc`, 2026-09-18), compared 2026-09-29 |
| Upstream remote | `upstream` → `https://github.com/open-mercato/open-mercato.git`, fetch `main` only, push disabled |

Operis history starts from its own initial commit, so git shares no history with upstream and a
merge is not possible. Changes are ported one upstream commit at a time.

## How a port is done

1. Map each release-notes PR to its commit on upstream `develop` (a squash commit, or a merge
   commit applied with `-m 1`). Also check upstream `main` between the fork point and the release
   tag: hotfixes land there first and reach `develop` only through a sync merge, so the `develop`
   squash of the same fix can be a partial diff. Three such hotfixes sat between the fork point and
   the `v0.7.0` tag.
2. In a separate worktree, `git cherry-pick --no-commit` each commit in upstream order.
3. Resolve conflicts in favour of Operis's deviations (next section), and port a missing upstream
   prerequisite rather than hand-rebuilding what it introduced.
4. Never port `packages/enterprise/**`, `.ai/specs/enterprise/**` or `packages/create-app/**`
   ([ADR-0002](adr/ADR-0002-exclude-enterprise-edition.md), `NOTICE.md`).
5. Run the full validation list from `.ai/agentic.config.json` and the Docker image build.

## Operis deviations kept while porting

- **Shared helpers stay shared.** Upstream code that re-adds a local helper Operis consolidated is
  pointed at the shared one: `cloneJson`, `toNumericString`, `toNumber` (upstream
  `normalizeNumber`), `formatCurrency` (upstream `formatMoney`), `emailSchema`,
  `normalizeOrganizations`, the customers `detailRouteHelpers` and the search `organizationIds`
  helper. The new `sales/lib/json.ts` copy was not added.
- **Design-system tables** render `role="row"` / `role="columnheader"` / `role="cell"`, not
  `<tr>`/`<th>`/`<td>`. Upstream tests that query table tags were changed to query roles.
- **Sealed modules** import their own files relatively (for example `onboarding`).
- **Entity decorators** come from `@open-mercato/shared/lib/db/decorators`, and the migration runner
  does not set `metadataProvider: ReflectMetadataProvider`.
- **Enricher cache keys** keep Operis's shape without the target entity; Operis has no wildcard
  enrichers (upstream #5798 was not ported).
- **Scaffold-template tests** stay guarded by `whenTemplatePresent()`.
- **Load effects cancel their requests.** New upstream effects that fetch data get an
  `AbortController` (Operis guard `list-load-request-cancellation`).
- **Operis-only locales** (`vi`, `fr`, `zh`) receive new keys through
  `yarn i18n:check-sync --fix`, which fills English text as a placeholder to translate.

## v0.8.0 selective port (2026-09-29)

Scope, risks and verification: [`.ai/specs/2026-09-29-upstream-v0.8-selective-port.md`](../../.ai/specs/2026-09-29-upstream-v0.8-selective-port.md).
"Adapted" marks a change whose conflicts were resolved or which needed Operis-specific edits.

### Security

| Upstream PR | Upstream commit | Change | Adapted |
|---|---|---|---|
| [#5381](https://github.com/open-mercato/open-mercato/pull/5381) | `d14d75758` | Fix manual trigger and execution history returning 404 for every system-scoped schedule |  |
| [#5365](https://github.com/open-mercato/open-mercato/pull/5365) | `23445b3f3` | Log ACL permission changes (role and user grants) to the action-log audit trail | yes |
| [#5463](https://github.com/open-mercato/open-mercato/pull/5463) | `70d74d4bf` | Redact rule condition and entity values from debug logs |  |
| [#5459](https://github.com/open-mercato/open-mercato/pull/5459) | `10db5db20` | Scope deal-analyzer person links to tenant/org via the deal map |  |
| [#5462](https://github.com/open-mercato/open-mercato/pull/5462) | `f39753255` | Enforce organization scoping on the legacy activities list |  |
| [#5464](https://github.com/open-mercato/open-mercato/pull/5464) | `ae388cac0` | Reject domain registration for organizations outside the caller's tenant |  |
| [#5469](https://github.com/open-mercato/open-mercato/pull/5469) | `b41427429` | Fail closed on collapsed organization scope for customer todos and tasks |  |
| [#5465](https://github.com/open-mercato/open-mercato/pull/5465) | `2e20648fd` | Enforce per-entity ACL in the legacy AI search tool pack |  |
| [#5261](https://github.com/open-mercato/open-mercato/pull/5261) | `6b7dab7dc` | Validate test-send recipients against the provider's own capabilities, with a hardened transport-safety allowlist for non-email providers | yes |
| [#5492](https://github.com/open-mercato/open-mercato/pull/5492) | `1a563a270` | Match check-phone through the decryption path |  |
| [#5455](https://github.com/open-mercato/open-mercato/pull/5455) | `82e9867ea` | Restrict scheduler queue targets to authorized safe workers | yes |
| [#5277](https://github.com/open-mercato/open-mercato/pull/5277) | `c55b52e1a` | Preserve system-actor identity on command-bus audit entries instead of dropping it |  |
| [#5517](https://github.com/open-mercato/open-mercato/pull/5517) | `6ce75ce8d` | Stop customer detail and sub-resource routes from leaking record existence | yes |
| [#5138](https://github.com/open-mercato/open-mercato/pull/5138) | `94f1126c1` | Raise Yarn's npm minimal-age gate from 1 day to 5 days to close the supply-chain window for compromised-maintainer package publishes | yes |
| [#5568](https://github.com/open-mercato/open-mercato/pull/5568) | `8bd7cbbd0` | Validate a password reset token on load and show a terminal state for a dead link instead of a working-looking form |  |
| [#5544](https://github.com/open-mercato/open-mercato/pull/5544) | `15164f163` | Align client-side feature checks with the caller's selected organization instead of the JWT's home scope |  |
| [#5563](https://github.com/open-mercato/open-mercato/pull/5563) | `97319f09f` | Align the Dependabot npm cooldown with npmMinimalAgeGate so quarantined package versions are never proposed | yes |
| [#5529](https://github.com/open-mercato/open-mercato/pull/5529) | `484e69a26` | Surface login failures instead of an empty 500 (0.7.0 main hotfix) | yes |
| [#5623](https://github.com/open-mercato/open-mercato/pull/5623) | `fc679c070` | Preserve partial user ACL updates (0.7.0 main hotfix, core of #5537) | yes |
| [#5537](https://github.com/open-mercato/open-mercato/pull/5537) | `53fe9dd1b` | Preserve partial user ACL updates | yes |
| [#5677](https://github.com/open-mercato/open-mercato/pull/5677) | `c980628b2` | Stop public signup from disclosing whether an email already has an account, closing every response, timing and pending-request oracle | yes |
| [#5671](https://github.com/open-mercato/open-mercato/pull/5671) | `d486e6f1b` | Resolve the resend-invite email origin from the request instead of its URL string, fixing 400s behind a reverse proxy |  |
| [#5554](https://github.com/open-mercato/open-mercato/pull/5554) | `a0154ac41` | Audit every manual scheduler trigger, refusals included, and run it as the triggering user rather than the schedule's creator | yes |
| [#5841](https://github.com/open-mercato/open-mercato/pull/5841) | `96f7b98ff` | Parse decrypted jsonb fields back to objects instead of leaving ciphertext-shaped strings | yes |
| [#5665](https://github.com/open-mercato/open-mercato/pull/5665) | `0a7634eb3` | Dispatch app-level `entry.overrides` in the CLI/worker/scheduler bootstrap path, so `seed-encryption` and other commands stop silently ignoring declared override domains | yes |
| [#5701](https://github.com/open-mercato/open-mercato/pull/5701) | `18382a4b2` | Show demo portal credentials only when the seeded accounts genuinely exist, are active and their password still matches, for the current organization | yes |
| [#5709](https://github.com/open-mercato/open-mercato/pull/5709) | `9b8db15d4` | Let a portal-invitation re-invite survive a soft-deleted user instead of a raw 500 on accept, with a clean 409 on a genuine active-account conflict | yes |
| [#6033](https://github.com/open-mercato/open-mercato/pull/6033) | `7af0c57b0` | Stop `rotate-encryption-key --dry-run` and `backfill-system-encryption --dry-run` from provisioning a real tenant DEK in Vault while still reporting the rows a real run would rewrite |  |
| [#6021](https://github.com/open-mercato/open-mercato/pull/6021) | `f95cd1151` | Decrypt every field declared in an interaction's encryption map on the interactions list instead of only `title`/`body`, so extending the map no longer leaks ciphertext to the API |  |
| [#6065](https://github.com/open-mercato/open-mercato/pull/6065) | `b5efd1d51` | Re-check KMS health on every encrypted write instead of gating the tenant-encryption subscriber's registration once at boot, so a KMS outage overlapping process startup no longer leaves writes falling open to plaintext for the rest of the process lifetime |  |
| [#6097](https://github.com/open-mercato/open-mercato/pull/6097) | `973996a7f` | Sync custom-role ACLs again after a module's `onTenantCreated` hooks run during initial tenant setup, so a role a module creates in that hook gets its grants immediately instead of only after a manual `sync-role-acls` run |  |
| [#6059](https://github.com/open-mercato/open-mercato/pull/6059) | `917c8537b` | Make the custom-field `encrypted` flag declarative in `ce.ts` and preserve an admin-enabled flag across `entities install`, instead of silently discarding it and leaving stored ciphertext unreadable | yes |

### Sales and CRM correctness

| Upstream PR | Upstream commit | Change | Adapted |
|---|---|---|---|
| [#5470](https://github.com/open-mercato/open-mercato/pull/5470) | `dfa30fe01` | Serve persisted order totals on single-row sales order GET requests |  |
| [#5270](https://github.com/open-mercato/open-mercato/pull/5270) | `0baee9dad` | Give the payments table a real `tableId` so the gateway-status column actually binds and renders | yes |
| [#5279](https://github.com/open-mercato/open-mercato/pull/5279) | `b13f0ddd1` | Lock pricing controls on sales order lines that already have shipped quantities so a name-only edit no longer fails | yes |
| [#5573](https://github.com/open-mercato/open-mercato/pull/5573) | `dbf29dd6a` | Accept exchangeRate and the payment/fulfillment status entry ids on sales document update instead of silently stripping them |  |
| [#5553](https://github.com/open-mercato/open-mercato/pull/5553) | `bd9356828` | Fetch exchange rates for every currency, not just active ones, so a deactivated currency stops losing convertibility |  |
| [#5460](https://github.com/open-mercato/open-mercato/pull/5460) | `2a894d301` | Align Kanban and List won filtering and status UI | yes |
| [#5578](https://github.com/open-mercato/open-mercato/pull/5578) | `3e4c4bece` | Make `lost` the canonical deal status instead of the misspelled `loose`, with a data migration and a read-compatible alias | yes |
| [#5452](https://github.com/open-mercato/open-mercato/pull/5452) | `7f871e603` | Restore invoice and credit-memo header updates, which were failing with HTTP 500 |  |
| [#5200](https://github.com/open-mercato/open-mercato/pull/5200) | `c9b5e8652` | Spec the sales line `discount_amount` contract, precedence rules, and idempotency requirement | yes |
| [#5640](https://github.com/open-mercato/open-mercato/pull/5640) | `734c263bd` | Make sales line discountAmount a line total on both the read and write path | yes |
| [#5757](https://github.com/open-mercato/open-mercato/pull/5757) | `dc7edf9e1` | Advance the deal's optimistic-lock token when its linked people or companies change, closing a lost-update race where a stale whole-set save could silently reinstate a just-removed link | yes |
| [#5707](https://github.com/open-mercato/open-mercato/pull/5707) | `5f3843eb7` | Reconcile a caller-supplied sales line `totalNetAmount` against the computed net amount and warn on divergence, instead of silently discarding it | yes |
| [#5767](https://github.com/open-mercato/open-mercato/pull/5767) | `9d97f83bc` | Preserve `syncOrigin` (and forward `actorUserId`) on Customer person CRUD events so subscribers can tell a projection write from a genuine external change and stop reconciling against themselves |  |
| [#6051](https://github.com/open-mercato/open-mercato/pull/6051) | `a605cbd55` | Preserve a quote/order line's catalog, promotion and status-entry snapshots when another line on the same document is saved, instead of silently nulling them out |  |

### Performance

| Upstream PR | Upstream commit | Change | Adapted |
|---|---|---|---|
| [#5402](https://github.com/open-mercato/open-mercato/pull/5402) | `48f7adca8` | Stop rewriting search tokens that have not changed during re-indexing and data-sync backfills |  |
| [#5336](https://github.com/open-mercato/open-mercato/pull/5336) | `af90a2ddc` | Drop the vacuous unique constraint on the encrypted onboarding email column and keep the `email_hash` lookup path indexed | yes |
| [#5228](https://github.com/open-mercato/open-mercato/pull/5228) | `005201cd7` | Cap CRUD list `COUNT` queries at a configurable `OM_LIST_COUNT_CAP` via rebuilt count queries, avoiding multi-minute exact counts on large tables (#4552 Phase 2) | yes |
| [#5555](https://github.com/open-mercato/open-mercato/pull/5555) | `69113e169` | Index sales_notes and sales_document_addresses by document context, removing hot-path sequential scans on every document snapshot read |  |
| [#5612](https://github.com/open-mercato/open-mercato/pull/5612) | `db177ac36` | Batch fulltext worker index writes once per job instead of once per record | yes |
| [#5650](https://github.com/open-mercato/open-mercato/pull/5650) | `8ab389d30` | Stop indexing custom fields twice and rewriting unchanged search tokens | yes |
| [#5796](https://github.com/open-mercato/open-mercato/pull/5796) | `25365e718` | Cache deals aggregate responses to skip repeated aggregate SQL and currency conversion | yes |
| [#5819](https://github.com/open-mercato/open-mercato/pull/5819) | `a4e09b45a` | Reindex query projections after a data migration rewrites rows in raw SQL | yes |
| [#5772](https://github.com/open-mercato/open-mercato/pull/5772) | `c1941e0c2` | Honour a route's indexer declaration on the command path, not just direct writes | yes |
| [#5894](https://github.com/open-mercato/open-mercato/pull/5894) | `9b31dbba4` | Adopt the read-through enricher cache for the WMS inventory enrichers, cutting repeated cross-module reads on catalog-product, catalog-variant and sales-order list responses | yes |

Supporting change: five Operis list pages that upstream does not have (appointments, email
templates, invoices, resource areas, resource area types) now forward `totalIsCapped`, so the
`check:pagination-capped` guard passes and a capped total is never shown as exact.

### Not ported, and why

| Upstream PR | Reason |
|---|---|
| [#5453](https://github.com/open-mercato/open-mercato/pull/5453) | Rejects MFA-pending tokens. Operis has no MFA, so nothing issues such tokens. |
| [#5458](https://github.com/open-mercato/open-mercato/pull/5458), [#5210](https://github.com/open-mercato/open-mercato/pull/5210) | Enterprise-only (MFA emergency bypass, sudo challenges). |
| [#5614](https://github.com/open-mercato/open-mercato/pull/5614) | Superseded: `packages/shared/src/lib/query/schema-presence.ts` already caches column presence per connection and per table, with a TTL. |
| [#5454](https://github.com/open-mercato/open-mercato/pull/5454), [#5843](https://github.com/open-mercato/open-mercato/pull/5843), [#6025](https://github.com/open-mercato/open-mercato/pull/6025) | Security fixes to integration credentials. Deferred until `feat/per-tenant-env`, which rewrites that area, is merged. |
| Everything else in v0.8.0 | Not selected for this round: new features and modules (Agent Orchestrator, documents, staff time tracking, phone calls, Discord, email providers, web research, design-system library) and the remaining bug fixes. |
