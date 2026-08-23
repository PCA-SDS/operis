# Operis Architecture

Documentation for **this** system. Where a document here disagrees with the code,
the code is authoritative and the document is a bug — fix it in the same change.

## Documents

| Document | Covers |
|---|---|
| [`multi-tenancy.md`](multi-tenancy.md) | The canonical Platform → Tenant → Organization → Resource model, where isolation is actually enforced, the documented bypass, the invariants, and the known gaps |

## Architecture Decision Records

ADRs record **deviations from the inherited Open Mercato architecture**, so that a
future developer does not accidentally rebuild something that was removed
deliberately.

| ADR | Decision |
|---|---|
| [ADR-0001](adr/ADR-0001-fork-from-open-mercato.md) | Fork the Open Mercato OSS monorepo as the baseline; do not track upstream |
| [ADR-0002](adr/ADR-0002-exclude-enterprise-edition.md) | Exclude the commercially-licensed Enterprise Edition — and the resulting MFA/SSO gap |
| [ADR-0003](adr/ADR-0003-platform-domains-default.md) | Remove the foreign domain from the `PLATFORM_DOMAINS` default |
| [ADR-0004](adr/ADR-0004-compatibility-scope.md) | Scope the compatibility contract to persisted identifiers |
| [ADR-0005](adr/ADR-0005-agent-code-navigation-layer.md) | Add a prebuilt code-navigation layer (graft + graphify) for coding agents |

### Writing a new ADR

Number sequentially. Cover, at minimum:

```
Context
Current OpenMercato behavior      (if this is a deviation)
Decision
Reason
Alternatives considered
Security impact
Migration impact
Future implications
```

Record a decision as an ADR whenever it changes an inherited invariant, a security
boundary, a public contract, or the licensing posture.

## Related

- [`../../NOTICE.md`](../../NOTICE.md) — fork provenance, MIT attribution, excluded components
- [`../../AGENTS.md`](../../AGENTS.md) — repository working conventions
- [`../../.ai/specs/`](../../.ai/specs/) — feature specifications inherited from upstream (all MIT)
