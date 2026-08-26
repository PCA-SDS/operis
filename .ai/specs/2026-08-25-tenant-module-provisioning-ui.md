# Tenant Module Provisioning — PCA-Parity Superadmin UI

**Date:** 2026-08-25
**Status:** Implemented
**Modules:** `directory`, `ai_assistant`, `ui`, `shared`

## Problem

PCA ERP gives its staff admins a Company → Modules screen: a per-module toggle
list with an explicit Edit mode, a confirmation dialog carrying two
attestations, module categories, grant dates, a locked `Core` row for
always-on modules, and a nested per-module AI-assistant sub-toggle.

Operis already had the same screen at the same grain — `tenant_modules` is
per-tenant, and PCA's "Company" *is* its Tenant, so the two match; PCA has no
Organization layer at all. What Operis lacked were four things PCA's screen
does that materially change how usable it is at 40+ modules:

1. **No grouping.** One flat, registry-ordered run of every module.
2. **No grant history.** Entitlement was a boolean, so "when did Acme get WMS,
   and until when" was unanswerable — a billing question with no data behind it.
3. **Platform modules were hidden entirely**, so an operator looking for "Users"
   could not tell "not provided" from "not mine to control".
4. **No AI sub-toggle.** A tenant either had a module's AI assistant because it
   had the module, or not at all.

## Decisions

### Grain stays per-tenant

Confirmed against PCA rather than assumed: `TenantModule(tenant_id, module_code)`
with no organization dimension. Adding a per-organization layer would have meant
a third tier in `RbacService`'s resolution order and new cache keys, for a shape
no customer currently has — every seeded tenant holds exactly one organization.

### Module presentation is declared, not mapped

`ModuleInfo` gains `category`, `sortOrder` and `aiAssistant`, travelling the
same path as `requires` and `defaultEntitlement` — the generator copies module
`metadata` verbatim into `info:` in all three registry variants, so one
declaration reaches the app, the CLI and tests with no generator change.

PCA keeps this in a database `Module` table an admin edits at runtime. Operis
derives it from the code registry instead, because these are properties of the
code that ships, not of a deployment: a module cannot gain an AI assistant
without someone adding `ai-tools.ts`, and letting an operator claim otherwise in
a table would only create drift. `MODULE_CATEGORIES` is a closed union rather
than a free string — these are section headings, and a typo would silently split
a group in two.

### Platform modules appear as locked Core rows

`listEntitleableModules` still omits them — nothing can be *decided* about them.
`listModuleCatalog` is the new screen-facing view that includes them with
`alwaysOn: true`, rendered with a `Core` badge and a disabled switch, matching
PCA. Omitting them from the list and omitting them from the *screen* are
different questions, and the second one was answered wrongly.

### Revocation records, it does not erase

`starts_at` / `ends_at` on `tenant_modules`. Switching a module off keeps the
row and stamps `ends_at`; switching it on re-stamps `starts_at` and clears
`ends_at`. The migration backfills `starts_at` from `created_at` for existing
grants, the only honest approximation available, so the screen has a date to
show rather than a blank for every pre-existing row.

### The AI sub-toggle is enforced, not decorative

A switch that changes nothing is worse than no switch. `ai_assistant_enabled`
lives on `tenant_modules` and is enforced at the seam every AI caller funnels
through:

- `executeTool` — the single execution seam behind the chat client, the MCP
  server and the agent dispatcher. A tool whose module has its assistant off
  cannot run, whatever the caller's features say.
- The three listing sites (`mcp-server` ListTools, and both `in-process-client`
  listings) apply the same predicate, so a tool can never appear in a list it
  cannot be executed from.

Two deliberate asymmetries:

- **Revoking a module forces `ai_assistant_enabled` false.** Otherwise
  re-enabling the module later would silently restore AI access nobody
  re-granted.
- **Resolution failure fails *open*.** `resolveAiDisabledModuleIds` returns an
  empty set when the directory service is unreachable. This switch removes an
  affordance inside a module the tenant keeps, so an outage must not silently
  disarm every AI tool in the product. Entitlement itself stays fail-closed
  upstream in `RbacService`, which has already stripped a withheld module's
  features before any tool list is built.

`ModuleInfo.aiAssistant` is guarded in both directions by
`module-ai-assistant-declaration.test.ts`: declaring it without shipping
`ai-tools.ts`/`ai-agents.ts` gives an operator a switch that governs nothing,
and shipping them without declaring it leaves those tools outside the control
the screen claims to provide.

### One component, two screens

`ModuleAccessSection` is shared by the platform (tenant) screen and the
tenant-admin (per-user) screen. Categories, dates and the AI sub-row are all
opt-in through props and labels, so the per-user screen renders exactly as
before by simply not passing them — rather than forking the component and
letting the two drift.

### Two commands, one endpoint

`PUT /api/directory/tenant-modules` takes a `target` of `module` or
`aiAssistant` and dispatches to `directory.tenant_modules.set` or
`directory.tenant_modules.set_ai`. One write path for the screen, two commands
behind it, so `action_logs` can tell "withheld a module" from "withheld an
assistant" — different decisions with different blast radii.

### PCA's layout, Operis's tokens

PCA hardcodes `emerald-*` and `pca-shell-*` classes. `.ai/ds-rules.md` forbids
colour ramps in `className`, so the structure, tags, edit-reveal, dialog and
attestations are matched exactly while the rendering uses semantic DS tokens.
The AI sub-row uses the standard `Switch` rather than PCA's smaller variant:
`packages/ui/AGENTS.md` requires asking before changing a primitive's API, and
the nesting already carries the hierarchy.

## Changes

| File | Change |
|---|---|
| `shared/modules/registry.ts` | `ModuleInfo.category` / `.sortOrder` / `.aiAssistant`; `MODULE_CATEGORIES` |
| 60 module `index.ts` files | Category, rank and AI declarations |
| `directory/data/entities.ts` | `starts_at`, `ends_at`, `ai_assistant_enabled` on `TenantModule` |
| `directory/migrations/Migration20260825140000_…` | The three columns plus the `starts_at` backfill |
| `directory/lib/tenantModules.ts` | `listModuleCatalog`, grant-window stamping, `setModuleAiEnabled`, `getAiDisabledModuleIds`, category sort |
| `directory/commands/tenantModules.ts` | `directory.tenant_modules.set_ai` |
| `directory/api/tenant-modules/route.ts` | `target` discriminator, widened row schema |
| `ui/backend/entitlements/ModuleAccessSection.tsx` | Category groups, grant window, AI sub-row |
| `directory/backend/…/tenants/[id]/modules/page.tsx` | Wires the new labels and the AI handler |
| `ai_assistant/lib/ai-entitlement.ts` | Resolution + the shared predicate |
| `ai_assistant/lib/{tool-executor,mcp-server,in-process-client,tool-registry,types}.ts` | Enforcement at all four sites |
| `core/src/__tests__/module-ai-assistant-declaration.test.ts` | Repo-wide guard |

## Testing

- `directory/__tests__/tenantModules.test.ts` — core rows surface as `alwaysOn`;
  the grant window is stamped on grant, revoke and re-grant; revocation forces
  the assistant off; category sort with `Other` last; the AI setter refuses a
  module with no assistant and a module the tenant does not hold.
- `ai_assistant/lib/__tests__/ai-entitlement.test.ts` — the predicate for
  disabled, enabled, module-less and unrestricted cases, and both
  fail-open paths.
- Full gate: `build:packages`, `generate`, `typecheck`, `lint`,
  `i18n:check-sync`, `test:repo-wide-guards` (37 files), `build:app`, and every
  workspace suite — core 1,415 suites / 11,494 tests, ai-assistant 1,461,
  ui 1,971, shared 1,942, cli 1,720, app 576.
- `yarn db:generate` reports `directory: no changes`, confirming the
  hand-written migration and snapshot match the entity.

**Verified live** on the dev database with the migration applied, driving the
real page in Chromium: 9 category headings in order with `Other` last, 17 `Core`
badges, 17 grant dates, 4 AI sub-rows revealed in Edit mode, and a confirmation
dialog whose CTA stays disabled until both attestations are ticked. Through the
API: enabling the assistant for a granted AI-capable module succeeds; a module
with no assistant is refused; a withheld module is refused by name; revoking a
module stamps `ends_at` and forces the assistant off; re-granting re-stamps
`starts_at` and leaves the assistant off. `action_logs` records the grant and
the assistant changes under separate resource kinds.

## Known gaps

- The AI sub-toggle governs **tools**. An agent whose prompt references a module
  without calling its tools is unaffected; nothing currently ties agents to a
  module the way `registerMcpTool` ties tools.
- `resolveAiDisabledModuleIds` runs once per MCP request / in-process client and
  hits `listTenantModules`, which is cached per tenant for five minutes. A
  freshly toggled assistant therefore reaches an open AI session on its next
  client construction, not mid-session.
- PCA's screen also exposes module `status`, `owner` and `version` from its
  database registry. Operis has no equivalent surface; those would have to
  become `ModuleInfo` fields first.

## Changelog

### 2026-08-25
- Initial implementation.
- Re-verification pass. `getAiEnabledModuleIds` was dead — only its own test
  referenced it — and `resolveAiDisabledModuleIds` reached the answer through
  `listTenantModules`, which builds the whole catalog and a dependency graph to
  serve a screen. Replaced both with `getAiDisabledModuleIds`, the shape the AI
  runtime actually needs, queried directly. Also fixed a regression the catalog
  change introduced in `mercato directory list-tenant-modules`: core rows had
  started printing as plain ticks, reading as decisions an operator could
  reverse. They now print as `🔒 … (core — always available)` with a count over
  the entitleable rows only.
