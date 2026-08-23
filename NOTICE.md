# NOTICE — Provenance and Attribution

## Origin

Operis is derived from **Open Mercato**, an open-source TypeScript CRM/ERP
foundation framework.

| | |
|---|---|
| Upstream project | [open-mercato/open-mercato](https://github.com/open-mercato/open-mercato) |
| Upstream license | MIT |
| Fork point (commit) | `3019dc2328af92dd46d75243d9ba0197d0c0ed07` |
| Fork point (version) | `0.7.0` |
| Fork point (date) | 2026-08-22 |
| Imported on | 2026-08-23 |

The upstream MIT license text is preserved verbatim in [`LICENSE`](LICENSE),
including the original copyright attribution to the Open Mercato contributors.
That notice **must not be removed** — MIT requires it to be retained in all
copies and substantial portions of the software.

Modifications made after the fork point are copyright their respective authors
and are released under the same MIT license.

## Relationship to upstream

Operis is an **independent fork**, not a downstream distribution. It does not
track upstream releases and carries no obligation to remain compatible with
future Open Mercato versions. Open Mercato is the historical architectural
origin of this codebase, not a framework whose future decisions govern it.

Upstream documentation may still be a useful *historical* reference for
architectural intent, but this repository's own documentation under
[`docs/`](docs/) is the authoritative description of how Operis behaves.

## Excluded components — commercial licensing boundary

Open Mercato is **open-core**. The following were deliberately **not** imported
because they are commercially licensed and this repository establishes no
commercial license for them:

| Excluded path | Reason |
|---|---|
| `packages/enterprise/` | `@open-mercato/enterprise` — commercial. Its license forbids production use, commercial use, reproduction, redistribution, and *derivation or reimplementation* without a commercial license from Open Mercato sp. z o.o. |
| `.ai/specs/enterprise/` | Enterprise Edition specifications, under the same restriction. |
| `apps/docs/docs/enterprise/` | End-user documentation for Enterprise Edition features. |
| `.ai/specs/analysis/ANALYSIS-SPEC-ENT-001-*` | Pre-implementation analysis reproducing Enterprise MFA design detail (event IDs, ACL feature maps, API contracts). |
| `.ai/runs/2026-07-26-reimplement-enterprise-mfa-security.md` | Implementation run log for the Enterprise security module. |

Upstream's own guard test (`license-metadata-consistency`) documents that **the
package is the licensing boundary**: the root MIT license covers every workspace
package *except* `@open-mercato/enterprise`. Everything imported into Operis
therefore falls under MIT.

### Capabilities intentionally absent as a result

Excluding the enterprise package means Operis has **no** implementation of:

- Multi-factor authentication (TOTP, passkeys/WebAuthn, OTP-over-email)
- Single sign-on / directory sync (Entra ID, Google Workspace, Zitadel, OIDC)
- Step-up re-authentication ("sudo mode")
- Pessimistic record locking (collaborative edit conflict resolution)
- System status overlays

These are tracked as a documented gap in
[`docs/architecture/adr/ADR-0002-exclude-enterprise-edition.md`](docs/architecture/adr/ADR-0002-exclude-enterprise-edition.md).

**Any future implementation of these capabilities must be clean-room**: written
from public standards (RFC 6238, WebAuthn, OIDC/SAML) and independently licensed
libraries, without reference to Open Mercato's Enterprise source or
specifications. Deriving from them would breach the enterprise license.

## Third-party dependencies

Third-party runtime and build dependencies retain their own licenses. See each
package's `package.json` and the dependency tree for details. Notable bundled
third-party asset:

- `certs/geotrust-ev-rsa-ca-g2.pem` — GeoTrust intermediate CA certificate,
  redistributed for TLS chain verification.
