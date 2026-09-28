---
title: "Route helpers must keep literal metadata, openApi and guard resourceKind in each route file"
modules: ["cli","shared"]
areas: ["architecture","integration"]
topics: ["generated-files","auto-discovery","route-coverage","refactoring"]
---

# Route helpers must keep literal metadata, openApi and guard resourceKind in each route file

**Context**: The 2026-09-28 dedup pass merged near-identical API route pairs (tag assign/unassign, leave-request accept/reject, invoice payment confirmations, payment-gateway transaction actions, …) into module-local helpers (`.ai/specs/2026-09-28-codebase-dedup-and-canonical-adoption.md`, Phase 4).

**Problem**: The generator reads route contracts from source, not at runtime:
- route `metadata` (auth and feature guards) and `openApi` resolve through `resolveExpressionValue` in `packages/cli/src/lib/generators/module-registry.ts`, which follows locals, imports and `makeCrudRoute({ metadata })` only;
- extension facts (`module-extension-facts.ts`) take the guard call's `resourceKind` and `operation` as literals, and a non-literal `operation` is read as "any".

A route factory such as `makeTagRoute({ metadata, operation })`, or a helper that builds the guard input from parameters, turns those values dynamic. The generated manifests then silently lose them — the build still passes. One pair (staff team-member tags) was left unmerged for this reason: merging would have made its guard operation dynamic.

**Rule**:
- Extract only the handler body. Every route file keeps `export const metadata = { ... }` and `export const openApi = { ... }` as literals.
- Pass a literal `resourceKind` and `operation` to `runRouteMutationGuards`, either in the route or as literal helper arguments the generator can follow.
- Verify with a `yarn generate` diff of HEAD against the tree: route manifests, OpenAPI and the extension-bindings markdown must match.
