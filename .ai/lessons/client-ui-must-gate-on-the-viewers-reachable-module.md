---
title: "Client UI must gate on the viewer's reachable module set, never on a hardcoded route"
modules: ["platform","directory","auth"]
areas: ["backend-ui","architecture"]
topics: ["access-control","ui-components","module-boundaries"]
---

# Client UI must gate on the viewer's reachable module set, never on a hardcoded route

**Context**: A module can be withheld from a tenant (`tenant_modules`) or from one user (`user_modules`). Every surface derived from `grantedFeatures` handles that for free, because `RbacService` filters those grants through both entitlement layers — navigation, page guards, API guards, injection widgets, dashboard widgets, search and AI tools.

**Problem**: A hardcoded `'/backend/<module>/…'` string in a React component carries no feature to test, so it survives into a UI whose owning module the guards now deny. The user is shown a doorway that 403s — and, worse, learns a capability exists that was deliberately withheld. Auditing this fork found the pattern in shared components (`ActivitiesSection`, `NotesSection`, custom-field relation links), in server enrichment (`attachments` assignment labels) and in data-derived deep links (`resolveTodoHref`, whose module comes from a stored `<module>:<kind>` string and so can name a module the tenant lost).

**Rule**: Prefer a feature check when the affordance maps to a real ACL feature — that is finer-grained and already entitlement-aware. When it does not, gate on the viewer's reachable modules: `useModuleEnabled(id)`, `useEnabledModules()` or `<ModuleGate module="…">` from `@open-mercato/ui/backend/BackendChromeProvider`, fed by `BackendChromePayload.enabledModuleIds`. Server-side, pass `rbacService.getReachableModuleIds(...)` into the helper that builds the link. Never gate on the generated `enabled-module-ids` registry alone — that is deploy-level and identical for every tenant. Two exemptions need no gate: a link into a module the source module declares in `info.requires` (entitlement drops both together), and one whose only caller already gates it. `packages/core/src/__tests__/module-ui-gating.test.ts` enforces this and holds the reviewed exceptions.

**Applies to**: every component, helper and API response that builds a link or button pointing outside its own module. Background: `.ai/specs/2026-08-25-mvp-module-scope-and-ui-gating.md`.
