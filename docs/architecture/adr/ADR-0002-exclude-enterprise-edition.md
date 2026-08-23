# ADR-0002 — Exclude the Open Mercato Enterprise Edition

- **Status:** Accepted
- **Date:** 2026-08-23

## Context

Open Mercato is **open-core**, not uniformly MIT. Upstream's own guard test
(`license-metadata-consistency`) states the rule explicitly: the root MIT license
covers every workspace package **except** `@open-mercato/enterprise`.

`packages/enterprise/LICENSE.md` reads, in part:

> You may not: use this package in production, use this package for any commercial
> purpose, reproduce, redistribute, sublicense, or publish this package, **modify,
> refactor, reverse engineer, derive from, or generate new features based on this
> package.**

`.ai/specs/LICENSE.md` applies the same restriction to `.ai/specs/enterprise/`.

Operis holds no commercial license from Open Mercato sp. z o.o., and nothing in
the repository establishes one.

## Decision

Do not import, and do not derive from:

| Path | Content |
|---|---|
| `packages/enterprise/` | The commercial package |
| `.ai/specs/enterprise/` | Enterprise Edition specifications |
| `apps/docs/docs/enterprise/` | Enterprise end-user documentation |
| `.ai/specs/analysis/ANALYSIS-SPEC-ENT-001-*` | Analysis reproducing Enterprise MFA design detail |
| `.ai/runs/2026-07-26-reimplement-enterprise-mfa-security.md` | Enterprise security implementation run log |

The last two sit *outside* the restricted directories but reproduce restricted
design detail (event IDs, ACL feature maps, API contracts). They were removed for
the same reason: keeping them invites derivation.

## Reason

The prohibition is not merely on *copying* — it explicitly covers **deriving from
or generating new features based on** the package and its specifications. Retaining
the specs while writing our own implementation would therefore still breach the
license. Removing the source material is what makes a future clean-room
implementation defensible.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Import it and rely on the "developer evaluation" allowance | The allowance is non-production, non-commercial only. Operis is a commercial production system, so the allowance does not apply. |
| Import but disable via env flags | Reproduction and redistribution are prohibited regardless of whether the code executes. |
| Reimplement MFA/SSO now from the EE specs | Explicitly prohibited ("derive… or generate new features based on"). |

## Security impact

**This is the significant cost of the decision.** Operis ships without:

- Multi-factor authentication (TOTP, WebAuthn/passkeys, OTP-over-email)
- Single sign-on and directory sync (Entra ID, Google Workspace, Zitadel, OIDC)
- Step-up re-authentication ("sudo mode") for sensitive operations
- Pessimistic record locking for collaborative edits
- System status overlays

Authentication is therefore **password-only** at the fork point. For a
multi-tenant system holding customer data this is a genuine weakness and should be
treated as a priority gap, not an accepted steady state.

Note that the OSS core retains *optimistic* locking (`updated_at` version floor,
409 on conflict), so concurrent-edit safety degrades to last-writer-detected rather
than disappearing.

## Migration impact

None at the fork point. Removal was verified non-breaking:

- Upstream already enforced "`@open-mercato/core` MUST NOT import from
  `@open-mercato/enterprise`", so the boundary was clean.
- The modules were registered only behind `OM_ENABLE_ENTERPRISE_MODULES` (default
  **false**), so the default build never loaded them.
- After removal: build, generate, typecheck, and lint all pass; the full test suite
  passes.

Removal required fixing genuinely stale references it left behind: Dockerfile
`COPY` lines, a Jest module-name mapper, the docs sidebar, and several coverage
allowlists that pointed at now-absent files.

## Future implications

Any future MFA/SSO implementation **must be clean-room**: written from public
standards (RFC 6238 TOTP, WebAuthn/FIDO2, OIDC, SAML) and independently licensed
libraries — `openid-client`, `@simplewebauthn/*`, and `otpauth` are all separately
available under their own open-source licenses. It must not reference Open
Mercato's Enterprise source or specifications.

If Operis later acquires a commercial license, prefer consuming the package as a
separately-licensed dependency with its license intact, rather than folding it into
this MIT tree.

The guard in `packages/core/src/__tests__/license-metadata-consistency.test.ts` was
rewritten to enforce *this* decision: it fails if `packages/enterprise/` reappears,
or if any workspace package declares a non-MIT / restricted license.
