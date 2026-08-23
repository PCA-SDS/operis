# ADR-0001 — Fork Open Mercato as the architectural baseline

- **Status:** Accepted
- **Date:** 2026-08-23
- **Supersedes:** —

## Context

Operis needs a multi-tenant CRM/ERP application foundation. Open Mercato is an
MIT-licensed TypeScript modular monolith that already implements the hard parts:
tenant/organization scoping, RBAC with per-module feature ACLs, a fail-closed
query engine, module auto-discovery, commands/events, tenant-partitioned caching,
and encryption.

The alternatives were building from scratch, or consuming Open Mercato as
versioned npm dependencies via `create-mercato-app`.

The repository at the start of this work was empty (a single commit containing an
8-byte `README.md`). There was no prior fork to audit — this ADR records the
creation of one.

## Decision

Fork the **entire open-source monorepo** at upstream commit
`3019dc2328af92dd46d75243d9ba0197d0c0ed07` (v0.7.0, 2026-08-22), excluding only
the commercially-licensed components (see [ADR-0002](ADR-0002-exclude-enterprise-edition.md)),
and own it outright.

Operis does **not** track upstream releases. Open Mercato is the historical
architectural origin, not a framework whose future decisions govern this codebase.

## Reason

- **Consuming it as a dependency was rejected** because it directly contradicts the
  requirement to be independently maintainable — it would make every future
  architectural change contingent on upstream's package boundaries and release
  cadence.
- **Building from scratch was rejected** because the tenancy and authorization
  machinery here is genuinely non-trivial and already fail-closed; reimplementing
  it would trade months of work for a strictly worse starting security posture.
- **Taking the whole monorepo rather than a curated subset** follows the principle
  of not removing architecture whose dependants and runtime effects are not yet
  understood. Module discovery is dynamic (generated registries, DI registrars,
  widget injection tables), so "unused" is not safely inferable by inspection at
  this stage. Pruning is a later, evidence-driven exercise.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| `create-mercato-app` scaffold with `@open-mercato/*` npm deps | Permanent upstream coupling; contradicts the core objective |
| Platform-foundation-only subset (drop WMS/EUDR/sales/catalog/…) | Attractive maintenance-wise, but removal is unsafe before dependants are mapped; deferred, not rejected forever |
| Greenfield build | Discards a working, fail-closed multi-tenant core for no near-term benefit |

## Security impact

Neutral-to-positive at the fork point. The inherited query engine refuses to run a
query without a tenant scope, and organization access is fail-closed. Two
fork-specific corrections were made immediately — see
[ADR-0003](ADR-0003-platform-domains-default.md).

The excluded enterprise package means **no MFA and no SSO** ship in this baseline.
That is a real reduction in available authentication strength versus a licensed
Open Mercato deployment, and is tracked in [ADR-0002](ADR-0002-exclude-enterprise-edition.md).

## Migration impact

None — greenfield. No existing Operis data or schema to migrate. The imported
module migrations are upstream's, unmodified, and constitute the initial schema.

## Future implications

- Upstream fixes (including security fixes) will **not** arrive automatically.
  Someone must periodically diff upstream and port what matters. The fork point is
  recorded in `NOTICE.md` precisely so that diff is mechanically possible.
- The `@open-mercato/*` package scope was intentionally **kept**. Renaming ~9,000
  files to `@operis/*` is a large mechanical diff with real merge cost and no
  technical benefit today; the workspace resolves these locally via `workspace:*`,
  so there is no risk of silently consuming upstream packages from npm. Revisit
  only if Operis publishes packages.
