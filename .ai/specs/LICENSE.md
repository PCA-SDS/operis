# Specifications Licensing Notes

Every specification in this folder originates from Open Mercato's **Open Source
(MIT) edition** and is used here under the MIT license. See [`NOTICE.md`](../../NOTICE.md)
for the fork's provenance and attribution.

## Enterprise Edition specifications are NOT present

Upstream also maintains commercial **Enterprise Edition** specifications under
`.ai/specs/enterprise/`. Those were deliberately **not imported** into this
repository, because Operis holds no commercial license from Open Mercato
sp. z o.o.

Without such a license you may not:

- use Enterprise Edition features in production,
- use Enterprise Edition features for commercial purposes,
- reproduce, redistribute, or sublicense Enterprise Edition code or specifications,
- modify, refactor, **derive, or generate new features from** Enterprise Edition
  implementations or specifications.

That last restriction is why the Enterprise specs are absent rather than merely
unused: keeping them here would invite deriving from them.

## If you need an excluded capability

MFA, SSO/directory sync, step-up ("sudo") re-authentication, and pessimistic
record locking are the capabilities this exclusion costs us. Any implementation
of them in Operis **must be clean-room** — written from public standards
(RFC 6238, WebAuthn/FIDO2, OIDC, SAML) and independently licensed libraries,
without reference to Open Mercato's Enterprise source or specifications.

See [`docs/architecture/adr/ADR-0002-exclude-enterprise-edition.md`](../../docs/architecture/adr/ADR-0002-exclude-enterprise-edition.md).
